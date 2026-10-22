"""
Study rooms: real-time connections, the AI moderator and live quiz battles.

Everything real-time lives in this process (one uvicorn worker), which is fine for a
study group; room data itself is stored in the database.
"""
import asyncio
import json
import re
import time
import uuid
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List, Optional, Set

from fastapi import WebSocket
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Document, Room, RoomDocument, RoomMember, RoomMessage, User
from services.groq_service import (
    AIServiceError,
    CITATION_INSTRUCTION,
    MARKDOWN_INSTRUCTION,
    generate_quiz,
    normalize_citations,
    stream_completion,
)
from services.rag_service import format_sources, rag_service
from services.study_group_service import PERSONAS

PERSONA_BY_NAME = {p["name"].lower(): pid for pid, p in PERSONAS.items()}

AI_MENTION = re.compile(r"@mind\s?ai\b", re.IGNORECASE)
# AI classmates from the study group can be @mentioned in rooms too
PERSONA_MENTION = re.compile(r"@(maya|leo|zoe|omar)\b", re.IGNORECASE)
HISTORY_FOR_AI = 12
QUIZ_TIME_LIMIT_S = 20
QUIZ_REVEAL_PAUSE_S = 5
MAX_POINTS = 1000
MESSAGES_PER_10S = 8


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def user_brief(user: Optional[User]) -> Optional[Dict[str, str]]:
    if user is None:
        return None
    return {"id": user.id, "name": user.name, "avatar_color": user.avatar_color}


def message_out(message: RoomMessage) -> Dict[str, Any]:
    return {
        "id": message.id,
        "room_id": message.room_id,
        "kind": message.kind,
        "text": message.text,
        "sources": json.loads(message.sources) if message.sources else None,
        "data": json.loads(message.data) if message.data else None,
        "created_at": message.created_at,
        "user": user_brief(message.user),
    }


def add_message(db: Session, room_id: str, text: str, kind: str = "user", user_id: Optional[str] = None,
                sources: Optional[List[Dict]] = None, data: Optional[Dict] = None) -> RoomMessage:
    message = RoomMessage(
        id=uuid.uuid4().hex,
        room_id=room_id,
        user_id=user_id,
        kind=kind,
        text=text,
        sources=json.dumps(sources) if sources else None,
        data=json.dumps(data) if data else None,
        created_at=now_ms(),
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def get_membership(db: Session, room_id: str, user_id: str) -> Optional[RoomMember]:
    return db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user_id).first()


# ---------------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------------

class ConnectionManager:
    """Open WebSockets per room and user (a user may have several tabs open)."""

    def __init__(self):
        self.rooms: Dict[str, Dict[str, Set[WebSocket]]] = defaultdict(lambda: defaultdict(set))
        self._message_times: Dict[str, Deque[float]] = defaultdict(deque)

    def online_user_ids(self, room_id: str) -> List[str]:
        return [uid for uid, sockets in self.rooms.get(room_id, {}).items() if sockets]

    async def connect(self, room_id: str, user_id: str, websocket: WebSocket) -> bool:
        """Register a socket; returns True if this is the user's first connection to the room."""
        first = not self.rooms[room_id][user_id]
        self.rooms[room_id][user_id].add(websocket)
        return first

    def disconnect(self, room_id: str, user_id: str, websocket: WebSocket) -> bool:
        """Remove a socket; returns True if the user has no connections left in the room."""
        sockets = self.rooms.get(room_id, {}).get(user_id)
        if sockets is None:
            return False
        sockets.discard(websocket)
        if not sockets:
            del self.rooms[room_id][user_id]
            if not self.rooms[room_id]:
                del self.rooms[room_id]
            return True
        return False

    async def send(self, websocket: WebSocket, event: Dict[str, Any]) -> None:
        try:
            await websocket.send_json(event)
        except Exception:
            pass  # Closed socket: cleaned up by its own receive loop

    async def broadcast(self, room_id: str, event: Dict[str, Any], exclude: Optional[WebSocket] = None) -> None:
        sockets = [ws for user_sockets in list(self.rooms.get(room_id, {}).values()) for ws in list(user_sockets)]
        await asyncio.gather(*[self.send(ws, event) for ws in sockets if ws is not exclude])

    async def close_room(self, room_id: str, user_id: Optional[str] = None, reason: str = "") -> None:
        """Disconnect everyone (room deleted) or one user (removed from the room)."""
        targets = self.rooms.get(room_id, {})
        for uid, sockets in list(targets.items()):
            if user_id is not None and uid != user_id:
                continue
            for ws in list(sockets):
                await self.send(ws, {"type": "removed", "reason": reason})
                try:
                    await ws.close(code=4403)
                except Exception:
                    pass

    def allow_message(self, user_id: str) -> bool:
        """Simple flood protection per user."""
        times = self._message_times[user_id]
        cutoff = time.time() - 10
        while times and times[0] < cutoff:
            times.popleft()
        if len(times) >= MESSAGES_PER_10S:
            return False
        times.append(time.time())
        return True


manager = ConnectionManager()


async def broadcast_presence(room_id: str) -> None:
    await manager.broadcast(room_id, {"type": "presence", "online": manager.online_user_ids(room_id)})


# ---------------------------------------------------------------------------
# AI moderator
# ---------------------------------------------------------------------------

_ai_locks: Dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


def room_document_ids(db: Session, room_id: str) -> List[str]:
    return [doc_id for (doc_id,) in db.query(RoomDocument.document_id).filter(RoomDocument.room_id == room_id).all()]


def shared_document(db: Session, room_id: str, document_id: Any) -> Optional[Document]:
    """The document if it is shared in this room (anything else, e.g. one unshared meanwhile, is ignored)."""
    if not isinstance(document_id, str) or not document_id:
        return None
    return (db.query(Document).join(RoomDocument, RoomDocument.document_id == Document.id)
            .filter(RoomDocument.room_id == room_id, Document.id == document_id).first())


def _ai_messages(room: Room, history: List[RoomMessage], question: str, asker: str, context: str,
                 persona_id: Optional[str] = None, focus_title: Optional[str] = None) -> List[Dict]:
    titles = ", ".join(rd.document.title for rd in room.documents if rd.document) or "none yet"
    identity = f'You are MindAI, the AI study moderator in a group study room called "{room.name}".'
    if persona_id:
        persona = PERSONAS[persona_id]
        identity = (f"You are {persona['name']}, {persona['role'].lower()}, an AI classmate in a group study room called "
                    f'"{room.name}". {persona["style"]} Stay in character and keep it to 2-5 sentences.')
    system = f"""{identity}
Several students chat here; messages are prefixed with the speaker's name. Answer the latest question for the whole group,
address the asker by name, and keep it concise and encouraging. Use the shared documents' context below.
If the context doesn't cover the question, say so briefly and answer from general knowledge, clearly labelled.
{MARKDOWN_INSTRUCTION}
{CITATION_INSTRUCTION if context else ""}

DOCUMENTS SHARED IN THIS ROOM: {titles}
{f'THE QUESTION IS ABOUT ONE DOCUMENT: "{focus_title}". Answer from it (the context below comes only from it).' if focus_title else ''}

CONTEXT FROM SHARED DOCUMENTS:
{context or "(no documents shared yet)"}"""
    messages = [{"role": "system", "content": system}]
    for m in history:
        if m.kind == "ai":
            speaker = json.loads(m.data).get("persona") if m.data else None
            name = PERSONAS[speaker]["name"] if speaker in PERSONAS else "MindAI"
            messages.append({"role": "assistant", "content": f"{name}: {m.text}"})
        elif m.kind == "user":
            messages.append({"role": "user", "content": f"{m.user.name if m.user else 'Someone'}: {m.text}"})
    messages.append({"role": "user", "content": f"{asker}: {question}"})
    return messages


async def run_ai_answer(room_id: str, question: str, asker_name: str, persona_id: Optional[str] = None,
                        document_id: Optional[str] = None) -> None:
    """
    Stream the moderator's answer to everyone in the room, then save it. One answer at a time per room.
    With `document_id` (the message was about one shared document) the answer comes from that document only.
    """
    async with _ai_locks[room_id]:
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if room is None:
                return
            focus = shared_document(db, room_id, document_id)
            doc_ids = [focus.id] if focus else room_document_ids(db, room_id)
            sources = await run_in_threadpool(rag_service.get_sources, question, doc_ids) if doc_ids else []
            history = (
                db.query(RoomMessage)
                .filter(RoomMessage.room_id == room_id, RoomMessage.kind.in_(["user", "ai"]))
                .order_by(RoomMessage.created_at.desc())
                .limit(HISTORY_FOR_AI + 1)
                .all()
            )[::-1][:-1]  # The newest message is the question itself
            messages = _ai_messages(room, history, question, asker_name, format_sources(sources, include_titles=True), persona_id,
                                    focus.title if focus else None)

            stream_id = uuid.uuid4().hex
            await manager.broadcast(room_id, {"type": "ai_start", "stream_id": stream_id, "sources": sources, "persona": persona_id,
                                              "document": {"id": focus.id, "title": focus.title} if focus else None})
            parts: List[str] = []
            try:
                async for piece in stream_completion(messages, 0.6, 1500):
                    parts.append(piece)
                    await manager.broadcast(room_id, {"type": "ai_delta", "stream_id": stream_id, "text": piece})
                text = normalize_citations("".join(parts)).strip() or "I couldn't come up with an answer this time."
            except AIServiceError as e:
                text = f"Sorry, I couldn't answer just now: {e}"
                sources = []
            data: Dict[str, Any] = {}
            if persona_id:
                data["persona"] = persona_id
            if focus:
                data.update(document_id=focus.id, document_title=focus.title)
            message = add_message(db, room_id, text, kind="ai", sources=sources or None, data=data or None)
            await manager.broadcast(room_id, {"type": "ai_done", "stream_id": stream_id, "message": message_out(message)})
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Quiz battles
# ---------------------------------------------------------------------------

class QuizBattle:
    """A live multiple-choice quiz for everyone in a room, scored by correctness and speed."""

    def __init__(self, room_id: str, started_by: Dict[str, str], questions: List[Dict], players: Dict[str, Dict]):
        self.room_id = room_id
        self.started_by = started_by
        self.questions = questions
        self.players = players  # user_id -> brief
        self.scores: Dict[str, int] = {uid: 0 for uid in players}
        self.correct_counts: Dict[str, int] = {uid: 0 for uid in players}
        self.index = -1
        self.answers: Dict[str, Dict[str, Any]] = {}
        self.question_started = 0.0
        self.deadline = 0.0
        self.all_answered = asyncio.Event()
        self.cancelled = False
        self.task: Optional[asyncio.Task] = None
        self.document_id: Optional[str] = None
        # user_id -> [(question index, correct)] for the question bank
        self.history: Dict[str, List[tuple]] = {}

    def leaderboard(self) -> List[Dict[str, Any]]:
        rows = [
            {"user": self.players[uid], "score": score, "correct": self.correct_counts.get(uid, 0)}
            for uid, score in self.scores.items()
        ]
        return sorted(rows, key=lambda r: (-r["score"], r["user"]["name"].lower()))

    def question_event(self) -> Dict[str, Any]:
        q = self.questions[self.index]
        return {
            "type": "quiz_question",
            "index": self.index,
            "total": len(self.questions),
            "question": q["question"],
            "options": q["options"],
            "topic": q.get("topic"),
            "time_limit": QUIZ_TIME_LIMIT_S,
            "remaining": max(0.0, round(self.deadline - time.time(), 2)),
            "answered": len(self.answers),
            "players": len(self.players),
        }

    def submit(self, user: User, question_index: int, option: int) -> Optional[str]:
        """Record an answer; returns an error message or None."""
        if question_index != self.index or time.time() > self.deadline:
            return "That question has closed."
        if user.id in self.answers:
            return "You already answered."
        if not 0 <= option < len(self.questions[self.index]["options"]):
            return "Invalid option."
        if user.id not in self.players:  # Joined mid-game
            self.players[user.id] = user_brief(user)
            self.scores[user.id] = 0
            self.correct_counts[user.id] = 0
        self.answers[user.id] = {"option": option, "elapsed": time.time() - self.question_started}
        online = set(manager.online_user_ids(self.room_id))
        if online and online.issubset(self.answers.keys()):
            self.all_answered.set()
        return None

    async def run(self) -> None:
        try:
            for index in range(len(self.questions)):
                if self.cancelled:
                    return
                self.index = index
                self.answers = {}
                self.all_answered = asyncio.Event()
                self.question_started = time.time()
                self.deadline = self.question_started + QUIZ_TIME_LIMIT_S
                await manager.broadcast(self.room_id, self.question_event())
                try:
                    await asyncio.wait_for(self.all_answered.wait(), timeout=QUIZ_TIME_LIMIT_S)
                except asyncio.TimeoutError:
                    pass
                if self.cancelled:
                    return
                self.deadline = 0  # Close the question
                await manager.broadcast(self.room_id, self.reveal_event())
                await asyncio.sleep(QUIZ_REVEAL_PAUSE_S)
            await self.finish()
        finally:
            if _battles.get(self.room_id) is self:
                del _battles[self.room_id]

    def reveal_event(self) -> Dict[str, Any]:
        q = self.questions[self.index]
        correct = q["correct_answer_index"]
        results = {}
        counts = [0] * len(q["options"])
        for uid, answer in self.answers.items():
            counts[answer["option"]] += 1
            is_correct = answer["option"] == correct
            points = round(MAX_POINTS * (0.5 + 0.5 * max(0.0, 1 - answer["elapsed"] / QUIZ_TIME_LIMIT_S))) if is_correct else 0
            self.scores[uid] = self.scores.get(uid, 0) + points
            if is_correct:
                self.correct_counts[uid] = self.correct_counts.get(uid, 0) + 1
            results[uid] = {"option": answer["option"], "correct": is_correct, "points": points}
            self.history.setdefault(uid, []).append((self.index, is_correct))
        return {
            "type": "quiz_reveal",
            "index": self.index,
            "total": len(self.questions),
            "correct_index": correct,
            "explanation": q.get("explanation", ""),
            "counts": counts,
            "results": results,
            "leaderboard": self.leaderboard(),
        }

    async def finish(self) -> None:
        board = self.leaderboard()
        db = SessionLocal()
        try:
            winner = board[0] if board and board[0]["score"] > 0 else None
            summary = (f"🏆 Quiz battle finished! {winner['user']['name']} won with {winner['score']} points."
                       if winner else "Quiz battle finished. No points scored this time.")
            message = add_message(db, self.room_id, summary, kind="quiz",
                                  data={"leaderboard": board, "questions": len(self.questions)})
            await manager.broadcast(self.room_id, {"type": "quiz_end", "leaderboard": board, "message": message_out(message)})
            if self.document_id:
                from services.assessment import bank
                from services.assessment.schema import upgrade_quiz
                questions = upgrade_quiz(self.questions)
                for uid, answers in self.history.items():
                    bank.record_results(db, uid, self.document_id, None,
                                        [(questions[i], 1.0 if ok else 0.0) for i, ok in answers if i < len(questions)], "battle")
        except Exception as e:  # Saving stats must never break the battle
            print(f"Could not record battle results: {e}")
        finally:
            db.close()


_battles: Dict[str, QuizBattle] = {}


def active_battle(room_id: str) -> Optional[QuizBattle]:
    return _battles.get(room_id)


async def start_battle(room_id: str, starter: User, count: int) -> None:
    """Generate a quiz from the room's shared documents and run it live."""
    if room_id in _battles:
        raise ValueError("A quiz battle is already running in this room.")
    db = SessionLocal()
    try:
        docs = (
            db.query(Document)
            .join(RoomDocument, RoomDocument.document_id == Document.id)
            .filter(RoomDocument.room_id == room_id)
            .all()
        )
        docs = [d for d in docs if (d.content or "").strip()]
        if not docs:
            raise ValueError("Share at least one document with the room before starting a quiz battle.")
        per_doc = max(2000, 14000 // len(docs))
        content = "\n\n".join(f"## {d.title}\n{d.content[:per_doc]}" for d in docs)
        players = {uid: user_brief(u) for uid in manager.online_user_ids(room_id)
                   for u in [db.query(User).filter(User.id == uid).first()] if u}
    finally:
        db.close()

    # Reserve the room while the quiz is generated so two battles can't start at once
    placeholder = QuizBattle(room_id, user_brief(starter), [], players)
    _battles[room_id] = placeholder
    await manager.broadcast(room_id, {"type": "quiz_preparing", "started_by": user_brief(starter), "count": count})
    try:
        questions = [q.model_dump() for q in await generate_quiz(content=content, count=count)]
    except AIServiceError as e:
        _battles.pop(room_id, None)
        await manager.broadcast(room_id, {"type": "quiz_error", "detail": str(e)})
        return
    if not questions or placeholder.cancelled:
        _battles.pop(room_id, None)
        await manager.broadcast(room_id, {"type": "quiz_error", "detail": "Could not create the quiz. Please try again."})
        return

    battle = QuizBattle(room_id, user_brief(starter), questions, players)
    battle.document_id = docs[0].id
    _battles[room_id] = battle
    battle.task = asyncio.create_task(battle.run())


async def cancel_battle(room_id: str) -> bool:
    battle = _battles.pop(room_id, None)
    if battle is None:
        return False
    battle.cancelled = True
    battle.all_answered.set()
    await manager.broadcast(room_id, {"type": "quiz_cancelled"})
    return True

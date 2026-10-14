import asyncio
import secrets
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from models import Room, RoomDocument, RoomMember, RoomMessage, User
from services.auth_service import get_current_user, get_user_document, user_from_token
from services.room_service import (
    AI_MENTION,
    PERSONA_BY_NAME,
    PERSONA_MENTION,
    active_battle,
    add_message,
    broadcast_presence,
    cancel_battle,
    get_membership,
    manager,
    message_out,
    now_ms,
    run_ai_answer,
    start_battle,
    user_brief,
)

router = APIRouter(prefix="/api/rooms", tags=["rooms"])

INVITE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # No look-alike characters
MAX_MESSAGE_CHARS = 4000


class CreateRoomRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RenameRoomRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ShareDocumentRequest(BaseModel):
    document_id: str


def new_invite_code(db: Session) -> str:
    while True:
        code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))
        if not db.query(Room).filter(Room.invite_code == code).first():
            return code


def get_room_for_member(db: Session, user: User, room_id: str) -> tuple:
    """(room, membership) for a member; 404 for non-members so room IDs aren't revealed."""
    room = db.query(Room).filter(Room.id == room_id).first()
    membership = get_membership(db, room_id, user.id) if room else None
    if not room or not membership:
        raise HTTPException(status_code=404, detail="Room not found")
    return room, membership


def require_owner(membership: RoomMember) -> None:
    if membership.role != "owner":
        raise HTTPException(status_code=403, detail="Only the room owner can do that.")


def room_summary(db: Session, room: Room, user: User) -> dict:
    membership = get_membership(db, room.id, user.id)
    last = (
        db.query(RoomMessage).filter(RoomMessage.room_id == room.id)
        .order_by(RoomMessage.created_at.desc()).first()
    )
    return {
        "id": room.id,
        "name": room.name,
        "invite_code": room.invite_code,
        "owner_id": room.owner_id,
        "my_role": membership.role if membership else None,
        "member_count": len(room.members),
        "online_count": len(manager.online_user_ids(room.id)),
        "document_count": len(room.documents),
        "created_at": room.created_at,
        "last_message": {
            "text": last.text[:140],
            "kind": last.kind,
            "user_name": last.user.name if last.user else ("MindAI" if last.kind == "ai" else None),
            "created_at": last.created_at,
        } if last else None,
    }


def room_detail(db: Session, room: Room, user: User) -> dict:
    online = set(manager.online_user_ids(room.id))
    members = sorted(room.members, key=lambda m: (m.role != "owner", m.joined_at))
    return {
        **room_summary(db, room, user),
        "members": [
            {**user_brief(m.user), "role": m.role, "joined_at": m.joined_at, "online": m.user_id in online}
            for m in members if m.user
        ],
        "documents": [
            {
                "id": rd.id,
                "document_id": rd.document_id,
                "title": rd.document.title,
                "type": rd.document.type,
                "summary": rd.document.summary,
                "shared_by": user_brief(rd.sharer),
                "shared_at": rd.shared_at,
                "mine": rd.shared_by == user.id,
            }
            for rd in sorted(room.documents, key=lambda d: d.shared_at) if rd.document
        ],
        "quiz_active": active_battle(room.id) is not None,
    }


async def post_system(db: Session, room_id: str, text: str) -> None:
    message = add_message(db, room_id, text, kind="system")
    await manager.broadcast(room_id, {"type": "message", "message": message_out(message)})


async def broadcast_room_update(db: Session, room: Room) -> None:
    """Tell connected members to refresh room details (members/documents changed)."""
    await manager.broadcast(room.id, {"type": "room_updated"})


# ---------------------------------------------------------------------------
# REST
# ---------------------------------------------------------------------------

def _lan_addresses() -> List[str]:
    """This machine's private network IPv4 addresses, the main interface first."""
    import ipaddress
    import socket
    found: List[str] = []
    try:
        # Connecting a UDP socket sends nothing; it just picks the interface used for outbound traffic
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("10.255.255.255", 1))
            found.append(probe.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    result: List[str] = []
    for address in found:
        ip = ipaddress.ip_address(address)
        if ip.is_private and not ip.is_loopback and address not in result:
            result.append(address)
    return result


@router.get("/network/addresses")
def network_addresses(user: User = Depends(get_current_user)):
    """Addresses classmates on the same network can use (for invite links opened from localhost)."""
    return {"addresses": _lan_addresses()}


@router.post("")
async def create_room(request: CreateRoomRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = Room(id=uuid.uuid4().hex, name=request.name.strip(), invite_code=new_invite_code(db), owner_id=user.id, created_at=now_ms())
    db.add(room)
    db.add(RoomMember(id=uuid.uuid4().hex, room_id=room.id, user_id=user.id, role="owner", joined_at=now_ms()))
    db.commit()
    db.refresh(room)
    add_message(db, room.id, f"{user.name} created the room.", kind="system")
    return room_detail(db, room, user)


@router.get("")
def list_rooms(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rooms = db.query(Room).join(RoomMember, RoomMember.room_id == Room.id).filter(RoomMember.user_id == user.id).all()
    summaries = [room_summary(db, room, user) for room in rooms]
    return sorted(summaries, key=lambda r: -(r["last_message"]["created_at"] if r["last_message"] else r["created_at"]))


@router.get("/invite/{code}")
def preview_invite(code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """What an invite link points to (shown before joining)."""
    room = db.query(Room).filter(Room.invite_code == code.lower().strip()).first()
    if not room:
        raise HTTPException(status_code=404, detail="This invite link is invalid or has been reset.")
    owner = db.query(User).filter(User.id == room.owner_id).first()
    return {
        "id": room.id,
        "name": room.name,
        "owner_name": owner.name if owner else "",
        "member_count": len(room.members),
        "already_member": get_membership(db, room.id, user.id) is not None,
    }


@router.post("/join/{code}")
async def join_room(code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.invite_code == code.lower().strip()).first()
    if not room:
        raise HTTPException(status_code=404, detail="This invite link is invalid or has been reset.")
    if not get_membership(db, room.id, user.id):
        db.add(RoomMember(id=uuid.uuid4().hex, room_id=room.id, user_id=user.id, role="member", joined_at=now_ms()))
        db.commit()
        await post_system(db, room.id, f"{user.name} joined the room.")
        await broadcast_room_update(db, room)
    db.refresh(room)
    return room_detail(db, room, user)


@router.get("/{room_id}")
def get_room(room_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room, _ = get_room_for_member(db, user, room_id)
    return room_detail(db, room, user)


@router.patch("/{room_id}")
async def rename_room(room_id: str, request: RenameRoomRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room, membership = get_room_for_member(db, user, room_id)
    require_owner(membership)
    room.name = request.name.strip()
    db.commit()
    await post_system(db, room.id, f"{user.name} renamed the room to \"{room.name}\".")
    await broadcast_room_update(db, room)
    return room_detail(db, room, user)


@router.delete("/{room_id}")
async def delete_room(room_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room, membership = get_room_for_member(db, user, room_id)
    require_owner(membership)
    await cancel_battle(room.id)
    await manager.close_room(room.id, reason="The room was deleted by its owner.")
    from models import ChallengeAttempt, RoomChallenge
    challenge_ids = [cid for (cid,) in db.query(RoomChallenge.id).filter(RoomChallenge.room_id == room.id).all()]
    if challenge_ids:
        db.query(ChallengeAttempt).filter(ChallengeAttempt.challenge_id.in_(challenge_ids)).delete(synchronize_session=False)
        db.query(RoomChallenge).filter(RoomChallenge.room_id == room.id).delete(synchronize_session=False)
    db.delete(room)
    db.commit()
    return {"message": "Room deleted"}


@router.post("/{room_id}/invite/reset")
def reset_invite(room_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """New invite code (old links stop working)."""
    room, membership = get_room_for_member(db, user, room_id)
    require_owner(membership)
    room.invite_code = new_invite_code(db)
    db.commit()
    return room_detail(db, room, user)


@router.post("/{room_id}/leave")
async def leave_room(room_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room, membership = get_room_for_member(db, user, room_id)
    if membership.role == "owner":
        raise HTTPException(status_code=400, detail="The owner can't leave the room. Delete it instead.")
    _remove_member(db, room, user.id)
    await manager.close_room(room.id, user.id, reason="You left the room.")
    await post_system(db, room.id, f"{user.name} left the room.")
    await broadcast_room_update(db, room)
    await broadcast_presence(room.id)
    return {"message": "Left the room"}


@router.delete("/{room_id}/members/{member_id}")
async def remove_member(room_id: str, member_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room, membership = get_room_for_member(db, user, room_id)
    require_owner(membership)
    if member_id == user.id:
        raise HTTPException(status_code=400, detail="You can't remove yourself.")
    target = get_membership(db, room.id, member_id)
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    name = target.user.name if target.user else "A member"
    _remove_member(db, room, member_id)
    await manager.close_room(room.id, member_id, reason="You were removed from the room.")
    await post_system(db, room.id, f"{name} was removed from the room.")
    await broadcast_room_update(db, room)
    await broadcast_presence(room.id)
    return {"message": "Member removed"}


def _remove_member(db: Session, room: Room, user_id: str) -> None:
    """Remove a member and unshare the documents they shared (they stay private to them)."""
    db.query(RoomDocument).filter(RoomDocument.room_id == room.id, RoomDocument.shared_by == user_id).delete()
    db.query(RoomMember).filter(RoomMember.room_id == room.id, RoomMember.user_id == user_id).delete()
    db.commit()


@router.post("/{room_id}/documents")
async def share_document(room_id: str, request: ShareDocumentRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room, _ = get_room_for_member(db, user, room_id)
    document = get_user_document(db, user, request.document_id)
    if not db.query(RoomDocument).filter(RoomDocument.room_id == room.id, RoomDocument.document_id == document.id).first():
        db.add(RoomDocument(id=uuid.uuid4().hex, room_id=room.id, document_id=document.id, shared_by=user.id, shared_at=now_ms()))
        db.commit()
        await post_system(db, room.id, f"{user.name} shared \"{document.title}\" with the room.")
        await broadcast_room_update(db, room)
    db.refresh(room)
    return room_detail(db, room, user)


@router.delete("/{room_id}/documents/{share_id}")
async def unshare_document(room_id: str, share_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room, membership = get_room_for_member(db, user, room_id)
    share = db.query(RoomDocument).filter(RoomDocument.id == share_id, RoomDocument.room_id == room.id).first()
    if not share:
        raise HTTPException(status_code=404, detail="Shared document not found")
    if share.shared_by != user.id and membership.role != "owner":
        raise HTTPException(status_code=403, detail="Only the person who shared it (or the owner) can remove it.")
    title = share.document.title if share.document else "a document"
    db.delete(share)
    db.commit()
    await post_system(db, room.id, f"{user.name} removed \"{title}\" from the room.")
    await broadcast_room_update(db, room)
    db.refresh(room)
    return room_detail(db, room, user)


@router.get("/{room_id}/messages")
def list_messages(
    room_id: str,
    before: Optional[int] = None,
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Message history, newest page first (returned oldest -> newest)."""
    room, _ = get_room_for_member(db, user, room_id)
    query = db.query(RoomMessage).filter(RoomMessage.room_id == room.id)
    if before:
        query = query.filter(RoomMessage.created_at < before)
    messages = query.order_by(RoomMessage.created_at.desc()).limit(limit).all()
    return [message_out(m) for m in reversed(messages)]


# ---------------------------------------------------------------------------
# WebSocket: chat, typing, presence, AI moderator, quiz battles
# ---------------------------------------------------------------------------

@router.websocket("/{room_id}/ws")
async def room_socket(websocket: WebSocket, room_id: str, token: str = ""):
    """
    Client -> server events:
      {"type": "message", "text": "...", "ask_ai": bool}   (or mention @MindAI)
      {"type": "typing"}
      {"type": "quiz_start", "count": 5}   {"type": "quiz_answer", "index": 0, "option": 2}   {"type": "quiz_cancel"}
    Server -> client events: hello, presence, message, typing, ai_start/ai_delta/ai_done,
      quiz_preparing/quiz_question/quiz_reveal/quiz_end/quiz_cancelled/quiz_error, room_updated, removed, error
    """
    db = SessionLocal()
    try:
        user = user_from_token(db, token) if token else None
        membership = get_membership(db, room_id, user.id) if user else None
        # Accept before closing so the client receives the reason code (4401 sign in again, 4403 not a member)
        await websocket.accept()
        if user is None:
            await websocket.close(code=4401, reason="Please sign in again.")
            return
        if membership is None:
            await websocket.close(code=4403, reason="You are not a member of this room.")
            return
        user_id, user_name, brief = user.id, user.name, user_brief(user)
    finally:
        db.close()

    first = await manager.connect(room_id, user_id, websocket)
    await manager.send(websocket, {"type": "hello", "online": manager.online_user_ids(room_id), "me": brief})
    if first:
        await broadcast_presence(room_id)
    battle = active_battle(room_id)
    if battle and battle.index >= 0 and battle.deadline > 0:
        await manager.send(websocket, battle.question_event())

    try:
        while True:
            event = await websocket.receive_json()
            kind = event.get("type") if isinstance(event, dict) else None

            if kind == "typing":
                await manager.broadcast(room_id, {"type": "typing", "user": brief}, exclude=websocket)

            elif kind == "message":
                text = str(event.get("text") or "").strip()[:MAX_MESSAGE_CHARS]
                if not text:
                    continue
                if not manager.allow_message(user_id):
                    await manager.send(websocket, {"type": "error", "detail": "You're sending messages too quickly. Slow down a little."})
                    continue
                db = SessionLocal()
                try:
                    if get_membership(db, room_id, user_id) is None:  # Removed meanwhile
                        break
                    message = add_message(db, room_id, text, kind="user", user_id=user_id)
                    payload = message_out(message)
                finally:
                    db.close()
                await manager.broadcast(room_id, {"type": "message", "message": payload})
                # Who should answer: a chosen/mentioned AI classmate, or the MindAI moderator
                personas = [PERSONA_BY_NAME[m.lower()] for m in PERSONA_MENTION.findall(text)]
                if event.get("persona") in PERSONA_BY_NAME.values():
                    personas.insert(0, event["persona"])
                personas = list(dict.fromkeys(personas))[:2]
                question = PERSONA_MENTION.sub("", AI_MENTION.sub("", text)).strip() or text
                for persona_id in personas:
                    asyncio.create_task(run_ai_answer(room_id, question, user_name, persona_id))
                if not personas and (event.get("ask_ai") or AI_MENTION.search(text)):
                    asyncio.create_task(run_ai_answer(room_id, question, user_name))

            elif kind == "quiz_start":
                count = min(max(int(event.get("count") or 5), 3), 10)
                db = SessionLocal()
                try:
                    starter = db.query(User).filter(User.id == user_id).first()
                finally:
                    db.close()

                async def launch():
                    try:
                        await start_battle(room_id, starter, count)
                    except ValueError as e:
                        await manager.send(websocket, {"type": "quiz_error", "detail": str(e)})
                asyncio.create_task(launch())

            elif kind == "quiz_answer":
                battle = active_battle(room_id)
                if battle is None:
                    continue
                db = SessionLocal()
                try:
                    answering = db.query(User).filter(User.id == user_id).first()
                finally:
                    db.close()
                error = battle.submit(answering, int(event.get("index", -1)), int(event.get("option", -1)))
                if error:
                    await manager.send(websocket, {"type": "quiz_error", "detail": error})
                else:
                    await manager.broadcast(room_id, {"type": "quiz_answered", "user": brief, "answered": len(battle.answers), "index": battle.index})

            elif kind == "quiz_cancel":
                battle = active_battle(room_id)
                db = SessionLocal()
                try:
                    member = get_membership(db, room_id, user_id)
                finally:
                    db.close()
                if battle and member and (member.role == "owner" or (battle.started_by or {}).get("id") == user_id):
                    await cancel_battle(room_id)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Room socket error: {e}")
    finally:
        if manager.disconnect(room_id, user_id, websocket):
            await broadcast_presence(room_id)

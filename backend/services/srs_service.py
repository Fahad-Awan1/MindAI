"""
Spaced repetition for flashcards, based on SM-2 (with Anki-style ease adjustments).

Each card in a deck has a CardState with an ease factor, interval and due date.
Rating a card moves its due date: "Again" brings it back in 10 minutes, the other
ratings push it out by a growing number of days.
"""
import json
import uuid
from dataclasses import dataclass
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from models import CardState, StudySet
from schemas import CardSchedule, DueCard, DueQueue

DAY_MS = 24 * 60 * 60 * 1000
AGAIN_DELAY_MS = 10 * 60 * 1000  # "Again" cards come back after 10 minutes
DEFAULT_EASE = 2.5
MIN_EASE = 1.3
RATINGS = ("again", "hard", "good", "easy")
EASE_DELTA = {"again": -0.20, "hard": -0.15, "good": 0.0, "easy": 0.15}
NEW_CARDS_PER_REVIEW = 10


@dataclass
class SrsState:
    ease: float = DEFAULT_EASE
    interval_days: float = 0
    repetitions: int = 0
    lapses: int = 0


def next_state(state: SrsState, rating: str) -> SrsState:
    """Return the card's state after a review with the given rating."""
    ease = max(MIN_EASE, state.ease + EASE_DELTA[rating])

    if rating == "again":
        return SrsState(ease=ease, interval_days=0, repetitions=0, lapses=state.lapses + 1)

    if state.repetitions == 0:
        interval = {"hard": 1, "good": 1, "easy": 4}[rating]
    elif state.repetitions == 1:
        interval = {"hard": 3, "good": 6, "easy": 8}[rating]
    else:
        previous = max(state.interval_days, 1)
        interval = {
            "hard": max(previous + 1, previous * 1.2),
            "good": max(previous + 1, previous * state.ease),
            "easy": max(previous + 1, previous * state.ease * 1.3),
        }[rating]

    return SrsState(
        ease=round(ease, 2),
        interval_days=float(round(interval)),
        repetitions=state.repetitions + 1,
        lapses=state.lapses,
    )


def due_at_after(rating: str, interval_days: float, now: int) -> int:
    if rating == "again" or interval_days <= 0:
        return now + AGAIN_DELAY_MS
    return now + int(interval_days * DAY_MS)


def preview_intervals(state: SrsState) -> Dict[str, float]:
    """Interval each rating would give (0 = again this session) - shown on the rating buttons."""
    return {rating: next_state(state, rating).interval_days for rating in RATINGS}


def _state_of(row: Optional[CardState]) -> SrsState:
    if row is None:
        return SrsState()
    return SrsState(ease=row.ease, interval_days=row.interval_days, repetitions=row.repetitions, lapses=row.lapses)


def card_schedule(card_index: int, row: Optional[CardState]) -> CardSchedule:
    state = _state_of(row)
    return CardSchedule(
        card_index=card_index,
        is_new=row is None,
        due_at=row.due_at if row else None,
        interval_days=state.interval_days,
        ease=state.ease,
        repetitions=state.repetitions,
        lapses=state.lapses,
        last_rating=row.last_rating if row else None,
        next_intervals=preview_intervals(state),
    )


def deck_schedule(study_set: StudySet) -> List[CardSchedule]:
    cards = json.loads(study_set.data)
    rows = {row.card_index: row for row in study_set.card_states}
    return [card_schedule(i, rows.get(i)) for i in range(len(cards))]


def apply_reviews(db: Session, study_set: StudySet, ratings: List[Dict], now: int) -> None:
    """Update card states for a list of {card_index, rating} reviews (in the order given)."""
    card_count = len(json.loads(study_set.data))
    rows = {row.card_index: row for row in study_set.card_states}

    for review in ratings:
        index, rating = review["card_index"], review["rating"]
        if index >= card_count:
            raise ValueError(f"Card {index} does not exist in this deck")

        row = rows.get(index)
        if row is None:
            row = CardState(
                id=uuid.uuid4().hex,
                study_set_id=study_set.id,
                document_id=study_set.document_id,
                card_index=index,
                # Column defaults only apply on INSERT, so set the starting state explicitly
                ease=DEFAULT_EASE,
                interval_days=0,
                repetitions=0,
                lapses=0,
                due_at=now,
            )
            db.add(row)
            study_set.card_states.append(row)
            rows[index] = row

        new_state = next_state(_state_of(row), rating)
        row.ease = new_state.ease
        row.interval_days = new_state.interval_days
        row.repetitions = new_state.repetitions
        row.lapses = new_state.lapses
        row.due_at = due_at_after(rating, new_state.interval_days, now)
        row.last_reviewed_at = now
        row.last_rating = rating

    db.commit()


def _user_decks(db: Session, user_id: str):
    return db.query(StudySet).filter(StudySet.kind == "flashcards", StudySet.user_id == user_id)


def due_counts(db: Session, user_id: str, now: int, end_of_today: int) -> Dict[str, int]:
    """The user's cards due now, due by the end of today, and never-reviewed (new) cards."""
    states = db.query(CardState).join(StudySet, CardState.study_set_id == StudySet.id).filter(StudySet.user_id == user_id)
    due_now = states.filter(CardState.due_at <= now).count()
    due_today = states.filter(CardState.due_at <= end_of_today).count()

    new_cards = 0
    for study_set in _user_decks(db, user_id).all():
        new_cards += len(json.loads(study_set.data)) - len(study_set.card_states)
    return {"due_now": due_now, "due_today": due_today, "new": max(new_cards, 0)}


def due_queue(db: Session, user_id: str, now: int, new_limit: int = NEW_CARDS_PER_REVIEW, limit: int = 100) -> DueQueue:
    """Cards to review now across the user's decks: overdue cards first, then some new cards."""
    decks = _user_decks(db, user_id).order_by(StudySet.created_at.desc()).all()

    due: List[DueCard] = []
    new: List[DueCard] = []
    new_total = 0
    for deck in decks:
        cards = json.loads(deck.data)
        rows = {row.card_index: row for row in deck.card_states}
        for index, card in enumerate(cards):
            row = rows.get(index)
            if row is None:
                new_total += 1
            elif row.due_at > now:
                continue
            entry = DueCard(
                study_set_id=deck.id,
                study_set_title=deck.title,
                document_id=deck.document_id,
                document_title=deck.document.title if deck.document else "",
                card_index=index,
                front=card.get("front", ""),
                back=card.get("back", ""),
                schedule=card_schedule(index, row),
            )
            (new if row is None else due).append(entry)

    due.sort(key=lambda c: c.schedule.due_at or 0)
    cards = (due + new[:new_limit])[:limit]
    return DueQueue(due_count=len(due), new_count=new_total, cards=cards)

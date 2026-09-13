"""Pure learner-facing projections of the tutor's diagnostic records."""

from __future__ import annotations

from collections.abc import Iterable

from app.mastery.misconceptions import learner_note_for
from app.services.events import CogniEvent, EventType


def learner_notes(recorded: Iterable[str]) -> list[str]:
    """Map persisted pattern labels to unique learner notes in their original order."""
    notes: list[str] = []
    seen: set[str] = set()
    for value in recorded:
        note = learner_note_for(value)
        if note is not None and note not in seen:
            notes.append(note)
            seen.add(note)
    return notes


def learner_activity(events: Iterable[CogniEvent], limit: int = 40) -> list[dict]:
    """Project the audit log into a learner-safe activity trail.

    This is an allowlist rather than a denylist so a newly added payload key cannot
    cross the boundary and leak to learners by default. Every visible value is selected
    explicitly because it explains the tutoring experience without exposing internals.
    """
    activity: list[dict] = []
    for event in events:
        payload = event.payload
        item: dict | None = None

        if event.event_type == EventType.GENERATED:
            item = {
                "type": "generated",
                "skill": str(payload.get("skill") or ""),
                "title": str(payload.get("title") or ""),
                "difficulty": str(payload.get("difficulty") or ""),
            }
        elif event.event_type == EventType.EXECUTION:
            score = float(payload.get("score") or 0.0)
            item = {
                "type": "execution",
                "passed": bool(payload.get("passed")),
                "score": max(0.0, min(1.0, score)),
            }
        elif event.event_type == EventType.MISCONCEPTION:
            if "resolved" in payload:
                item = {
                    "type": "resolved",
                    "skill": str(payload.get("skill") or ""),
                    "count": int(payload.get("resolved") or 0),
                }
            elif payload.get("source") == "deterministic":
                note = learner_note_for(str(payload.get("misconception") or ""))
                if note is not None:
                    item = {
                        "type": "misconception",
                        "skill": str(payload.get("skill") or ""),
                        "note": note,
                    }
        elif event.event_type == EventType.MASTERY:
            attributed = payload.get("attributed_from")
            item = {
                "type": "mastery",
                "skill": str(payload.get("skill") or ""),
                "before": float(payload.get("before") or 0.0),
                "after": float(payload.get("after") or 0.0),
                "attributed_from": str(attributed) if attributed is not None else None,
            }
        elif event.event_type == EventType.ADAPTATION:
            item = {
                "type": "adaptation",
                "skill": str(payload.get("target_skill") or ""),
                "action": str(payload.get("action") or ""),
            }
        elif event.event_type == EventType.PREREQ_REDIRECT:
            item = {
                "type": "prereq_redirect",
                "from_skill": str(payload.get("from_skill") or ""),
                "to_skill": str(payload.get("to_skill") or ""),
            }
        elif event.event_type == EventType.PREREQ_RETURN:
            item = {
                "type": "prereq_return",
                "skill": str(payload.get("returning_to") or ""),
            }
        elif event.event_type == EventType.RECOVERY:
            item = {"type": "recovery"}
        elif event.event_type == EventType.SESSION_END:
            item = {"type": "session_end"}

        if item is not None:
            activity.append(item)

    if limit <= 0:
        return []
    return activity[-limit:]

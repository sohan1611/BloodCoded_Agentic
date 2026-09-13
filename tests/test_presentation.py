"""Learner-safe projections of persisted notes and the graph event trail."""

from __future__ import annotations

import json
from pathlib import Path

from langgraph.types import Command

from app.api.presentation import learner_activity, learner_notes
from app.graph.builder import build_graph
from app.graph.deps import GraphDeps
from app.graph.state import initial_state
from app.llm.stub import StubCaller
from app.mastery.misconceptions import PATTERNS, learner_note_for
from app.mastery.skill_graph import SkillGraph
from app.models.schemas import MisconceptionAnalysis
from app.services.events import CogniEvent, EventLog, EventType
from app.services.student_store import StudentStore


SKILLS = Path("app/config/skills.yaml")
ACTIVITY_KEYS = {
    "generated": {"type", "skill", "title", "difficulty"},
    "execution": {"type", "passed", "score"},
    "misconception": {"type", "skill", "note"},
    "resolved": {"type", "skill", "count"},
    "mastery": {"type", "skill", "before", "after", "attributed_from"},
    "adaptation": {"type", "skill", "action"},
    "prereq_redirect": {"type", "from_skill", "to_skill"},
    "prereq_return": {"type", "skill"},
    "recovery": {"type"},
    "session_end": {"type"},
}


def test_learner_note_for_maps_only_reviewed_pattern_labels() -> None:
    for pattern in PATTERNS:
        assert learner_note_for(pattern.label) == pattern.student_note

    assert learner_note_for("The student believes x") is None
    assert learner_note_for("unresolved difficulty with loops") is None


def test_learner_notes_deduplicates_in_order_and_drops_unmapped_values() -> None:
    first, second = PATTERNS[:2]

    assert learner_notes(
        [
            first.label,
            "The student believes x",
            second.label,
            first.label,
            "unresolved difficulty with loops",
        ]
    ) == [first.student_note, second.student_note]


def test_real_graph_activity_never_exposes_engine_diagnostics(tmp_path: Path) -> None:
    store = StudentStore(tmp_path / "presentation.db")
    store.seed("learner", SkillGraph.from_yaml(SKILLS).nodes)
    events = EventLog()
    model_analysis = MisconceptionAnalysis(
        misconception="The student believes the loop needs indexing",
        evidence=["the output did not match"],
        confidence=0.8,
    )
    caller = StubCaller(name="stub", default=model_analysis.model_dump())
    graph = build_graph(GraphDeps.offline(store, events, caller=caller))
    cfg = {"configurable": {"thread_id": "presentation"}}

    graph.invoke(
        initial_state("learner", "presentation", target_skill="recursion"),
        cfg,
    )
    graph.invoke(Command(resume={"code": "print('wrong')"}), cfg)
    graph.invoke(Command(resume={"code": "print(12)"}), cfg)

    visible = learner_activity(events.events)
    encoded = json.dumps(visible)
    forbidden = (
        "The student",
        "believe",
        "stub",
        "fallback",
        "provider",
        "source",
        "problem_id",
        "execute_and_grade",
        "analyze_misconception",
        "update_mastery",
        "teaching_mode",
        "degraded",
        "reason",
    )
    for value in forbidden:
        assert value not in encoded
    for event in events.of_type(EventType.GENERATED):
        assert str(event.payload["problem_id"]) not in encoded
    for item in visible:
        assert set(item) == ACTIVITY_KEYS[item["type"]]


def test_only_deterministic_misconceptions_with_known_labels_are_visible() -> None:
    pattern = next(pattern for pattern in PATTERNS if pattern.key == "name_error")
    base_payload = {
        "skill": "variables",
        "misconception": pattern.label,
    }
    deterministic = CogniEvent(
        node="analyze_misconception",
        event_type=EventType.MISCONCEPTION,
        payload={**base_payload, "source": "deterministic"},
    )
    model = CogniEvent(
        node="analyze_misconception",
        event_type=EventType.MISCONCEPTION,
        payload={**base_payload, "source": "groq"},
    )

    assert learner_activity([deterministic]) == [
        {
            "type": "misconception",
            "skill": "variables",
            "note": pattern.student_note,
        }
    ]
    assert learner_activity([model]) == []

"""Regression tests for the learner-feedback boundary in the real graph node."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.graph.deps import GraphDeps
from app.graph.nodes import make_analyze_misconception
from app.llm.stub import ScriptedFailure, StubCaller
from app.mastery.misconceptions import PATTERNS, student_note_for
from app.models.enums import StudentOutcome
from app.models.schemas import SkillNode
from app.services.events import EventLog, EventType
from app.services.student_store import StudentStore


MODEL_SENTENCE = (
    "The student believes they must use a loop to retrieve the first element, "
    "rather than accessing it directly with indexing."
)

SUM_LIST_CODE = """\
def sum_list(numbers):
    if not numbers:
        return 0
    dummy_sum = 0
    for x in numbers[:1]:
        dummy_sum += x
    return dummy_sum + sum_list(numbers[1:])
"""

MODEL_ANALYSIS = {
    "misconception": MODEL_SENTENCE,
    "evidence": ["code:loop"],
    "likely_prerequisite_gap": "loops",
    "confidence": 0.8,
}


def _setup(
    tmp_path: Path,
    caller: StubCaller,
    *,
    outcome: StudentOutcome = StudentOutcome.WRONG_ANSWER,
    code: str = SUM_LIST_CODE,
    stdout: str = "1",
    stderr: str = "",
    feedback: str = "",
    misconceptions: list[str] | None = None,
    detected: list[dict[str, Any]] | None = None,
) -> tuple[GraphDeps, dict[str, Any]]:
    student_id = "learner-1"
    skill = SkillNode(
        skill="recursion",
        misconceptions=list(misconceptions or []),
    )
    store = StudentStore(tmp_path / "w.db")
    store.ensure_student(student_id)
    store.save_skill(student_id, skill)
    events = EventLog()
    deps = GraphDeps.offline(store, events, caller=caller)
    state: dict[str, Any] = {
        "error_type": outcome.value,
        "target_skill": "recursion",
        "student_code": code,
        "execution_result": {"stdout": stdout, "stderr": stderr},
        "grader_result": {
            "passed": False,
            "score": 0.0,
            "feedback": feedback,
            "failing_case": "sum-case",
        },
        "current_problem": {
            "test_cases": [
                {
                    "name": "sum-case",
                    "stdin": "",
                    "expected_output": "6",
                }
            ],
            "expected_output": "6",
        },
        "skill_graph": {"recursion": skill.model_dump(mode="json")},
        "student_id": student_id,
        "session_id": "session-1",
        "detected_misconceptions": list(detected or []),
    }
    return deps, state


def test_model_working_note_never_becomes_learner_feedback(tmp_path: Path) -> None:
    caller = StubCaller(name="stub", default=MODEL_ANALYSIS)
    deps, state = _setup(tmp_path, caller)

    patch = make_analyze_misconception(deps)(state)  # type: ignore[arg-type]

    feedback = patch["grader_result"]["feedback"]
    for leaked in ("The student", "believe", "indexing"):
        assert leaked not in feedback
    assert feedback.endswith("?")

    event = deps.events.of_type(EventType.MISCONCEPTION)[-1]
    assert event.payload["misconception"] == MODEL_SENTENCE
    assert patch["detected_misconceptions"][-1]["misconception"] == MODEL_SENTENCE
    assert (
        MODEL_SENTENCE
        in deps.store.load_skills(state["student_id"])["recursion"].misconceptions
    )
    assert patch["attribution_hint"] is None


def test_deterministic_match_never_consults_the_model(tmp_path: Path) -> None:
    caller = StubCaller(name="stub", default=MODEL_ANALYSIS)
    code = "print(x)"
    error = "NameError: name 'x' is not defined"
    deps, state = _setup(
        tmp_path,
        caller,
        outcome=StudentOutcome.STUDENT_RUNTIME_ERROR,
        code=code,
        stdout="",
        stderr=error,
        feedback=error,
    )

    patch = make_analyze_misconception(deps)(state)  # type: ignore[arg-type]

    name_error = next(pattern for pattern in PATTERNS if pattern.key == "name_error")
    assert patch["grader_result"]["feedback"] == student_note_for(name_error, code)
    assert caller.call_count == 0


def test_provider_outage_is_audit_only_not_a_learner_diagnosis(
    tmp_path: Path,
) -> None:
    caller = StubCaller(name="stub", default=ScriptedFailure("down"))
    original_detected = [
        {
            "skill": "recursion",
            "misconception": "an existing diagnosis",
            "implicates": None,
            "confidence": 0.7,
        }
    ]
    deps, state = _setup(
        tmp_path,
        caller,
        misconceptions=["an existing diagnosis"],
        detected=original_detected,
    )

    patch = make_analyze_misconception(deps)(state)  # type: ignore[arg-type]

    feedback = patch["grader_result"]["feedback"]
    persisted = deps.store.load_skills(state["student_id"])["recursion"]
    resulting_detected = patch.get(
        "detected_misconceptions", state["detected_misconceptions"]
    )
    assert "unresolved difficulty" not in feedback
    assert all("unresolved difficulty" not in item for item in persisted.misconceptions)
    assert resulting_detected == original_detected
    assert "skill_graph" not in patch
    event = deps.events.of_type(EventType.MISCONCEPTION)[-1]
    assert event.payload["source"] == "fallback"
    assert feedback.endswith("?")


def test_model_prompt_contains_the_failing_test_evidence(tmp_path: Path) -> None:
    caller = StubCaller(name="stub", default=MODEL_ANALYSIS)
    deps, state = _setup(tmp_path, caller, stdout="1")

    make_analyze_misconception(deps)(state)  # type: ignore[arg-type]

    _, messages = caller.calls[0]
    system_message = next(
        message["content"] for message in messages if message["role"] == "system"
    )
    user_message = next(
        message["content"] for message in messages if message["role"] == "user"
    )
    assert "evidence is insufficient" in system_message
    assert "Failing test: sum-case" in user_message
    assert "Expected output:\n6" in user_message
    assert "Actual output:\n1" in user_message

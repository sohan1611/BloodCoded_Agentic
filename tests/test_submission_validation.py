"""Blank submission validation at the shared boundary and through the real graph."""

from pathlib import Path

from langgraph.types import Command

from app.graph.builder import build_graph, route_submission
from app.graph.deps import GraphDeps
from app.graph.state import initial_state
from app.mastery.skill_graph import SkillGraph
from app.models.submission import EMPTY_SUBMISSION_MESSAGE, is_blank_submission
from app.services.events import EventLog, EventType
from app.services.student_store import StudentStore


SKILLS = Path("app/config/skills.yaml")


def _store(tmp_path: Path) -> StudentStore:
    store = StudentStore(tmp_path / "students.db")
    store.seed("s1", SkillGraph.from_yaml(SKILLS).nodes)
    return store


def _skill_dump(store: StudentStore) -> dict[str, dict]:
    return {
        skill: node.model_dump()
        for skill, node in store.load_skills("s1").items()
    }


def test_is_blank_submission_uses_whitespace_only_for_the_decision() -> None:
    for code in ("", None, " ", "\n\t", "\r\n", "\u00a0"):
        assert is_blank_submission(code) is True

    for code in ("print(1)", "    x = 1"):
        assert is_blank_submission(code) is False


def test_client_and_server_use_the_same_blank_submission_message() -> None:
    """The client and server must say the same sentence, and nothing else ties the two files together."""
    client_source = (
        Path(__file__).parents[1] / "web" / "lib" / "submission.ts"
    ).read_text(encoding="utf-8")
    assert EMPTY_SUBMISSION_MESSAGE in client_source


def test_route_submission_waits_only_when_code_and_answer_are_blank() -> None:
    assert route_submission({"student_code": "", "student_answer": None}) == "await_student"
    assert route_submission({"student_code": "print(1)", "student_answer": None}) == (
        "execute_and_grade"
    )
    assert route_submission({"student_code": " ", "student_answer": "answer"}) == (
        "execute_and_grade"
    )


def test_blank_resumes_leave_the_real_graph_and_student_record_unchanged(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    events = EventLog()
    app = build_graph(GraphDeps.offline(store, events))
    cfg = {"configurable": {"thread_id": "blank-resumes"}}

    app.invoke(initial_state("s1", "blank-resumes", target_skill="recursion"), cfg)
    baseline_snapshot = app.get_state(cfg)
    baseline_event_count = len(events.events)
    baseline_attempt_count = baseline_snapshot.values["attempt_count"]
    baseline_problem_id = baseline_snapshot.values["current_problem_id"]
    baseline_attempts = store.attempts_for("s1")
    baseline_skills = _skill_dump(store)
    forbidden = {
        EventType.SUBMISSION,
        EventType.EXECUTION,
        EventType.GRADE,
        EventType.MISCONCEPTION,
        EventType.MASTERY,
        EventType.ADAPTATION,
        EventType.GENERATED,
    }

    for code in ("", "   ", "\n\t  \n"):
        app.invoke(Command(resume={"code": code}), cfg)
        snapshot = app.get_state(cfg)

        assert snapshot.next == ("await_student",)
        assert snapshot.values["attempt_count"] == baseline_attempt_count
        assert snapshot.values["current_problem_id"] == baseline_problem_id
        assert store.attempts_for("s1") == baseline_attempts
        assert _skill_dump(store) == baseline_skills
        assert not {
            event.event_type for event in events.events[baseline_event_count:]
        } & forbidden

    result = app.invoke(Command(resume={"code": "print(12)"}), cfg)
    assert result["attempt_count"] == 1
    assert events.of_type(EventType.MASTERY), "the non-blank submission must be graded"


def test_blank_resume_cannot_regrade_the_previous_wrong_answer(tmp_path: Path) -> None:
    store = _store(tmp_path)
    events = EventLog()
    app = build_graph(GraphDeps.offline(store, events))
    cfg = {"configurable": {"thread_id": "stale-code"}}

    app.invoke(initial_state("s1", "stale-code", target_skill="recursion"), cfg)
    app.invoke(Command(resume={"code": "print('wrong')"}), cfg)
    # Grading is recorded as EXECUTION; no node emits EventType.GRADE, so counting that
    # would compare 0 with 0 and prove nothing.
    grade_count = len(events.of_type(EventType.EXECUTION))
    assert grade_count >= 1, "the wrong answer must have been executed, or this proves nothing"
    attempt_count = len(store.attempts_for("s1"))

    app.invoke(Command(resume={"code": "   "}), cfg)

    assert len(events.of_type(EventType.EXECUTION)) == grade_count
    assert len(store.attempts_for("s1")) == attempt_count
    assert app.get_state(cfg).next == ("await_student",)

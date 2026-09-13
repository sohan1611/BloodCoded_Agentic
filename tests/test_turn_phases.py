"""Phased tutoring turns expose grades early without duplicating attempts."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langgraph.types import Command

import app.api.main as api
from app.api.main import SESSIONS, _at_breakpoint, _view, app
from app.services.student_store import StudentStore


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """A client whose writes land in a temporary database, never durable data."""
    db = tmp_path / "api.db"
    monkeypatch.setattr(api, "StudentStore", lambda *args, **kwargs: StudentStore(db))
    SESSIONS.clear()
    return TestClient(app)


def _start(client: TestClient, name: str) -> str:
    student_id = client.post("/session", json={"name": name}).json()["student_id"]
    response = client.post(
        f"/session/{student_id}/start",
        json={"name": name, "target_skill": "loops"},
    )
    assert response.status_code == 200
    return student_id


def _poll_for_phase(
    client: TestClient,
    student_id: str,
    phase: str,
    timeout: float = 30.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        view = client.get(f"/session/{student_id}").json()
        if view["phase"] == phase:
            return view
        time.sleep(0.1)
    pytest.fail(f"session {student_id!r} did not reach phase {phase!r}")


def _exercise_rows(student_id: str) -> list[dict[str, Any]]:
    return [
        row
        for row in SESSIONS[student_id].store.attempts_for(student_id)
        if row["attributed_from"] is None
    ]


def test_non_phased_submit_remains_synchronous(client: TestClient) -> None:
    student_id = _start(client, "Synchronous")

    response = client.post(
        f"/session/{student_id}/submit",
        json={"code": "print('wrong')"},
    )

    assert response.status_code == 200
    assert response.json()["phase"] == "idle"
    assert len(_exercise_rows(student_id)) == 1


def test_phased_submit_returns_grade_then_finishes_once(client: TestClient) -> None:
    student_id = _start(client, "Phased")

    response = client.post(
        f"/session/{student_id}/submit",
        json={"code": "print('wrong')", "phased": True},
    )

    assert response.status_code == 200
    graded = response.json()
    assert graded["feedback"] is not None
    assert graded["feedback"]["passed"] is False
    assert graded["awaiting_student"] is False
    assert graded["phase"] == "updating"

    settled = _poll_for_phase(client, student_id, "idle")
    assert settled["awaiting_student"] is True
    assert len(_exercise_rows(student_id)) == 1


def test_duplicate_submit_is_rejected_before_writing(client: TestClient) -> None:
    student_id = _start(client, "Duplicate")
    session = SESSIONS[student_id]
    session.lock.acquire()
    try:
        response = client.post(
            f"/session/{student_id}/submit",
            json={"code": "print('wrong')", "phased": True},
        )
    finally:
        session.lock.release()

    assert response.status_code == 409
    assert response.json()["detail"] == "We're still checking your last answer."
    assert _exercise_rows(student_id) == []


class _FailOnceOnContinue:
    def __init__(self, graph: Any) -> None:
        self.graph = graph
        self.failed = False

    def invoke(self, value: Any, config: Any, *args: Any, **kwargs: Any) -> Any:
        if value is None and not self.failed:
            self.failed = True
            raise RuntimeError("post-grade worker failed")
        return self.graph.invoke(value, config, *args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.graph, name)


def test_worker_failure_can_continue_without_a_second_attempt(
    client: TestClient,
) -> None:
    student_id = _start(client, "Worker Failure")
    session = SESSIONS[student_id]
    original_graph = session.graph
    session.graph = _FailOnceOnContinue(original_graph)

    response = client.post(
        f"/session/{student_id}/submit",
        json={"code": "print('wrong')", "phased": True},
    )
    assert response.status_code == 200

    failed = _poll_for_phase(client, student_id, "failed")
    assert failed["phase_error"] == (
        "We couldn't finish updating your plan. Your answer was saved."
    )
    assert session.lock.acquire(timeout=5), (
        "the worker must release the session lock after reporting failure"
    )
    session.lock.release()

    session.graph = original_graph
    continued = client.post(f"/session/{student_id}/continue")
    assert continued.status_code == 200
    settled = _poll_for_phase(client, student_id, "idle")
    assert settled["awaiting_student"] is True
    assert len(_exercise_rows(student_id)) == 1


def test_continue_at_learner_wait_changes_nothing(client: TestClient) -> None:
    student_id = _start(client, "Nothing Paused")
    before = client.get(f"/session/{student_id}").json()

    response = client.post(f"/session/{student_id}/continue")

    assert response.status_code == 200
    assert response.json() == before


def test_breakpoint_is_not_reported_as_awaiting_the_learner(
    client: TestClient,
) -> None:
    student_id = _start(client, "Breakpoint")
    session = SESSIONS[student_id]
    waiting = session.graph.get_state(session.cfg)
    assert _at_breakpoint(waiting) is False
    assert _view(session)["awaiting_student"] is True

    session.state = session.graph.invoke(
        Command(resume={"code": "print('wrong')"}),
        session.cfg,
        interrupt_after=["execute_and_grade"],
    )
    paused = session.graph.get_state(session.cfg)
    assert _at_breakpoint(paused) is True
    assert _view(session)["awaiting_student"] is False

    session.graph.invoke(None, session.cfg)

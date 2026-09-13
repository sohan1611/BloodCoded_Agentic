"""One learner, driven over HTTP through every contract in the production brief.

Each earlier test proves one slice. This one proves the slices agree: a blank click
changes nothing anywhere, one graded submission is one attempt on every screen,
confidence rises the documented way, no internal detail reaches the learner, a reload
resumes the same learner, and a duplicate submit is refused.

There is no browser automation in this repository, so the test drives the same HTTP
contract the web app uses, in the order the web app calls it. tests/conftest.py removes
provider keys for every test, so exercises come from the deterministic templates and the
correct answer can be built from the exercise's own expected output.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

import app.api.main as api
from app.api.main import SESSIONS, app
from app.mastery.evidence import coverage
from app.services.student_store import StudentStore
from tests.test_auth import USER_ID, _key_pair, _token, _verifier


CURRICULUM = [
    "variables",
    "conditionals",
    "loops",
    "functions",
    "function_call_tracing",
    "recursion",
    "recursion_tree",
    "nested_loops",
]
BLANK_MESSAGE = "Enter some code before submitting."
FORBIDDEN = (
    "The student",
    "believe",
    "stub",
    "groq",
    "gemini",
    "provider",
    "execute_and_grade",
    "analyze_misconception",
    "teaching_mode",
)
SUBMIT = f"/session/{USER_ID}/submit"


@pytest.fixture
def learner(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[TestClient, Path]:
    """A signed-in account whose data lands in a temporary database."""
    private_key, jwk, _ = _key_pair()
    db = tmp_path / "e2e.db"
    monkeypatch.setattr(api, "StudentStore", lambda *args, **kwargs: StudentStore(db))
    monkeypatch.setattr(api, "token_verifier", lambda: _verifier(jwk))
    SESSIONS.clear()
    client = TestClient(
        app, headers={"Authorization": f"Bearer {_token(private_key)}"}
    )
    return client, db


def _settle(client: TestClient, view: dict[str, Any]) -> dict[str, Any]:
    """Poll the tutor view the way the web app does until the turn has settled."""
    deadline = time.monotonic() + 30
    while view["phase"] == "updating":
        if time.monotonic() > deadline:
            pytest.fail(f"the turn did not settle within 30 s: {view}")
        time.sleep(0.1)
        view = client.get(f"/session/{USER_ID}").json()
    return view


def _screens(client: TestClient) -> tuple[dict, dict, dict]:
    return (
        client.get(f"/student/{USER_ID}/plan").json(),
        client.get(f"/student/{USER_ID}/progress").json(),
        client.get(f"/student/{USER_ID}/activity").json(),
    )


def _totals(client: TestClient) -> tuple[int, int, int, int, int, int]:
    """Every attempt counter a learner can see, on every screen that shows one."""
    plan, progress, activity = _screens(client)
    return (
        plan["total_attempts"],
        progress["total_attempts"],
        activity["total"],
        len(progress["recent_attempts"]),
        sum(skill["attempts"] for skill in plan["skills"]),
        sum(skill["attempts"] for skill in progress["skills"]),
    )


def _engine(key: str) -> Any:
    session = SESSIONS[USER_ID]
    return session.graph.get_state(session.cfg).values.get(key)


def _skill(payload: dict[str, Any], name: str) -> dict[str, Any]:
    return next(skill for skill in payload["skills"] if skill["skill"] == name)


def _assert_no_leak(payload: dict[str, Any], step: str) -> None:
    encoded = json.dumps(payload)
    for word in FORBIDDEN:
        assert word not in encoded, f"{step}: {word!r} reached the learner"
    problem_id = _engine("current_problem_id")
    if problem_id:
        assert str(problem_id) not in encoded, f"{step}: an internal problem id leaked"


def test_one_learner_through_the_whole_brief(
    learner: tuple[TestClient, Path],
) -> None:
    client, db = learner

    # 1. A new learner: nothing exists yet, and the roadmap opens on Variables.
    me = client.get("/me")
    assert me.status_code == 200, "1: /me must answer for a signed-in account"
    assert me.json()["exists"] is False, "1: a new account has no learner yet"
    started = client.post("/session", json={}).json()
    assert started["student_id"] == USER_ID, "1: the learner is the account"
    assert started["needs_diagnostic"] is True, "1: a new learner owes the quick check"
    plan, _, _ = _screens(client)
    assert [s["skill"] for s in plan["skills"]] == CURRICULUM, "1: curriculum order"
    assert [s["position"] for s in plan["skills"]] == list(range(1, 9)), "1: positions"
    first = plan["skills"][0]
    assert (first["state"], first["measured"]) == ("available", False), "1: Variables open"
    assert all(s["state"] == "locked" for s in plan["skills"][1:]), "1: the rest locked"
    assert (plan["counts"]["unlocked"], plan["counts"]["total"]) == (1, 8), "1: 1 of 8"
    assert _totals(client) == (0, 0, 0, 0, 0, 0), "1: nothing attempted yet"

    # 2. The diagnostic, answered "I don't know this one": probes are not attempts.
    for _ in range(12):
        question = client.get(f"/session/{USER_ID}/diagnostic").json()
        if question["complete"]:
            break
        answered = client.post(
            f"/session/{USER_ID}/diagnostic",
            json={"skill": question["skill"], "code": ""},
        )
        assert answered.status_code == 200, "2: an empty diagnostic answer is allowed"
    else:
        pytest.fail("2: the diagnostic did not complete")
    me = client.get("/me").json()
    assert (me["exists"], me["needs_diagnostic"]) == (True, False), "2: diagnosed"
    plan, _, _ = _screens(client)
    assert plan["skills"][0]["skill"] == "variables", "2: Variables still first"
    assert plan["skills"][0]["state"] == "available", "2: Variables still open"
    assert (plan["counts"]["unlocked"], plan["counts"]["total"]) == (1, 8), "2: 1 of 8"
    assert _totals(client) == (0, 0, 0, 0, 0, 0), "2: probes are not attempts"

    # 3. Start an exercise.
    view = client.post(
        f"/session/{USER_ID}/start", json={"target_skill": "variables"}
    ).json()
    assert view["awaiting_student"] is True, "3: the exercise waits for the learner"
    assert view["phase"] == "idle", "3: no turn in progress"
    assert view["problem"]["expected_output"], "3: the template has an expected output"

    # 4. A blank submission changes nothing anywhere.
    attempt_count = _engine("attempt_count")
    problem_id = _engine("current_problem_id")
    event_count = len(SESSIONS[USER_ID].events.events)
    blank = client.post(SUBMIT, json={"code": "   \n\t", "phased": True})
    assert blank.status_code == 422, "4: a blank submission is rejected"
    assert blank.json()["detail"] == BLANK_MESSAGE, "4: with the one message"
    assert _totals(client) == (0, 0, 0, 0, 0, 0), "4: no attempt on any screen"
    assert _engine("attempt_count") == attempt_count, "4: engine attempt count unchanged"
    assert _engine("current_problem_id") == problem_id, "4: no new problem"
    assert len(SESSIONS[USER_ID].events.events) == event_count, "4: no engine events"

    # 5. A wrong answer: one attempt everywhere, feedback about the code, nothing leaks.
    graded = client.post(
        SUBMIT, json={"code": "print('definitely not it')", "phased": True}
    )
    assert graded.status_code == 200, "5: the wrong answer is accepted for grading"
    assert graded.json()["feedback"]["passed"] is False, "5: the grade arrives first"
    view = _settle(client, graded.json())
    assert _totals(client) == (1, 1, 1, 1, 1, 1), "5: exactly one attempt everywhere"
    message = view["feedback"]["message"] or ""
    assert message.endswith("?"), f"5: feedback asks the learner a question: {message!r}"
    assert "The student" not in message and "believe" not in message, "5: second person"
    assert "activity" in view and "events" not in view, "5: learner activity only"
    plan, progress, _ = _screens(client)
    _assert_no_leak(view, "5: tutor view")
    _assert_no_leak(plan, "5: plan")
    _assert_no_leak(progress, "5: progress")
    c1 = _skill(plan, "variables")["confidence"]
    m1 = progress["recent_attempts"][0]["mastery_after"]
    assert c1 is not None, "5: Variables is measured"

    # 6. A correct answer: two attempts everywhere, the success survives the next problem,
    #    and confidence rises exactly as evidence coverage says it should.
    expected = view["problem"]["expected_output"]
    assert expected, "6: the next exercise has an expected output"
    graded = client.post(SUBMIT, json={"code": f"print({expected!r})", "phased": True})
    assert graded.status_code == 200, "6: the correct answer is accepted for grading"
    assert graded.json()["feedback"]["passed"] is True, "6: the grade arrives first"
    view = _settle(client, graded.json())
    assert _totals(client) == (2, 2, 2, 2, 2, 2), "6: exactly two attempts everywhere"
    assert view["awaiting_student"] is True and view["problem"], "6: next exercise loaded"
    assert view["feedback"]["passed"] is True, "6: the success message is not lost"
    plan, progress, _ = _screens(client)
    c2 = _skill(plan, "variables")["confidence"]
    assert c2 > c1, "6: confidence rises with valid evidence"
    stored = StudentStore(db).load_skills(USER_ID)["variables"]
    assert c2 == round(coverage(stored.evidence_weight), 4), "6: shown confidence is coverage"
    latest = progress["recent_attempts"][0]
    assert (latest["skill"], latest["outcome"]) == ("variables", "CORRECT"), "6: latest"
    assert latest["mastery_after"] > m1, "6: mastery rises after a correct answer"
    _assert_no_leak(view, "6: tutor view")
    _assert_no_leak(plan, "6: plan")
    _assert_no_leak(progress, "6: progress")

    # 7. A reload resumes the same learner with nothing lost.
    me = client.get("/me").json()
    assert (me["exists"], me["needs_diagnostic"]) == (True, False), "7: resumes"
    again = client.post("/session", json={}).json()
    assert (again["returning"], again["needs_diagnostic"]) == (True, False), "7: returning"
    assert _totals(client) == (2, 2, 2, 2, 2, 2), "7: totals survive a reload"
    plan, _, _ = _screens(client)
    assert (plan["skills"][0]["skill"], plan["skills"][0]["position"]) == ("variables", 1)
    assert _skill(plan, "variables")["confidence"] == c2, "7: confidence survives a reload"

    # 8. A duplicate submission while a turn holds the session is refused, writing nothing.
    session = SESSIONS[USER_ID]
    session.lock.acquire()
    try:
        duplicate = client.post(SUBMIT, json={"code": "print(10)", "phased": True})
    finally:
        session.lock.release()
    assert duplicate.status_code == 409, "8: a duplicate submission is refused"
    assert _totals(client) == (2, 2, 2, 2, 2, 2), "8: and records nothing"

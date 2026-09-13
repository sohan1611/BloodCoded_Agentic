"""The boundary between learner-facing confidence and internal certainty."""

import random

from app.mastery.bkt import BKTParams, update_skill
from app.mastery.evidence import Observation
from app.mastery.policy import is_mastered
from app.models.enums import StudentOutcome
from app.models.schemas import SkillNode
from app.services.belief import confirmation, shown_confidence


PRM = BKTParams()


def _run(pattern: str) -> SkillNode:
    node = SkillNode(skill="loops", mastery=PRM.p_init, confidence=0.0)
    for mark in pattern:
        outcome = (
            StudentOutcome.CORRECT
            if mark == "c"
            else StudentOutcome.WRONG_ANSWER
        )
        node, _ = update_skill(
            node,
            Observation(outcome=outcome, distinct_expectations=2),
            PRM,
        )
    return node


def test_production_trace_separates_shown_confidence_from_certainty() -> None:
    node = SkillNode(skill="loops", mastery=PRM.p_init, confidence=0.0)
    shown: list[float] = []
    internal = []
    for outcome in (
        StudentOutcome.WRONG_ANSWER,
        StudentOutcome.WRONG_ANSWER,
        StudentOutcome.CORRECT,
    ):
        node, _ = update_skill(
            node,
            Observation(outcome=outcome, distinct_expectations=2),
            PRM,
        )
        display_confidence = shown_confidence(node)
        assert display_confidence is not None
        shown.append(display_confidence)
        internal.append(node.confidence)

    assert [round(value, 3) for value in shown] == [
        0.283,
        0.487,
        0.632,
    ]
    assert shown[0] < shown[1] < shown[2]
    assert [round(value, 3) for value in internal] == [0.283, 0.487, 0.059]


def test_shown_confidence_is_monotone_for_valid_evidence() -> None:
    rng = random.Random(20260913)
    outcomes = list(StudentOutcome)

    for sequence_index in range(200):
        node = SkillNode(
            skill=f"skill-{sequence_index}",
            mastery=PRM.p_init,
            confidence=0.0,
        )
        previous = 0.0
        for _ in range(rng.randint(1, 12)):
            observation = Observation(
                outcome=rng.choice(outcomes),
                score=rng.random(),
                distinct_expectations=rng.randint(1, 5),
            )
            node, _ = update_skill(node, observation, PRM)
            shown = shown_confidence(node)

            assert shown is not None
            assert shown >= previous
            assert shown >= node.confidence
            previous = shown


def test_confirmation_reasons_cover_each_contract_branch() -> None:
    assert confirmation(_run("c")) == "needs_more_evidence"
    assert confirmation(_run("cwc")) == "needs_consistent_answers"
    assert confirmation(_run("ccc")) is None
    assert confirmation(SkillNode(skill="loops")) is None
    assert confirmation(_run("ww")) is None


def test_shown_confidence_must_not_replace_internal_certainty_in_the_gate() -> None:
    """The c,w,c trace passes a coverage gate but must fail the certainty gate."""

    node = _run("cwc")
    shown = shown_confidence(node)

    assert shown is not None
    assert is_mastered(node.mastery, shown) is True
    assert is_mastered(node.mastery, node.confidence) is False

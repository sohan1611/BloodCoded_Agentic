"""Separate learner-visible belief from the engine's internal certainty.

``mastery`` is the BKT estimate of ability, from zero to one, and the engine and
learner-facing screens use the same value.  Shown ``confidence`` is how much valid
evidence stands behind that estimate: ``coverage(evidence_weight) = 1 - e^(-N/3)``.
It is zero with no evidence, rises only when valid evidence arrives, and does not move
for blank submissions, hints, faults, or page loads.  Internal ``certainty`` is
``SkillNode.confidence`` -- coverage times agreement -- and remains the value used by
``is_mastered`` and the policy, but it is never displayed as a number.

The distinction is load-bearing.  The production wrong/wrong/correct trace has shown
confidence 0.283, 0.487, 0.632 while ``SkillNode.confidence`` is 0.283, 0.487, 0.059.
Do not "simplify" the mastery gate by pointing ``is_mastered`` at shown confidence:
after correct/wrong/correct, mastery 0.885 and coverage 0.632 would pass that gate even
though the mixed evidence leaves internal certainty at 0.369.
"""

from app.mastery.evidence import coverage
from app.mastery.policy import (
    CONFIDENCE_THRESHOLD,
    MASTERY_THRESHOLD,
    is_mastered,
)
from app.models.schemas import SkillNode


def shown_confidence(node: SkillNode) -> float | None:
    """Return learner-visible evidence coverage, or no number for an unmeasured skill."""

    return coverage(node.evidence_weight) if node.measured else None


def confirmation(node: SkillNode) -> str | None:
    """Explain why a high-mastery measured skill is not yet confirmed."""

    if (
        not node.measured
        or node.mastery < MASTERY_THRESHOLD
        or is_mastered(node.mastery, node.confidence)
    ):
        return None
    if coverage(node.evidence_weight) < CONFIDENCE_THRESHOLD:
        return "needs_more_evidence"
    return "needs_consistent_answers"

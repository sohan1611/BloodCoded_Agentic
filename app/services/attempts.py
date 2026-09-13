"""The reporting definition of a student attempt.

An attempt is one non-blank EXERCISE submission that reached grading and produced a
StudentOutcome. In ``attempt_log`` that is exactly the rows whose ``attributed_from``
is NULL. A row with ``attributed_from`` set is the prerequisite's SHARE of an attempt
already counted on the exercise's skill -- evidence, not an attempt. Diagnostic probes,
hints, page loads, problem generation, blank-submission rejections and system faults
write no ``attempt_log`` row at all.
"""

from collections.abc import Iterable, Mapping
from typing import Any


def is_exercise_attempt(row: Mapping[str, Any]) -> bool:
    """Return whether an attempt-log row represents the submitted exercise itself."""

    return row.get("attributed_from") in (None, "")


def exercise_attempts(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return exercise attempts in their original order."""

    return [dict(row) for row in rows if is_exercise_attempt(row)]


def attempts_by_skill(rows: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    """Count exercise attempts by the skill on which each submission was made."""

    counts: dict[str, int] = {}
    for row in rows:
        if not is_exercise_attempt(row):
            continue
        skill = str(row["skill"])
        counts[skill] = counts.get(skill, 0) + 1
    return counts

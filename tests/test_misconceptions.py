"""Tests for deterministic misconception detection.

These patterns exist so the model is consulted only where judgement is genuinely
required. A `RecursionError` means a missing base case -- that is what the exception
means, not an opinion -- so recognising it in code is cheaper, faster, and identical on
every run.

The most important property tested here is the one that makes the redirect causal:
a misconception must implicate the skill actually at fault, which is frequently NOT the
skill being practised.
"""

from __future__ import annotations

import pytest

from app.mastery.misconceptions import PATTERNS, detect
from app.models.enums import StudentOutcome


RESET_FOR_CODE = """\
total = 0
for s in [1, 2, 3]:
    total = 0
    total += s
print(total)
"""

RESET_WHILE_CODE = """\
i = 0
while i < 3:
    total = 0
    total += i
    i += 1
print(total)
"""

RESET_ASSIGN_CODE = """\
total = 0
for s in [1, 2, 3]:
    total = 0
    total = total + s
print(total)
"""

OVERWRITE_FOR_CODE = """\
total = 0
for s in [1, 2, 3]:
    total = s
print(total)
"""

OVERWRITE_STRING_CODE = """\
out = ""
for w in ["red", "blue"]:
    out = w
print(out)
"""

POSITIVE_ACCUMULATOR_CASES = (
    (RESET_FOR_CODE, "accumulator_reset_in_loop"),
    (RESET_WHILE_CODE, "accumulator_reset_in_loop"),
    (RESET_ASSIGN_CODE, "accumulator_reset_in_loop"),
    (OVERWRITE_FOR_CODE, "overwrite_instead_of_accumulate"),
    (OVERWRITE_STRING_CODE, "overwrite_instead_of_accumulate"),
)


def test_recursion_error_is_a_missing_base_case() -> None:
    found = detect(
        code="def f(n):\n    return n * f(n-1)",
        stdout="",
        stderr="RecursionError: maximum recursion depth exceeded",
        outcome=StudentOutcome.STUDENT_RUNTIME_ERROR,
    )
    assert found is not None
    assert found.key == "missing_base_case"
    assert "base case" in found.label


def test_none_arithmetic_implicates_functions_not_recursion() -> None:
    """The finding the whole architecture rests on.

    A student failing recursion because their recursive call returns None does not have
    a recursion problem. They have a `return` problem, which is a FUNCTIONS problem
    wearing a recursion costume. The misconception must say so, because that is what
    turns the redirect from a heuristic into a diagnosis.
    """
    found = detect(
        code="def total(n):\n    if n == 0:\n        return 0\n    total(n-1) + n",
        stdout="",
        stderr="TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'",
        outcome=StudentOutcome.STUDENT_RUNTIME_ERROR,
    )
    assert found is not None
    assert found.key == "unreturned_recursive_call"
    assert found.prerequisite_hint == "functions", (
        "must implicate functions, not the skill being practised"
    )


def test_timeout_is_an_infinite_loop() -> None:
    found = detect(
        code="while True: pass", stdout="", stderr="",
        outcome=StudentOutcome.STUDENT_TIMEOUT,
    )
    assert found is not None
    assert found.key == "infinite_loop"
    assert found.prerequisite_hint == "loops"


def test_print_instead_of_return_is_detected_from_source() -> None:
    found = detect(
        code="def double(x):\n    print(x * 2)\n\nprint(double(4))",
        stdout="8\nNone",
        stderr="",
        outcome=StudentOutcome.WRONG_ANSWER,
    )
    assert found is not None
    assert found.prerequisite_hint == "functions"


def test_reset_inside_for_loop_implicates_variables() -> None:
    found = detect(
        code=RESET_FOR_CODE,
        stdout="3",
        stderr="",
        outcome=StudentOutcome.WRONG_ANSWER,
    )
    assert found is not None
    assert found.key == "accumulator_reset_in_loop"
    assert found.prerequisite_hint == "variables"


def test_reset_inside_while_loop_implicates_variables() -> None:
    found = detect(
        code=RESET_WHILE_CODE,
        stdout="2",
        stderr="",
        outcome=StudentOutcome.WRONG_ANSWER,
    )
    assert found is not None
    assert found.key == "accumulator_reset_in_loop"
    assert found.prerequisite_hint == "variables"


def test_assignment_self_update_counts_as_accumulation() -> None:
    found = detect(
        code=RESET_ASSIGN_CODE,
        stdout="3",
        stderr="",
        outcome=StudentOutcome.WRONG_ANSWER,
    )
    assert found is not None
    assert found.key == "accumulator_reset_in_loop"
    assert found.prerequisite_hint == "variables"


def test_overwrite_inside_for_loop_implicates_variables() -> None:
    found = detect(
        code=OVERWRITE_FOR_CODE,
        stdout="3",
        stderr="",
        outcome=StudentOutcome.WRONG_ANSWER,
    )
    assert found is not None
    assert found.key == "overwrite_instead_of_accumulate"
    assert found.prerequisite_hint == "variables"


def test_overwritten_string_accumulator_implicates_variables() -> None:
    found = detect(
        code=OVERWRITE_STRING_CODE,
        stdout="blue",
        stderr="",
        outcome=StudentOutcome.WRONG_ANSWER,
    )
    assert found is not None
    assert found.key == "overwrite_instead_of_accumulate"
    assert found.prerequisite_hint == "variables"


@pytest.mark.parametrize(
    "code",
    (
        pytest.param(
            """\
for row in grid:
    row_total = 0
    for v in row:
        row_total += v
    print(row_total)
""",
            id="per-row accumulator belongs to inner loop",
        ),
        pytest.param(
            """\
total = 0
for value in values:
    total += value
print(total)
""",
            id="correct accumulator",
        ),
        pytest.param(
            """\
best = 0
for x in xs:
    if x > best:
        best = x
print(best)
""",
            id="guarded maximum",
        ),
        pytest.param(
            """\
last = None
for x in xs:
    last = x
print(last)
""",
            id="None-seeded last item",
        ),
        pytest.param(
            """\
for x in xs:
    total = 0
    total += x
print("done")
""",
            id="accumulator not read after loop",
        ),
        pytest.param(
            "for x in xs:\n    print(x)\n",
            id="no accumulator",
        ),
    ),
)
def test_non_accumulator_mistakes_do_not_match_new_patterns(code: str) -> None:
    found = detect(
        code=code,
        stdout="",
        stderr="",
        outcome=StudentOutcome.WRONG_ANSWER,
    )
    assert found is None


@pytest.mark.parametrize("code, expected_key", POSITIVE_ACCUMULATOR_CASES)
@pytest.mark.parametrize(
    "outcome",
    (StudentOutcome.CORRECT, StudentOutcome.STUDENT_SYNTAX_ERROR),
)
def test_accumulator_source_inference_requires_wrong_answer(
    code: str, expected_key: str, outcome: StudentOutcome
) -> None:
    found = detect(code=code, stdout="", stderr="", outcome=outcome)
    assert found is None, f"{expected_key} must not match {outcome.value}"


def test_unparseable_wrong_answer_does_not_match_accumulator_patterns() -> None:
    found = detect(
        code="for value in values\n    total = value",
        stdout="",
        stderr="",
        outcome=StudentOutcome.WRONG_ANSWER,
    )
    assert found is None


def test_name_error_outranks_accumulator_source_inference() -> None:
    found = detect(
        code=RESET_FOR_CODE,
        stdout="",
        stderr="NameError: name 's' is not defined",
        outcome=StudentOutcome.WRONG_ANSWER,
    )
    assert found is not None
    assert found.key == "name_error"


def test_accumulator_attribution_uses_only_direct_prerequisites() -> None:
    """The two-hop variables case is deliberately refused, not a missed case."""
    from pathlib import Path

    from app.mastery.attribution import debits
    from app.mastery.skill_graph import SkillGraph

    graph = SkillGraph.from_yaml(Path("app/config/skills.yaml"))
    assert debits("loops", "variables", graph.prerequisites("loops")) == [
        ("loops", 0.4),
        ("variables", 0.6),
    ]
    assert debits(
        "nested_loops", "variables", graph.prerequisites("nested_loops")
    ) == [("nested_loops", 1.0)]


def test_name_error_implicates_variables() -> None:
    found = detect(
        code="print(undefined_thing)", stdout="",
        stderr="NameError: name 'undefined_thing' is not defined",
        outcome=StudentOutcome.STUDENT_RUNTIME_ERROR,
    )
    assert found is not None and found.prerequisite_hint == "variables"


def test_stderr_evidence_outranks_source_inference() -> None:
    """An actual traceback is stronger evidence than a guess from the source text."""
    found = detect(
        code="def f(x):\n    print(x)",           # would match print_instead_of_return
        stdout="",
        stderr="RecursionError: maximum recursion depth exceeded",
        outcome=StudentOutcome.STUDENT_RUNTIME_ERROR,
    )
    assert found is not None and found.key == "missing_base_case"


def test_correct_submissions_and_clean_failures_yield_nothing() -> None:
    """Detection must not invent a misconception where there is no signal."""
    assert detect(code="print(42)", stdout="42", stderr="", outcome=StudentOutcome.CORRECT) is None
    assert (
        detect(code="print(1)", stdout="1", stderr="", outcome=StudentOutcome.WRONG_ANSWER)
        is None
    ), "a plain wrong answer with no signature must not be over-diagnosed"


def test_detection_never_raises_on_junk_input() -> None:
    """Student code and interpreter output are both untrusted."""
    for code in (None, "", "\x00\x01", "def f(:" * 50, "λ" * 100):
        for outcome in StudentOutcome:
            detect(code=code, stdout="", stderr="", outcome=outcome)


@pytest.mark.parametrize("pattern", PATTERNS, ids=lambda p: p.key)
def test_every_pattern_is_well_formed(pattern) -> None:
    """Each pattern must be actionable: a label, and some way to match."""
    assert pattern.label and len(pattern.label) > 15, "labels must explain, not name"
    assert (
        pattern.stderr_patterns or pattern.stdout_patterns or pattern.code_patterns
        or pattern.outcomes
    ), f"{pattern.key} can never match anything"


def test_prerequisite_hints_name_real_skills() -> None:
    """A hint pointing at a skill outside the graph could never drive a redirect."""
    from pathlib import Path

    from app.mastery.skill_graph import SkillGraph

    known = set(SkillGraph.from_yaml(Path("app/config/skills.yaml")).nodes)
    for pattern in PATTERNS:
        if pattern.prerequisite_hint:
            assert pattern.prerequisite_hint in known, (
                f"{pattern.key} implicates unknown skill {pattern.prerequisite_hint!r}"
            )


def test_hint_only_redirects_to_a_genuine_unmastered_prerequisite() -> None:
    """The hint is evidence, not an override.

    It may only promote a skill that is genuinely an unmastered prerequisite. Otherwise
    a bad diagnosis could send a student somewhere arbitrary.
    """
    from app.mastery.policy import PolicyContext, decide
    from app.mastery.skill_graph import SkillGraph
    from app.models.enums import AdaptationAction, StudentOutcome as SO
    from app.models.schemas import SkillNode

    nodes = {
        "variables": SkillNode(skill="variables", mastery=0.9, confidence=0.9),
        "conditionals": SkillNode(skill="conditionals", mastery=0.3, confidence=0.8,
                                  prerequisites=["variables"]),
        "functions": SkillNode(skill="functions", mastery=0.5, confidence=0.8,
                               prerequisites=["variables"]),
        "recursion": SkillNode(skill="recursion", mastery=0.2, confidence=0.7,
                               prerequisites=["functions", "conditionals"]),
    }
    graph = SkillGraph(nodes)

    def run(hint):
        return decide(PolicyContext(
            target_skill="recursion", graph=graph, last_outcome=SO.WRONG_ANSWER,
            consecutive_failures=2, topic_attempts=2, loop_count=3,
            prereq_depth=0, prereq_return_stack=[], misconception_hint=hint,
        ))

    # conditionals is weaker on mastery*confidence (0.24 vs 0.40), so it wins by default
    assert run(None).target_skill == "conditionals"
    # a hint naming a real unmastered prerequisite promotes it
    assert run("functions").target_skill == "functions"
    # a hint naming something that is NOT a prerequisite is ignored
    assert run("nested_loops").target_skill == "conditionals"
    # a hint naming a MASTERED prerequisite is ignored
    assert run("variables").target_skill == "conditionals"
    assert run(None).action is AdaptationAction.REVISIT_PREREQUISITE


# ---------------------------------------------------------------- student-facing text
def test_every_pattern_speaks_to_the_student() -> None:
    """A diagnosis the student never sees has taught nobody anything.

    `label` is written for the event stream and names the fault outright. `student_note`
    is the same finding addressed to the person who just failed, and it has to end in a
    question -- handing someone the fix teaches them that they needed handing the fix.
    """
    for pattern in PATTERNS:
        assert pattern.student_note, f"{pattern.key} has no student-facing note"
        assert pattern.student_note.rstrip().endswith("?"), (
            f"{pattern.key} tells the student the answer instead of asking for it"
        )
        assert pattern.student_note != pattern.label, (
            f"{pattern.key} shows the reviewer's wording to the student"
        )


def test_feedback_reaching_the_student_is_the_diagnosis_not_the_traceback() -> None:
    """Regression: `feedback` used to carry raw stderr, which explains nothing.

    Pins the whole path -- a recursion failure with no base case must reach the student
    as the diagnosed cause, not as the exception Python happened to raise.
    """
    found = detect(
        code="def total(n):\n    return n + total(n - 1)",
        stdout="",
        stderr="RecursionError: maximum recursion depth exceeded",
        outcome=StudentOutcome.STUDENT_RUNTIME_ERROR,
    )
    assert found is not None and found.key == "missing_base_case"
    note = found.student_note
    assert "RecursionError" not in note, "the traceback leaked into student feedback"
    assert "base case" not in note.lower(), "jargon the student has not been taught yet"
    assert "stop" in note.lower() or "smallest" in note.lower()


def test_error_summary_drops_our_stack_frames() -> None:
    """A student should read their own mistake, not our sandbox harness."""
    from app.graph.nodes import _error_summary

    traceback = (
        "Traceback (most recent call last):\n"
        '  File "/tmp/sandbox_runner.py", line 42, in <module>\n'
        "    exec(compile(src))\n"
        '  File "<student>", line 2, in total\n'
        "NameError: name 'tota' is not defined"
    )
    summary = _error_summary(traceback)
    assert summary == "NameError: name 'tota' is not defined"
    assert "sandbox_runner" not in summary
    assert _error_summary("") == ""


def test_unmatched_failure_feedback_is_a_nonempty_question_without_model_voice() -> None:
    from app.mastery.misconceptions import student_feedback_for

    for outcome in StudentOutcome:
        if outcome is StudentOutcome.CORRECT:
            continue
        for summary in ("", "ZeroDivisionError: division by zero"):
            note = student_feedback_for(None, outcome, summary, "print('attempt')")
            assert note
            assert note.endswith("?")
            assert "The student" not in note
            assert "believe" not in note


@pytest.mark.parametrize(
    "outcome",
    [
        StudentOutcome.STUDENT_RUNTIME_ERROR,
        StudentOutcome.STUDENT_SYNTAX_ERROR,
    ],
)
def test_student_error_feedback_includes_the_available_summary(
    outcome: StudentOutcome,
) -> None:
    from app.mastery.misconceptions import student_feedback_for

    summary = "ZeroDivisionError: division by zero"
    assert summary in student_feedback_for(None, outcome, summary, "1 / 0")


@pytest.mark.parametrize(
    "outcome",
    [
        StudentOutcome.STUDENT_RUNTIME_ERROR,
        StudentOutcome.STUDENT_SYNTAX_ERROR,
    ],
)
@pytest.mark.parametrize("summary", ["Example error.", "Example error:"])
def test_student_error_feedback_does_not_double_summary_punctuation(
    outcome: StudentOutcome,
    summary: str,
) -> None:
    from app.mastery.misconceptions import student_feedback_for

    note = student_feedback_for(None, outcome, summary, "bad code")
    for doubled in (". .", "..", ":.", ": ."):
        assert doubled not in note


def test_correct_without_a_pattern_has_no_failure_feedback() -> None:
    from app.mastery.misconceptions import student_feedback_for

    assert student_feedback_for(None, StudentOutcome.CORRECT, "", "print(1)") == ""


def test_matched_feedback_is_exactly_the_patterns_student_note() -> None:
    from app.mastery.misconceptions import student_feedback_for, student_note_for

    name_error = next(pattern for pattern in PATTERNS if pattern.key == "name_error")
    code = "print(x)"
    assert student_feedback_for(
        name_error,
        StudentOutcome.STUDENT_RUNTIME_ERROR,
        "NameError: name 'x' is not defined",
        code,
    ) == student_note_for(name_error, code)


def test_student_feedback_boundary_accepts_no_model_output() -> None:
    """A model-output parameter would reopen the leak, so this guard must fail loudly."""
    import inspect

    from app.mastery.misconceptions import student_feedback_for

    assert set(inspect.signature(student_feedback_for).parameters) == {
        "found",
        "outcome",
        "error_summary",
        "code",
    }

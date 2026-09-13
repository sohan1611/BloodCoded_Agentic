"""Deterministic misconception patterns.

Invariant: this module never calls a model. It recognises the misconceptions that have
an unambiguous signature in the interpreter's own output, so the LLM is only consulted
for the cases that genuinely need judgement.

Why bother when we have a model: a `RecursionError` means a missing or unreachable base
case. That is not a matter of opinion, it is what the exception means. Asking a model to
infer it would add latency, cost, and the possibility of a different answer each time,
to a question whose answer is already known. The model earns its place on the cases
these rules cannot name.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Callable
from dataclasses import dataclass

from app.models.enums import StudentOutcome


@dataclass(frozen=True)
class Pattern:
    """One recognisable misconception."""

    key: str
    label: str
    prerequisite_hint: str | None
    """The skill this misconception really implicates, which is often NOT the skill
    being practised -- a `NoneType` arithmetic error during recursion is a `return`
    misunderstanding, i.e. a functions problem wearing a recursion costume."""

    student_note: str = ""
    """The same diagnosis, addressed to the student instead of to a reviewer.

    `label` is written for the event stream: third person, diagnostic, and it names the
    fault outright. That is the wrong register for the person who just failed. This ends
    in a question the student can answer from what they already know, because handing
    someone the fix teaches them that they needed handing the fix.

    Deterministic on purpose. The rule already knows exactly which misunderstanding
    fired, so asking a model to re-describe it would add latency and a failure mode to
    a sentence we can simply write correctly once.
    """

    student_note_plain: str = ""
    """The same diagnosis for code that is NOT recursive.

    Set only where a pattern's trigger is more general than its name. A `NoneType`
    arithmetic error means "a function returned None"; it does not mean the function was
    recursive, and telling a student their recursive call is wrong when they wrote none
    is how a tutor loses their trust.
    """

    hints: tuple[str, ...] = ()
    """Progressive help to show before a submission, without containing the fix.

    A hint may point at the right question or concept, but it must not give corrected
    code or tell the student which exact edit to make. A hint that hands over the
    answer teaches the student they needed handing the answer.
    """

    stderr_patterns: tuple[str, ...] = ()
    stdout_patterns: tuple[str, ...] = ()
    code_patterns: tuple[str, ...] = ()
    outcomes: tuple[StudentOutcome, ...] = ()
    code_check: Callable[[str], bool] | None = None
    """A deterministic predicate over the SUBMITTED source, via `ast`.

    Unlike draft facts, this is evidence about a completed program whose observed
    outcome can affect mastery. A predicate must therefore fail closed when the source
    cannot be analysed.
    """


_LOOP_NODES = (ast.For, ast.AsyncFor, ast.While)
_SCOPE_NODES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)


def _is_accumulator_constant(node: ast.AST) -> bool:
    """Whether `node` is one of the constants that can seed an accumulator."""
    return isinstance(node, ast.Constant) and (
        isinstance(node.value, str)
        or (isinstance(node.value, (int, float)) and not isinstance(node.value, bool))
    )


def _single_name_assignment(node: ast.AST) -> tuple[str, ast.AST] | None:
    """Return the name and value for the exact assignment form used by both facts."""
    if (
        isinstance(node, ast.Assign)
        and len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
    ):
        return node.targets[0].id, node.value
    return None


def _loads_name(node: ast.AST, name: str) -> bool:
    """Whether `node` contains a load of `name`."""
    return any(
        isinstance(child, ast.Name)
        and child.id == name
        and isinstance(child.ctx, ast.Load)
        for child in ast.walk(node)
    )


def _is_self_update(node: ast.AST, name: str) -> bool:
    """Whether `node` updates `name` using its previous value."""
    if isinstance(node, ast.AugAssign):
        return isinstance(node.target, ast.Name) and node.target.id == name
    assignment = _single_name_assignment(node)
    return assignment is not None and assignment[0] == name and _loads_name(
        assignment[1], name
    )


def _own_body_statements(
    loop: ast.For | ast.AsyncFor | ast.While,
) -> list[tuple[ast.stmt, tuple[ast.AST, ...]]]:
    """Statements owned by `loop`, paired with tests of enclosing `if` blocks."""
    found: list[tuple[ast.stmt, tuple[ast.AST, ...]]] = []

    def descend(statements: list[ast.stmt], if_tests: tuple[ast.AST, ...]) -> None:
        for statement in statements:
            found.append((statement, if_tests))
            if isinstance(statement, _LOOP_NODES + _SCOPE_NODES):
                continue
            if isinstance(statement, ast.If):
                nested_tests = (*if_tests, statement.test)
                descend(statement.body, nested_tests)
                descend(statement.orelse, nested_tests)
            elif isinstance(statement, (ast.With, ast.AsyncWith)):
                descend(statement.body, if_tests)
            elif isinstance(statement, (ast.Try, ast.TryStar)):
                descend(statement.body, if_tests)
                for handler in statement.handlers:
                    descend(handler.body, if_tests)
                descend(statement.orelse, if_tests)
                descend(statement.finalbody, if_tests)
            elif isinstance(statement, ast.Match):
                for case in statement.cases:
                    descend(case.body, if_tests)

    descend(loop.body, ())
    return found


def _loops_with_scopes(
    tree: ast.Module,
) -> list[
    tuple[
        ast.For | ast.AsyncFor | ast.While,
        ast.Module | ast.FunctionDef | ast.AsyncFunctionDef,
    ]
]:
    """Pair every loop with its innermost enclosing function, or the module."""
    loops: list[
        tuple[
            ast.For | ast.AsyncFor | ast.While,
            ast.Module | ast.FunctionDef | ast.AsyncFunctionDef,
        ]
    ] = []

    class Visitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.scope: ast.Module | ast.FunctionDef | ast.AsyncFunctionDef = tree

        def _visit_function(
            self, node: ast.FunctionDef | ast.AsyncFunctionDef
        ) -> None:
            previous = self.scope
            self.scope = node
            self.generic_visit(node)
            self.scope = previous

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            self._visit_function(node)

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
            self._visit_function(node)

        def _visit_loop(self, node: ast.For | ast.AsyncFor | ast.While) -> None:
            loops.append((node, self.scope))
            self.generic_visit(node)

        def visit_For(self, node: ast.For) -> None:
            self._visit_loop(node)

        def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
            self._visit_loop(node)

        def visit_While(self, node: ast.While) -> None:
            self._visit_loop(node)

    Visitor().visit(tree)
    return loops


def _scope_nodes(
    scope: ast.Module | ast.FunctionDef | ast.AsyncFunctionDef,
) -> list[ast.AST]:
    """Nodes in one lexical scope, excluding nested functions, lambdas and classes."""
    nodes: list[ast.AST] = []

    class Visitor(ast.NodeVisitor):
        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            return

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
            return

        def visit_Lambda(self, node: ast.Lambda) -> None:
            return

        def visit_ClassDef(self, node: ast.ClassDef) -> None:
            return

        def generic_visit(self, node: ast.AST) -> None:
            nodes.append(node)
            super().generic_visit(node)

    visitor = Visitor()
    for statement in scope.body:
        visitor.visit(statement)
    return nodes


def _read_after(
    scope_nodes: list[ast.AST], loop: ast.For | ast.AsyncFor | ast.While, name: str
) -> bool:
    """Whether `name` is loaded in the loop's scope after the loop ends."""
    end_lineno = loop.end_lineno if loop.end_lineno is not None else loop.lineno
    return any(
        isinstance(node, ast.Name)
        and node.id == name
        and isinstance(node.ctx, ast.Load)
        and node.lineno > end_lineno
        for node in scope_nodes
    )


def resets_accumulator_inside_loop(source: str) -> bool:
    """Detect an accumulator reset before its self-update in one loop's own body."""
    try:
        tree = ast.parse(source)
        for loop, scope in _loops_with_scopes(tree):
            own_statements = _own_body_statements(loop)
            scope_nodes = _scope_nodes(scope)
            resets = [
                (statement, assignment[0])
                for statement, _ in own_statements
                if (assignment := _single_name_assignment(statement)) is not None
                and _is_accumulator_constant(assignment[1])
            ]
            for reset, name in resets:
                if not _read_after(scope_nodes, loop, name):
                    continue
                if any(
                    reset.lineno < statement.lineno
                    and _is_self_update(statement, name)
                    for statement, _ in own_statements
                ):
                    return True
        return False
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        return False


def overwrites_instead_of_accumulating(source: str) -> bool:
    """Detect an accumulator seed followed by replacement on every loop pass."""
    try:
        tree = ast.parse(source)
        for loop, scope in _loops_with_scopes(tree):
            own_statements = _own_body_statements(loop)
            scope_nodes = _scope_nodes(scope)
            seeded_names = {
                assignment[0]
                for node in scope_nodes
                if isinstance(node, ast.Assign)
                and node.lineno < loop.lineno
                and (assignment := _single_name_assignment(node)) is not None
                and _is_accumulator_constant(assignment[1])
            }
            for name in seeded_names:
                if not _read_after(scope_nodes, loop, name):
                    continue
                if any(
                    _is_self_update(statement, name)
                    for statement, _ in own_statements
                ):
                    continue
                for statement, if_tests in own_statements:
                    assignment = _single_name_assignment(statement)
                    if (
                        assignment is not None
                        and assignment[0] == name
                        and not _loads_name(assignment[1], name)
                        and not any(_loads_name(test, name) for test in if_tests)
                    ):
                        return True
        return False
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        return False


def _check_safely(predicate: Callable[[str], bool], source: str) -> bool:
    """Run a submitted-source predicate fail-closed on any exception."""
    try:
        return predicate(source)
    except Exception:
        return False


PATTERNS: tuple[Pattern, ...] = (
    Pattern(
        key="missing_base_case",
        label="recursive function has no reachable base case, so it never terminates",
        prerequisite_hint="conditionals",
        student_note=(
            "Your recursive call looks right, but nothing ever stops it — the function calls "
            "itself all the way down. What is the smallest input where it should return "
            "immediately, without calling itself again?"
        ),
        hints=(
            "Think about when this function should STOP calling itself.",
            "What is the smallest input where it should just return a value straight "
            "away, without calling itself again?",
        ),
        stderr_patterns=(r"RecursionError", r"maximum recursion depth"),
    ),
    Pattern(
        key="unreturned_recursive_call",
        label="recursive call is computed but not returned, so the function yields None",
        prerequisite_hint="functions",
        student_note=(
            "You are computing the recursive call but not returning it, so the function hands "
            "back None and the arithmetic fails. Look at the line that calls itself: what happens "
            "to the value it produces?"
        ),
        student_note_plain=(
            "Your function computes the answer but never returns it, so it hands back "
            "None and the arithmetic fails. Look at the last thing the function does: "
            "does the value get back to whoever called it?"
        ),
        hints=(
            "Think about what your function gives back to the caller after it makes "
            "the recursive call.",
            "Look at the line that calls the function again. Where does the value "
            "from that call go next?",
        ),
        stderr_patterns=(
            r"unsupported operand type\(s\).*NoneType",
            r"TypeError.*NoneType.*int",
            r"'NoneType' object is not",
        ),
    ),
    Pattern(
        key="print_instead_of_return",
        label="uses print where a return value is required, so the caller receives None",
        prerequisite_hint="functions",
        student_note=(
            "Your function prints the answer instead of returning it, so the caller receives "
            "None. Printing shows a value to a human; returning gives it back to the code. Which "
            "one does the caller need here?"
        ),
        hints=(
            "Think about who needs the answer: a person reading the screen, or "
            "another piece of code.",
            "Look inside the function body. Is the answer being sent back to the "
            "caller, or only shown on the screen?",
        ),
        code_patterns=(r"def\s+\w+\([^)]*\):(?:(?!return).)*?print\(",),
        outcomes=(StudentOutcome.WRONG_ANSWER,),
    ),
    Pattern(
        key="accumulator_reset_in_loop",
        label="resets an accumulator inside the loop, discarding progress from earlier passes",
        prerequisite_hint="variables",
        student_note=(
            "Your running value starts over during the loop, so progress from earlier passes "
            "is lost. Where does a value that must survive every pass need to be created?"
        ),
        hints=(
            "Trace the value that is meant to remember work from one pass to the next.",
            "Where is that value created relative to the loop that needs to preserve it?",
        ),
        outcomes=(StudentOutcome.WRONG_ANSWER,),
        code_check=resets_accumulator_inside_loop,
    ),
    Pattern(
        key="overwrite_instead_of_accumulate",
        label="replaces an accumulator on each loop pass instead of combining prior work",
        prerequisite_hint="variables",
        student_note=(
            "Each pass replaces the value left by the previous one, so the result only "
            "reflects the latest item. Does each pass add to what came before, or replace it?"
        ),
        hints=(
            "Trace the value after two passes and compare it with the work done so far.",
            "Does each pass build on the earlier value, or leave only the current item?",
        ),
        outcomes=(StudentOutcome.WRONG_ANSWER,),
        code_check=overwrites_instead_of_accumulating,
    ),
    Pattern(
        key="infinite_loop",
        label="loop condition never becomes false, so execution does not terminate",
        prerequisite_hint="loops",
        student_note=(
            "Your loop never finishes, so the program was stopped for you. Look at the variable "
            "in the loop condition: is anything inside the loop actually changing it?"
        ),
        hints=(
            "Think about what has to change before the loop can finish.",
            "Look at the value used in the loop condition. Does it move closer to "
            "making the condition false each time around?",
        ),
        outcomes=(StudentOutcome.STUDENT_TIMEOUT,),
    ),
    Pattern(
        key="off_by_one_recursion",
        label="recursive step does not reduce the problem, so the base case is unreachable",
        prerequisite_hint="recursion",
        student_note=(
            "Each recursive call is being given the same problem rather than a smaller one, so "
            "the base case is never reached. Compare the argument you pass to the one you "
            "received: is it getting closer to the stopping point?"
        ),
        hints=(
            "Think about whether each recursive call is working on a smaller version "
            "of the problem.",
            "Compare the input you received with the input you pass into the next "
            "call. Is it moving toward the stopping point?",
        ),
        code_patterns=(r"def\s+(\w+)\([^)]*\):(?:(?!\1\s*\(\s*\w+\s*[-+]).)*?\1\s*\(\s*\w+\s*\)",),
    ),
    Pattern(
        key="name_error",
        label="uses a name that was never defined, or defined only inside another scope",
        prerequisite_hint="variables",
        student_note=(
            "You are using a name Python has not seen yet at that point — either it was never "
            "defined, or it was defined inside another function and is not visible here. Where is "
            "that name first assigned?"
        ),
        hints=(
            "Think about the names your code uses and where each one first comes from.",
            "Find the first line where Python reaches that name. Has that name "
            "already been created before that point?",
        ),
        stderr_patterns=(r"NameError",),
    ),
    Pattern(
        key="indentation",
        label="block structure is wrong, so statements sit outside the body they belong to",
        prerequisite_hint=None,
        student_note=(
            "The indentation puts some statements outside the block you meant them to be in, so "
            "they run at the wrong time. Which lines are meant to belong to the body above them?"
        ),
        hints=(
            "Think about which lines belong inside the same block of work.",
            "Look at the lines just after a colon. Are the statements that belong "
            "together lined up the same way?",
        ),
        stderr_patterns=(r"IndentationError", r"TabError"),
    ),
)


SKILL_HINTS: dict[str, tuple[str, str]] = {
    "recursion": (
        "Think about the moment when the repeated work should stop.",
        "Compare one call to the next: is the problem getting smaller and closer "
        "to a simple case?",
    ),
    "functions": (
        "Think about what information goes into the function and what should come "
        "back out.",
        "Look at the last useful value your function makes. What needs to happen "
        "to that value so the caller can use it?",
    ),
    "loops": (
        "Think about what has to stay true while the loop runs.",
        "Check one trip through the loop at a time. Which value changes, and when "
        "should the loop be finished?",
    ),
    "conditionals": (
        "Think about the different cases the problem describes.",
        "For each branch, ask which inputs should go there and what should happen "
        "only in that case.",
    ),
    "variables": (
        "Think about what each name is meant to store.",
        "Trace one name from the first place it is created to each place it is used.",
    ),
}

GENERIC_HINTS: tuple[str, str] = (
    "Re-read the prompt and name the single part you are unsure about.",
    "Pick one example input and walk through what your code should do before you "
    "change anything.",
)


def detect(
    *,
    code: str | None,
    stdout: str,
    stderr: str,
    outcome: StudentOutcome,
) -> Pattern | None:
    """Return the first pattern whose signature matches, or None.

    Order matters: stderr evidence is the most reliable, so those patterns are checked
    before anything inferred from the source text.
    """
    haystack_err = stderr or ""
    haystack_out = stdout or ""
    body = code or ""

    for pattern in PATTERNS:
        if pattern.stderr_patterns and any(
            re.search(p, haystack_err, re.IGNORECASE | re.DOTALL)
            for p in pattern.stderr_patterns
        ):
            return pattern

    for pattern in PATTERNS:
        if pattern.outcomes and outcome in pattern.outcomes:
            if pattern.code_check is not None:
                if _check_safely(pattern.code_check, body):
                    return pattern
                continue
            if not pattern.code_patterns:
                return pattern
            if any(re.search(p, body, re.DOTALL) for p in pattern.code_patterns):
                return pattern

    for pattern in PATTERNS:
        if pattern.stdout_patterns and any(
            re.search(p, haystack_out, re.IGNORECASE) for p in pattern.stdout_patterns
        ):
            return pattern

    return None


@dataclass(frozen=True)
class DraftFacts:
    """What can be established about an unfinished submission, exactly.

    Read with `ast` rather than regexes. The previous version tried to bound a search to
    a function body using indentation backreferences and could not: a call sitting AFTER
    the function at module level read as the function calling itself, so a draft with no
    recursion in it was offered recursion hints. The parser already knows where a body
    ends; guessing at it with a pattern was never going to be right.

    Every field is False for code that does not parse, which is the honest answer for a
    half-written draft -- and hints are offered on drafts, so that case is normal.
    """

    parses: bool = False
    recursive: bool = False
    """Some function calls itself from inside its own body."""
    recursive_without_base: bool = False
    """...and that function contains no `if`, so nothing can stop it."""
    prints_without_returning: bool = False
    """Some function prints and never returns, so its caller receives None."""


def analyse_draft(code: str | None) -> DraftFacts:
    """Facts about a draft, used ONLY to choose which words to show.

    Never consulted for routing or mastery. Diagnosis uses PATTERNS against real
    interpreter output, so a guess about incomplete work cannot redirect a student.
    """
    try:
        tree = ast.parse(code or "")
    except (SyntaxError, ValueError):
        return DraftFacts()

    recursive = recursive_without_base = prints_without_returning = False
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = list(ast.walk(node))
        calls_itself = any(
            isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == node.name
            for n in body
        )
        has_if = any(isinstance(n, ast.If) for n in body)
        has_return = any(
            isinstance(n, ast.Return) and n.value is not None for n in body
        )
        prints = any(
            isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "print"
            for n in body
        )
        recursive |= calls_itself
        recursive_without_base |= calls_itself and not has_if
        prints_without_returning |= prints and not has_return

    return DraftFacts(
        parses=True,
        recursive=recursive,
        recursive_without_base=recursive_without_base,
        prints_without_returning=prints_without_returning,
    )


# Which hint ladder an unfinished draft earns. Order is deliberate: a recursive draft
# that also prints gets the recursion hint, because that is the harder block.
HINT_DRAFT_SIGNATURES: tuple[tuple[str, str], ...] = (
    ("recursive_without_base", "missing_base_case"),
    ("prints_without_returning", "print_instead_of_return"),
)


def student_note_for(pattern: Pattern, code: str | None = None) -> str:
    """The diagnosis in words that match the code actually submitted.

    One misconception can surface in recursive and non-recursive code alike: a function
    that computes a value and never returns it hands back None either way, and the
    interpreter's error is identical. The diagnosis is the same and correct; only the
    wording has to change, or a student who wrote no recursion is told their "recursive
    call" is wrong and reasonably stops trusting the tutor.
    """
    if pattern.student_note_plain and not analyse_draft(code).recursive:
        return pattern.student_note_plain
    return pattern.student_note


def student_feedback_for(
    found: Pattern | None,
    outcome: StudentOutcome,
    error_summary: str,
    code: str | None,
) -> str:
    """Return feedback based only on deterministic evidence available to the tutor.

    The signature is the guarantee: it accepts no ``MisconceptionAnalysis`` or model
    output, so this function cannot leak model text it is never given. Do not add such
    a parameter; that would reopen the student-feedback boundary this function closes.
    """
    if found is not None:
        return student_note_for(found, code)

    summary = error_summary.strip()
    punctuation = "" if summary.endswith((".", ":", ";", "!", "?")) else "."

    if outcome == StudentOutcome.WRONG_ANSWER:
        return (
            "Your program ran, but what it printed doesn't match the expected output. "
            "Compare the two line by line: where do they first stop matching?"
        )
    if outcome == StudentOutcome.STUDENT_RUNTIME_ERROR:
        if summary:
            return (
                f"Python stopped partway through with: {summary}{punctuation} Which line "
                "was it running at that moment, and what did you expect it to do?"
            )
        return (
            "Python stopped partway through your program. Which line was it running at "
            "that moment, and what did you expect it to do?"
        )
    if outcome == StudentOutcome.STUDENT_SYNTAX_ERROR:
        if summary:
            return (
                f"Python couldn't read your program: {summary}{punctuation} Which line "
                "does that message point to, and what is missing or extra there?"
            )
        return (
            "Python couldn't read part of your program. Which line looks different "
            "from how you meant to write it?"
        )
    if outcome == StudentOutcome.STUDENT_TIMEOUT:
        return (
            "Your program kept running and was stopped for you. What has to change "
            "inside the loop before it can finish?"
        )
    return ""


def hints_for(
    skill: str, code: str | None = None, difficulty: str | None = None
) -> tuple[str, ...]:
    """The hint ladder to offer a student stuck on `skill`.

    Three sources, most specific first.

    1. What they have WRITTEN. A draft with a recognisable mistake in it earns a hint
       about that mistake, and nothing else comes close for usefulness.
    2. What they have been ASKED. Reported by a student: every recursion problem gave
       the same two hints. It did -- with an empty editor there was no draft to read,
       so this fell straight to a fixed pair per skill, and an EASY base-case exercise
       and a HARD divide-and-conquer one were handed identical advice. The rung knows
       what its level actually demands, so a blank editor can still get a hint aimed at
       THIS problem.
    3. The skill alone, when neither of the above says anything.
    """
    if code is not None:
        facts = analyse_draft(code)
        for fact, pattern_key in HINT_DRAFT_SIGNATURES:
            if getattr(facts, fact):
                return next(p for p in PATTERNS if p.key == pattern_key).hints

    if difficulty:
        rung_hints = _hints_from_rung(skill, difficulty)
        if rung_hints:
            return rung_hints

    return SKILL_HINTS.get(skill, GENERIC_HINTS)


def _hints_from_rung(skill: str, difficulty: str) -> tuple[str, ...]:
    """A ladder built from what this difficulty actually asks for.

    Imported lazily: misconceptions.py is imported by the sandbox path, and the
    difficulty ladder has no business being pulled in there.
    """
    try:
        from app.mastery.difficulty import rung_for
        from app.models.enums import Difficulty

        rung = rung_for(skill, Difficulty(str(difficulty)))
    except (ImportError, ValueError):
        return ()

    if not rung.demands:
        return ()

    base = SKILL_HINTS.get(skill, GENERIC_HINTS)
    return (
        f"This one is asking for {rung.demands}. Start there.",
        base[0],
        *base[1:],
    )


def learner_note_for(recorded: str) -> str | None:
    """Return learner-facing wording only for a recognised persisted pattern label.

    Model hypotheses and legacy outage fallbacks were persisted in the same string
    lists as deterministic diagnoses. Only an exact Pattern label has reviewed learner
    wording, so every other value stays out of the learner presentation by default.
    """
    for pattern in PATTERNS:
        if recorded == pattern.label:
            return pattern.student_note
    return None

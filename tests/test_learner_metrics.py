"""Pure regression tests for attempt reporting and curriculum roadmap semantics."""

from app.mastery.policy import MASTERY_THRESHOLD, roadmap_state
from app.mastery.skill_graph import SkillGraph
from app.models.schemas import SkillNode
from app.services.attempts import attempts_by_skill, exercise_attempts


CURRICULUM_ORDER = [
    "variables",
    "conditionals",
    "loops",
    "functions",
    "function_call_tracing",
    "recursion",
    "recursion_tree",
    "nested_loops",
]


def test_exercise_attempt_helpers_exclude_attributed_evidence() -> None:
    rows = [
        {"skill": "variables", "attributed_from": None, "marker": 1},
        {"skill": "loops", "attributed_from": "", "marker": 2},
        {"skill": "variables", "attributed_from": "loops", "marker": 3},
    ]

    assert exercise_attempts(rows) == rows[:2]
    assert attempts_by_skill(rows) == {"variables": 1, "loops": 1}


def test_shipped_skill_graph_uses_declared_curriculum_order() -> None:
    graph = SkillGraph.from_yaml("app/config/skills.yaml")

    assert graph.curriculum_order() == CURRICULUM_ORDER


def test_explicit_rank_survives_reverse_node_insertion_order() -> None:
    declared_graph = SkillGraph.from_yaml("app/config/skills.yaml")
    declared_nodes = declared_graph.nodes
    rank = {name: index for index, name in enumerate(declared_nodes)}
    reversed_nodes = {
        name: declared_nodes[name]
        for name in sorted(declared_nodes, reverse=True)
    }
    graph = SkillGraph(reversed_nodes)

    order = graph.curriculum_order(rank)
    position = {name: index for index, name in enumerate(order)}

    assert order == CURRICULUM_ORDER
    for skill in order:
        assert all(
            position[prerequisite] < position[skill]
            for prerequisite in graph.prerequisites(skill)
        )


def test_roadmap_state_precedence() -> None:
    unmeasured = SkillNode(skill="variables")
    provisional = SkillNode(
        skill="loops",
        mastery=MASTERY_THRESHOLD,
        confidence=0.2,
        evidence_weight=1.0,
    )
    completed = SkillNode(
        skill="functions",
        mastery=0.9,
        confidence=0.8,
        evidence_weight=1.0,
    )
    measured_low = SkillNode(
        skill="recursion",
        mastery=0.2,
        confidence=0.8,
        evidence_weight=1.0,
    )

    assert roadmap_state(unmeasured, []) == "available"
    assert roadmap_state(unmeasured, ["variables"]) == "locked"
    assert roadmap_state(provisional, ["conditionals"]) == "provisional"
    assert roadmap_state(completed, ["variables"]) == "completed"
    assert roadmap_state(measured_low, ["functions"]) == "locked"

import assert from "node:assert/strict";
import test from "node:test";

import type { PlanSkill } from "./api.ts";
import {
  filterRoadmap,
  roadmapNumber,
  unlockedSummary,
} from "./roadmap.ts";

const curriculum = [
  "variables",
  "conditionals",
  "loops",
  "functions",
  "function_call_tracing",
  "recursion",
  "recursion_tree",
  "nested_loops",
];

const prerequisites: Record<string, string[]> = {
  variables: [],
  conditionals: ["variables"],
  loops: ["variables", "conditionals"],
  functions: ["variables"],
  function_call_tracing: ["functions"],
  recursion: ["functions", "conditionals"],
  recursion_tree: ["recursion"],
  nested_loops: ["loops"],
};

const skills = curriculum.map<PlanSkill>((skill, index) => ({
  skill,
  state: index === 0 ? "available" : "locked",
  measured: false,
  position: index + 1,
  mastery: null,
  confidence: null,
  confirmation: null,
  attempts: 0,
  prerequisites: prerequisites[skill],
  blocked_by: prerequisites[skill],
  not_measured_because: prerequisites[skill][0] ?? null,
  unlocks: [],
  misconceptions: [],
  overcome: [],
}));

test("filtering for nested preserves Nested Loops' curriculum position", () => {
  const shown = filterRoadmap(skills, "nested");
  assert.deepEqual(
    shown.map((skill) => [skill.skill, skill.position]),
    [["nested_loops", 8]],
  );
  assert.equal(shown[0], skills[7]);
});

test("filtering is case-insensitive and preserves curriculum order", () => {
  assert.deepEqual(
    filterRoadmap(skills, "LOOPS").map((skill) => [skill.skill, skill.position]),
    [
      ["loops", 3],
      ["nested_loops", 8],
    ],
  );
});

test("a whitespace-only filter returns all eight skills", () => {
  assert.equal(filterRoadmap(skills, "   "), skills);
  assert.equal(filterRoadmap(skills, "   ").length, 8);
});

test("the unlocked summary uses the reporting count", () => {
  assert.equal(
    unlockedSummary({
      total: 8,
      done: 0,
      provisional: 0,
      available: 1,
      locked: 7,
      unlocked: 1,
      unmeasured: 8,
    }),
    "1 of 8 unlocked",
  );
});

test("roadmap numbers are zero-padded only below ten", () => {
  assert.equal(roadmapNumber(8), "08");
  assert.equal(roadmapNumber(12), "12");
});

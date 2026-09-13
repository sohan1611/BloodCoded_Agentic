import assert from "node:assert/strict";
import test from "node:test";

import type { LearnerActivity } from "./api.ts";
import { describeActivity } from "./activity.ts";

const actions = [
  "ADVANCE",
  "RETRY_VARIATION",
  "EXPLAIN_DIFFERENTLY",
  "STEP_DOWN_DIFFICULTY",
  "REVISIT_PREREQUISITE",
  "ESCALATE_DIFFICULTY",
  "REASSESS",
  "COMPLETE",
];

const items: LearnerActivity[] = [
  {
    type: "generated",
    skill: "loops",
    title: "Add four numbers",
    difficulty: "EASY",
  },
  { type: "execution", passed: true, score: 1 },
  { type: "execution", passed: false, score: 0.5 },
  {
    type: "misconception",
    skill: "loops",
    note: "Your running value starts over during the loop.",
  },
  { type: "resolved", skill: "loops", count: 1 },
  {
    type: "mastery",
    skill: "variables",
    before: 0.3,
    after: 0.55,
    attributed_from: "loops",
  },
  ...actions.map<LearnerActivity>((action) => ({
    type: "adaptation",
    skill: "loops",
    action,
  })),
  {
    type: "prereq_redirect",
    from_skill: "loops",
    to_skill: "variables",
  },
  { type: "prereq_return", skill: "loops" },
  { type: "recovery" },
  { type: "session_end" },
];

test("every learner activity description is clean, readable copy", () => {
  for (const item of items) {
    const { title, detail } = describeActivity(item);
    const copy = `${title} ${detail}`;

    assert.ok(title.length > 0, `${item.type} has no title`);
    assert.ok(detail.length > 0, `${item.type} has no detail`);
    assert.doesNotMatch(copy, /_/);
    assert.doesNotMatch(copy, /The student/);
    assert.doesNotMatch(copy, /believe/);
    assert.doesNotMatch(copy, /=/);
    assert.doesNotMatch(copy, /[0-9a-f]{6,}/i);
  }
});

test("an unknown adaptation action has a safe fallback", () => {
  assert.equal(
    describeActivity({ type: "adaptation", skill: "loops", action: "NEW_ACTION" })
      .detail,
    "The tutor picked your next step.",
  );
});

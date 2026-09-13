import assert from "node:assert/strict";
import test from "node:test";

import {
  TURN_DEADLINE_MS,
  phaseLabel,
  settledView,
  shouldKeepPolling,
  type TurnPhase,
} from "./turn.ts";

test("phaseLabel names only active work", () => {
  const expected: Record<TurnPhase, string | null> = {
    idle: null,
    "running-tests": "Running tests…",
    "updating-plan": "Updating your plan…",
    failed: null,
    "timed-out": null,
  };

  for (const [phase, label] of Object.entries(expected)) {
    assert.equal(phaseLabel(phase as TurnPhase), label);
  }
});

test("settledView requires both an idle server and learner wait", () => {
  assert.equal(settledView({ phase: "idle", awaiting_student: true }), true);
  assert.equal(settledView({ phase: "idle", awaiting_student: false }), false);
  assert.equal(settledView({ phase: "updating", awaiting_student: true }), false);
  assert.equal(settledView({ phase: "failed", awaiting_student: true }), false);
});

test("shouldKeepPolling stops outside updating and at the deadline", () => {
  const startedAt = 10_000;
  assert.equal(
    shouldKeepPolling(
      { phase: "updating", awaiting_student: false },
      startedAt,
      startedAt + TURN_DEADLINE_MS - 1,
    ),
    true,
  );
  assert.equal(
    shouldKeepPolling(
      { phase: "updating", awaiting_student: false },
      startedAt,
      startedAt + TURN_DEADLINE_MS,
    ),
    false,
  );
  assert.equal(
    shouldKeepPolling(
      { phase: "idle", awaiting_student: true },
      startedAt,
      startedAt + 1,
    ),
    false,
  );
  assert.equal(
    shouldKeepPolling(
      { phase: "failed", awaiting_student: false },
      startedAt,
      startedAt + 1,
    ),
    false,
  );
});

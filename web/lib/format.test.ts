import assert from "node:assert/strict";
import test from "node:test";

import {
  beliefLine,
  confirmationCopy,
  percent,
  type Confirmation,
} from "./format.ts";

test("percent rounds and clamps learner-visible belief values", () => {
  assert.equal(percent(0.2835), "28%");
  assert.equal(percent(0.4866), "49%");
  assert.equal(percent(0.6321), "63%");
  assert.equal(percent(1.4), "100%");
  assert.equal(percent(-0.2), "0%");
});

test("beliefLine labels mastery and evidence confidence", () => {
  assert.equal(
    beliefLine(0.885, 0.632),
    "89% estimated · 63% confidence",
  );
});

test("confirmation copy gives a reason without exposing another number", () => {
  const reasons: (Confirmation | null)[] = [
    "needs_more_evidence",
    "needs_consistent_answers",
    null,
  ];

  for (const reason of reasons) {
    const copy = confirmationCopy(reason);
    assert.ok(copy.endsWith("."));
    assert.doesNotMatch(copy, /[%\d]/);
  }
});

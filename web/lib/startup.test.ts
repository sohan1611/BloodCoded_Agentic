import assert from "node:assert/strict";
import test from "node:test";

import { startupDecision } from "./startup.ts";

test("startup waits while the account session is pending", () => {
  assert.equal(
    startupDecision({
      accountPending: true,
      hasAccount: false,
      engineOnline: true,
      me: { exists: true },
    }),
    "wait",
  );
});

test("startup sends a signed-out visitor to sign in", () => {
  assert.equal(
    startupDecision({
      accountPending: false,
      hasAccount: false,
      engineOnline: true,
      me: { exists: true },
    }),
    "sign-in",
  );
});

test("startup waits for an offline engine instead of showing onboarding", () => {
  assert.equal(
    startupDecision({
      accountPending: false,
      hasAccount: true,
      engineOnline: false,
      me: { exists: false },
    }),
    "wait",
  );
});

test("startup waits until the learner lookup has completed", () => {
  assert.equal(
    startupDecision({
      accountPending: false,
      hasAccount: true,
      engineOnline: true,
      me: null,
    }),
    "wait",
  );
});

test("startup resumes a returning learner", () => {
  assert.equal(
    startupDecision({
      accountPending: false,
      hasAccount: true,
      engineOnline: true,
      me: { exists: true },
    }),
    "resume",
  );
});

test("startup welcomes a new learner", () => {
  assert.equal(
    startupDecision({
      accountPending: false,
      hasAccount: true,
      engineOnline: true,
      me: { exists: false },
    }),
    "welcome",
  );
});

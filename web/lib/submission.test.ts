import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_SUBMISSION_MESSAGE, checkSubmission } from "./submission.ts";

for (const code of ["", " ", "\n\n", "\t \r\n", "\u00a0"]) {
  test(`rejects blank submission ${JSON.stringify(code)}`, () => {
    assert.deepEqual(checkSubmission(code), {
      ok: false,
      message: EMPTY_SUBMISSION_MESSAGE,
    });
  });
}

for (const code of ["print(1)", "    print(1)\n"]) {
  test(`accepts non-blank submission ${JSON.stringify(code)}`, () => {
    assert.deepEqual(checkSubmission(code), { ok: true });
  });
}

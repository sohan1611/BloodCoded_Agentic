import assert from "node:assert/strict";
import test from "node:test";

import { isPlainLeftClick, type ClickLike } from "./home.ts";

const plain: ClickLike = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

test("a plain left click may be handled by the app", () => {
  assert.equal(isPlainLeftClick(plain), true);
});

for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
  test(`a ${modifier} click keeps the browser's link behaviour`, () => {
    assert.equal(isPlainLeftClick({ ...plain, [modifier]: true }), false);
  });
}

test("a middle click keeps the browser's link behaviour", () => {
  assert.equal(isPlainLeftClick({ ...plain, button: 1 }), false);
});

test("a click something else already handled is left alone", () => {
  assert.equal(isPlainLeftClick({ ...plain, defaultPrevented: true }), false);
});

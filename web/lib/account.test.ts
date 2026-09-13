import assert from "node:assert/strict";
import test from "node:test";

import {
  EDITOR_FONT_PX,
  deviceLabel,
  initialsFor,
  parsePreferences,
  providerLabel,
  relativeTime,
  safeImageUrl,
  validateName,
  validatePasswordChange,
} from "./account.ts";

test("initialsFor uses up to two name words, then email, then an empty fallback", () => {
  assert.equal(initialsFor("Ada Lovelace Byron", "ada@example.com"), "AL");
  assert.equal(initialsFor("  grace  ", "grace@example.com"), "G");
  assert.equal(initialsFor("   ", "learner@example.com"), "L");
  assert.equal(initialsFor("", ""), "");
});

test("safeImageUrl allows only absolute HTTP URLs", () => {
  assert.equal(safeImageUrl("https://images.example/avatar.png"), "https://images.example/avatar.png");
  assert.equal(safeImageUrl("http://images.example/avatar.png"), "http://images.example/avatar.png");
  assert.equal(safeImageUrl("javascript:alert(1)"), null);
  assert.equal(safeImageUrl("/avatar.png"), null);
  assert.equal(safeImageUrl("not a url"), null);
  assert.equal(safeImageUrl(null), null);
  assert.equal(safeImageUrl(undefined), null);
});

test("providerLabel names known providers and preserves an unknown id", () => {
  assert.equal(providerLabel("google"), "Google");
  assert.equal(providerLabel("credential"), "Email and password");
  assert.equal(providerLabel("github"), "github");
});

test("deviceLabel recognises supported browser and platform combinations", () => {
  assert.equal(
    deviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"),
    "Chrome on Windows",
  );
  assert.equal(
    deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile Safari/604.1"),
    "Safari on iPhone",
  );
  assert.equal(
    deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4) Gecko/20100101 Firefox/125.0"),
    "Firefox on macOS",
  );
  assert.equal(
    deviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 Edg/124.0"),
    "Edge on Windows",
  );
  assert.equal(
    deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) Version/17.4 Safari/605.1.15"),
    "Safari on macOS",
  );
  assert.equal(deviceLabel("Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0 Safari/537.36"), "Unknown device");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0) custom-browser/1.0"), "Unknown device");
  assert.equal(deviceLabel("curl/8.0"), "Unknown device");
  assert.equal(deviceLabel(null), "Unknown device");
  assert.equal(deviceLabel(undefined), "Unknown device");
});

test("relativeTime selects the matching unit and a short date after 30 days", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  assert.equal(relativeTime("2026-09-13T11:59:40.000Z", now), "just now");
  assert.equal(relativeTime("2026-09-13T11:59:00.000Z", now), "1 minute ago");
  assert.equal(relativeTime("2026-09-13T11:55:00.000Z", now), "5 minutes ago");
  assert.equal(relativeTime("2026-09-13T11:00:00.000Z", now), "1 hour ago");
  assert.equal(relativeTime("2026-09-13T09:00:00.000Z", now), "3 hours ago");
  assert.equal(relativeTime("2026-09-12T12:00:00.000Z", now), "1 day ago");
  assert.equal(relativeTime("2026-09-11T12:00:00.000Z", now), "2 days ago");
  assert.equal(relativeTime("2026-08-14T12:00:00.000Z", now), "30 days ago");
  assert.equal(
    relativeTime("2026-08-01T12:00:00.000Z", now),
    new Date("2026-08-01T12:00:00.000Z").toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
  );
  assert.equal(relativeTime("2026-09-13T12:01:00.000Z", now), "just now");
  assert.equal(relativeTime("not-a-date", now), "Unknown date");
});

test("validateName requires a trimmed name no longer than 64 characters", () => {
  assert.equal(validateName(""), "Enter your full name.");
  assert.equal(validateName("   "), "Enter your full name.");
  assert.equal(validateName("A"), null);
  assert.equal(validateName("x".repeat(64)), null);
  assert.equal(validateName("x".repeat(65)), "Use 64 characters or fewer.");
});

test("validatePasswordChange reports each invalid branch and accepts valid input", () => {
  assert.equal(validatePasswordChange({ current: "", next: "newpassword", confirm: "newpassword" }), "Enter your current password.");
  assert.equal(validatePasswordChange({ current: "oldpassword", next: "short", confirm: "short" }), "Use at least 8 characters for your new password.");
  assert.equal(validatePasswordChange({ current: "samepassword", next: "samepassword", confirm: "samepassword" }), "Choose a password different from your current password.");
  assert.equal(validatePasswordChange({ current: "oldpassword", next: "newpassword", confirm: "different" }), "The new passwords do not match.");
  assert.equal(validatePasswordChange({ current: "oldpassword", next: "newpassword", confirm: "newpassword" }), null);
});

test("parsePreferences accepts known values and safely defaults every junk branch", () => {
  assert.deepEqual(parsePreferences(JSON.stringify({ editorTextSize: "default" })), { editorTextSize: "default" });
  assert.deepEqual(parsePreferences(JSON.stringify({ editorTextSize: "large" })), { editorTextSize: "large" });
  assert.deepEqual(parsePreferences(JSON.stringify({ editorTextSize: "larger" })), { editorTextSize: "larger" });
  assert.deepEqual(parsePreferences(null), { editorTextSize: "default" });
  assert.deepEqual(parsePreferences(""), { editorTextSize: "default" });
  assert.deepEqual(parsePreferences("{"), { editorTextSize: "default" });
  assert.deepEqual(parsePreferences("null"), { editorTextSize: "default" });
  assert.deepEqual(parsePreferences("[]"), { editorTextSize: "default" });
  assert.deepEqual(parsePreferences("42"), { editorTextSize: "default" });
  assert.deepEqual(parsePreferences('"large"'), { editorTextSize: "default" });
  assert.deepEqual(parsePreferences(JSON.stringify({ editorTextSize: "huge" })), { editorTextSize: "default" });
  assert.deepEqual(EDITOR_FONT_PX, { default: 16, large: 18, larger: 20 });
});

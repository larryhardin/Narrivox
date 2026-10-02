import assert from "node:assert/strict";
import test from "node:test";
import { backLayerCount, popBackLayer, pushBackLayer } from "./back-stack.ts";
import { interfaceSettingsFrom } from "./interface-settings.ts";

test("back layers dismiss from the top", () => {
  const seen: string[] = [];
  const removeBook = pushBackLayer(() => seen.push("book"));
  const removeDialog = pushBackLayer(() => seen.push("dialog"));
  assert.equal(popBackLayer(), true);
  assert.deepEqual(seen, ["dialog"]);
  removeDialog();
  assert.equal(popBackLayer(), true);
  assert.deepEqual(seen, ["dialog", "book"]);
  removeBook();
  assert.equal(popBackLayer(), false);
  assert.equal(backLayerCount(), 0);
});

test("close confirmation stays off unless it is explicitly enabled", () => {
  assert.equal(interfaceSettingsFrom(null).skipExitConfirm, true);
  assert.equal(interfaceSettingsFrom("nope").skipExitConfirm, true);
  assert.equal(interfaceSettingsFrom("{}").skipExitConfirm, true);
  assert.equal(interfaceSettingsFrom('{"skipExitConfirm":true}').skipExitConfirm, true);
  assert.equal(interfaceSettingsFrom('{"skipExitConfirm":false}').skipExitConfirm, false);
});

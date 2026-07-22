import assert from "node:assert/strict";
import test from "node:test";
import { SCOPE_INSTRUCTIONS } from "../server/providers.ts";

test("page and document scopes have distinct edit boundaries", () => {
  assert.match(SCOPE_INSTRUCTIONS.page, /当前页/);
  assert.match(SCOPE_INSTRUCTIONS.page, /其他页保持不变/);
  assert.match(SCOPE_INSTRUCTIONS.document, /整个 HTML 文件/);
  assert.match(SCOPE_INSTRUCTIONS.document, /所有页面/);
});

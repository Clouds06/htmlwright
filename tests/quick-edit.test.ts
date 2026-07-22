import assert from "node:assert/strict";
import test from "node:test";
import { applyQuickEdit } from "../server/quick-edit.ts";

test("quick edit changes only the targeted element source", () => {
  const source = "<!doctype html><html><head><title>Keep</title></head><body><p class='lead'>Hello</p><p>Other</p></body></html>";
  const result = applyQuickEdit(source, {
    selectedElement: { tag: "p", classes: ["lead"], text: "Hello", outerHTML: '<p class="lead">Hello</p>', sourcePath: [1, 0] },
    changes: { text: "Hello & welcome", color: "#336699", fontSize: 20 },
  });

  assert.match(result, /<p class='lead' style="color: #336699; font-size: 20px">Hello &amp; welcome<\/p>/);
  assert.match(result, /<title>Keep<\/title>/);
  assert.match(result, /<p>Other<\/p>/);
});

test("quick edit preserves existing inline styles", () => {
  const source = "<html><body><div style=\"padding: 8px; color: red\">Text</div></body></html>";
  const result = applyQuickEdit(source, {
    selectedElement: { tag: "div", classes: [], text: "Text", outerHTML: '<div style="padding: 8px; color: red">Text</div>', sourcePath: [1, 0] },
    changes: { backgroundColor: "#eef5fc" },
  });

  assert.match(result, /style="padding: 8px; color: red; background-color: #eef5fc"/);
});

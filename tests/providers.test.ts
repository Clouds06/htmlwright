import assert from "node:assert/strict";
import test from "node:test";
import { extractHtml } from "../server/providers.ts";

const DOC = "<!doctype html><html><head></head><body><h1>hi</h1></body></html>";

test("extractHtml reads content between the START/END markers", () => {
  const raw = `sure, here it is:\n<<<START>>>\n${DOC}\n<<<END>>>\nhope that helps`;
  assert.equal(extractHtml(raw), DOC);
});

test("extractHtml tolerates a markdown code fence around the document", () => {
  const raw = "```html\n" + DOC + "\n```";
  assert.equal(extractHtml(raw), DOC);
});

test("extractHtml falls back to a bare <html> document when markers are missing", () => {
  const raw = `Here is the updated page:\n\n${DOC}`;
  assert.equal(extractHtml(raw), DOC);
});

test("extractHtml rejects output with no HTML document", () => {
  assert.throws(() => extractHtml("I changed the color to blue for you."));
});

test("extractHtml rejects a truncated, unclosed document", () => {
  assert.throws(() => extractHtml("<<<START>>><!doctype html><html><body><h1>hi</h1><<<END>>>"));
});

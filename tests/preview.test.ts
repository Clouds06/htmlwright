import assert from "node:assert/strict";
import test from "node:test";
import { injectPreview, stripRuntimeAttributes } from "../server/preview.ts";

test("preview injection adds a base and bridge without mutating the source value", () => {
  const source = "<!doctype html><html><head><title>x</title></head><body><h1>Hello</h1></body></html>";
  const preview = injectPreview(source);
  assert.match(preview, /<base href="\/target-assets\/">/);
  assert.match(preview, /htmlwright-bridge/);
  assert.equal(source.includes("htmlwright-bridge"), false);
});

test("runtime attributes are removed before model context matching", () => {
  const html = '<section data-htmlwright-unit="0"><h1 data-htmlwright-id="4">Hello</h1></section>';
  assert.equal(stripRuntimeAttributes(html), "<section><h1>Hello</h1></section>");
});

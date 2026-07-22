import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectSession } from "../server/session.ts";

test("candidate stays in memory until accept, then snapshot and undo restore the file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "htmlwright-test-"));
  const file = path.join(directory, "page.html");
  const original = "<!doctype html><html><body><h1>Hello</h1></body></html>";
  await writeFile(file, original, "utf8");
  process.env.NODE_ENV = "test";
  const session = await ProjectSession.create(file);
  try {
    await session.edit({ intent: "mark the heading", scope: "element", provider: "demo", selectedElement: { tag: "h1", classes: [], text: "Hello", outerHTML: "<h1>Hello</h1>" } }, "http://127.0.0.1:1");
    assert.match(session.candidateHtml, /data-htmlwright-demo="edited"/);
    assert.equal(await readFile(file, "utf8"), original);
    const accepted = await session.accept();
    assert.match(await readFile(file, "utf8"), /data-htmlwright-demo="edited"/);
    assert.equal(await readFile(accepted.snapshot, "utf8"), original);
    await session.undo();
    assert.equal(await readFile(file, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reject discards a candidate without touching disk", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "htmlwright-test-"));
  const file = path.join(directory, "page.html");
  const original = "<!doctype html><html><body><p>Text</p></body></html>";
  await writeFile(file, original, "utf8");
  process.env.NODE_ENV = "test";
  const session = await ProjectSession.create(file);
  try {
    await session.edit({ intent: "mark", scope: "document", provider: "demo" }, "http://127.0.0.1:1");
    await session.reject();
    assert.equal(session.candidateHtml, original);
    assert.equal(await readFile(file, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pending candidate is restored after a service restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "htmlwright-test-"));
  const file = path.join(directory, "page.html");
  const original = "<!doctype html><html><body><p>Text</p></body></html>";
  await writeFile(file, original, "utf8");
  process.env.NODE_ENV = "test";
  try {
    const first = await ProjectSession.create(file);
    const pending = await first.edit({ intent: "mark", scope: "document", provider: "demo" }, "http://127.0.0.1:1");
    const pendingFile = path.join(directory, ".htmlwright", "pending-page.html.json");
    const stored = JSON.parse(await readFile(pendingFile, "utf8"));
    delete stored.pending.changes;
    await writeFile(pendingFile, JSON.stringify(stored), "utf8");
    const restored = await ProjectSession.create(file);
    assert.equal(restored.pending?.id, pending.id);
    assert.equal(restored.pending?.changes[0].legacy, true);
    assert.equal(restored.candidateHtml, first.candidateHtml);
    assert.equal(await readFile(file, "utf8"), original);
    await restored.reject();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("in-place mode writes immediately but still creates an undo snapshot", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "htmlwright-test-"));
  const file = path.join(directory, "page.html");
  const original = "<!doctype html><html><body><p>Text</p></body></html>";
  await writeFile(file, original, "utf8");
  process.env.NODE_ENV = "test";
  const session = await ProjectSession.create(file, true);
  try {
    const result = await session.edit({ intent: "mark", scope: "document", provider: "demo" }, "http://127.0.0.1:1");
    assert.ok(result.id);
    assert.match(await readFile(file, "utf8"), /data-htmlwright-demo="edited"/);
    assert.equal(session.pending, undefined);
    await session.undo();
    assert.equal(await readFile(file, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("quick edits accumulate in one candidate before writeback", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "htmlwright-test-"));
  const file = path.join(directory, "page.html");
  const original = "<!doctype html><html><body><p>Hello</p></body></html>";
  await writeFile(file, original, "utf8");
  const session = await ProjectSession.create(file);
  const selectedElement = { tag: "p", classes: [], text: "Hello", outerHTML: "<p>Hello</p>", sourcePath: [1, 0] };
  try {
    await session.quickEdit({ selectedElement, changes: { text: "Updated" } });
    const second = await session.quickEdit({ selectedElement: { ...selectedElement, text: "Updated", outerHTML: "<p>Updated</p>" }, changes: { color: "#336699" } });
    assert.equal(await readFile(file, "utf8"), original);
    assert.match(session.candidateHtml, /Updated/);
    assert.match(session.candidateHtml, /color: #336699/);
    assert.match(second.diff, /Updated/);
    assert.match(second.diff, /color: #336699/);
    assert.equal(second.changes.length, 2);
    assert.equal(second.changes[0].target?.tag, "p");
    assert.match(second.changes[0].intent, /文字改为/);
    assert.match(second.changes[1].intent, /#336699/);
    await session.accept();
    assert.equal(await readFile(file, "utf8"), session.candidateHtml);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AI edits retain a cumulative target-to-intent history", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "htmlwright-test-"));
  const file = path.join(directory, "page.html");
  await writeFile(file, "<!doctype html><html><body><h1>Hello</h1><p>Body</p></body></html>", "utf8");
  process.env.NODE_ENV = "test";
  const session = await ProjectSession.create(file);
  try {
    const first = await session.edit({
      intent: "mark the heading",
      scope: "element",
      provider: "demo",
      selectedElement: { tag: "h1", classes: [], text: "Hello", outerHTML: "<h1>Hello</h1>", breadcrumb: "h1", sourcePath: [1, 0] },
    }, "http://127.0.0.1:1");
    assert.equal(first.changes.length, 1);
    assert.equal(first.changes[0].target?.breadcrumb, "h1");
    const second = await session.quickEdit({
      selectedElement: { tag: "p", classes: [], text: "Body", outerHTML: "<p>Body</p>", breadcrumb: "p", sourcePath: [1, 1] },
      changes: { fontSize: 18 },
    });
    assert.equal(second.changes.length, 2);
    assert.equal(second.changes[0].intent, "mark the heading");
    assert.equal(second.changes[1].target?.breadcrumb, "p");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

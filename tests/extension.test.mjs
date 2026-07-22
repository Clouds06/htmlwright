import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const extensionRoot = new URL('../extension/', import.meta.url);

test('extension manifest stays local-only and uses Manifest V3', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', extensionRoot), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, [
    'http://localhost/*',
    'http://127.0.0.1/*',
    'file:///*',
  ]);
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('nativeMessaging'));
  assert.ok(manifest.content_scripts[0].matches.includes('file:///*'));
  assert.ok(manifest.key);
  assert.equal(manifest.background.type, 'module');
  assert.match(manifest.content_security_policy.extension_pages, /connect-src http:\/\/localhost:\*/);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-eval/);
});

test('extension and installer scripts parse without syntax errors', () => {
  for (const file of ['service-worker.js', 'content-script.js', 'sidepanel.js']) {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL(file, extensionRoot))], { stdio: 'pipe' });
  }
  for (const file of ['native-host-common.mjs', 'install-native-host.mjs', 'uninstall-native-host.mjs']) {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`../scripts/${file}`, extensionRoot))], { stdio: 'pipe' });
  }
});

test('side panel exposes the four editing scopes', async () => {
  const html = await readFile(new URL('sidepanel.html', extensionRoot), 'utf8');
  for (const scope of ['element', 'unit', 'page', 'document']) {
    assert.match(html, new RegExp(`data-scope="${scope}"`));
  }
});

test('element selection requests the side panel immediately', async () => {
  const worker = await readFile(new URL('service-worker.js', extensionRoot), 'utf8');
  assert.match(worker, /htmlwright:selected/);
  assert.match(worker, /chrome\.sidePanel\.open\(\{ tabId: sender\.tab\.id \}\)/);
});

test('side panel can configure the Claude Code executable', async () => {
  const html = await readFile(new URL('sidepanel.html', extensionRoot), 'utf8');
  const script = await readFile(new URL('sidepanel.js', extensionRoot), 'utf8');
  assert.match(html, /id="claude-dialog"/);
  assert.match(html, /id="claude-path"/);
  assert.match(script, /nativeRequest\('configure'/);
  assert.match(script, /defaultClaudeExecutable/);
});

test('side panel exposes quick editing and candidate selection support', async () => {
  const html = await readFile(new URL('sidepanel.html', extensionRoot), 'utf8');
  const contentScript = await readFile(new URL('content-script.js', extensionRoot), 'utf8');
  assert.match(html, /id="quick-edit-panel"/);
  assert.match(html, /id="quick-apply-button"/);
  assert.match(contentScript, /sourcePath/);
  assert.match(contentScript, /previewFrame\.contentWindow/);
});

test('side panel makes every accumulated instruction target explicit', async () => {
  const html = await readFile(new URL('sidepanel.html', extensionRoot), 'utf8');
  const script = await readFile(new URL('sidepanel.js', extensionRoot), 'utf8');
  assert.match(html, /id="intent-target"/);
  assert.match(html, /id="change-list"/);
  assert.match(script, /if \(selection\) setScope\('element'\)/);
  assert.match(script, /pending\.changes/);
  assert.match(html, /当前候选包含/);
  assert.match(script, /升级前候选（目标信息未记录）/);
});

test('AI edits can be queued while the current candidate is generating', async () => {
  const html = await readFile(new URL('sidepanel.html', extensionRoot), 'utf8');
  const script = await readFile(new URL('sidepanel.js', extensionRoot), 'utf8');
  assert.match(html, /id="generation-queue"/);
  assert.match(script, /function enqueueGeneration/);
  assert.match(script, /function processGenerationQueue/);
  assert.match(script, /generationQueue\.shift\(\)/);
  assert.match(script, /structuredClone\(selection\)/);
  assert.match(script, /加入生成队列/);
  assert.match(script, /移出生成队列/);
});

test('code diff is collapsed by default and color-codes additions and deletions', async () => {
  const html = await readFile(new URL('sidepanel.html', extensionRoot), 'utf8');
  const script = await readFile(new URL('sidepanel.js', extensionRoot), 'utf8');
  const css = await readFile(new URL('sidepanel.css', extensionRoot), 'utf8');
  assert.match(html, /<details id="diff-details" class="diff-details">/);
  assert.match(html, /<summary>查看代码差异<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]+open/);
  assert.match(script, /classList\.add\('added'\)/);
  assert.match(script, /classList\.add\('removed'\)/);
  assert.match(css, /\.diff-line\.added/);
  assert.match(css, /\.diff-line\.removed/);
});

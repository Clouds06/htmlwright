#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  HOST_NAME,
  extensionIdFromKey,
  installedExtensionPath,
  manifestDirectories,
  projectRoot,
  runtimeRoot,
  shellQuote,
  wrapperPath,
} from './native-host-common.mjs';

const manifest = JSON.parse(await readFile(path.join(projectRoot, 'extension', 'manifest.json'), 'utf8'));
if (!manifest.key) throw new Error('extension/manifest.json 缺少固定扩展 key');
const extensionId = extensionIdFromKey(manifest.key);
const hostEntry = path.join(projectRoot, 'dist', 'server', 'native-host.js');
await access(hostEntry).catch(() => {
  throw new Error('找不到已构建的 Native Host；在源码目录中请先运行 npm run build');
});

async function findExecutable(name) {
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* continue */ }
  }
  throw new Error(`找不到 ${name}，请先安装并登录 Claude Code`);
}

const claudeExecutable = process.env.HTMLWRIGHT_CLAUDE_EXECUTABLE || await findExecutable('claude');
const nativePath = [...new Set([
  path.dirname(process.execPath),
  path.dirname(claudeExecutable),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
])].join(':');

await mkdir(runtimeRoot, { recursive: true });
await cp(path.join(projectRoot, 'extension'), installedExtensionPath, { recursive: true, force: true });
await writeFile(wrapperPath, [
  '#!/bin/sh',
  `export PATH=${shellQuote(nativePath)}`,
  `export HTMLWRIGHT_CLAUDE_EXECUTABLE=${shellQuote(claudeExecutable)}`,
  `exec ${shellQuote(process.execPath)} ${shellQuote(hostEntry)}`,
  '',
].join('\n'), 'utf8');
await chmod(wrapperPath, 0o755);

const nativeManifest = {
  name: HOST_NAME,
  description: 'htmlwright local Claude Code and file editing host',
  path: wrapperPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

for (const directory of manifestDirectories) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${HOST_NAME}.json`), `${JSON.stringify(nativeManifest, null, 2)}\n`, 'utf8');
}

console.log(`htmlwright Native Host 已安装。`);
console.log(`扩展 ID: ${extensionId}`);
console.log(`扩展目录: ${installedExtensionPath}`);
console.log(`Claude Code: ${claudeExecutable}`);
console.log('在 chrome://extensions 中重新加载扩展，并开启“允许访问文件网址”。');

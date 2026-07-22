#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { HOST_NAME, manifestDirectories, runtimeRoot } from './native-host-common.mjs';

for (const directory of manifestDirectories) {
  await rm(path.join(directory, `${HOST_NAME}.json`), { force: true });
}
await rm(runtimeRoot, { recursive: true, force: true });
console.log('htmlwright Native Host 已卸载。');

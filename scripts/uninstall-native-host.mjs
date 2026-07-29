#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { runtimeRoot, unregisterHost } from './native-host-common.mjs';

await unregisterHost();
await rm(runtimeRoot, { recursive: true, force: true });
console.log('htmlwright Native Host 已卸载。');

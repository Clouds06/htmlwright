import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOST_NAME = 'com.htmlwright.native';
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const runtimeRoot = path.join(homedir(), 'Library', 'Application Support', 'htmlwright');
export const wrapperPath = path.join(runtimeRoot, 'native-host.sh');
export const installedExtensionPath = path.join(runtimeRoot, 'extension');
export const manifestDirectories = [
  path.join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
  path.join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome Beta', 'NativeMessagingHosts'),
  path.join(homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
  path.join(homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
];

export function extensionIdFromKey(key) {
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16);
  return [...digest].flatMap(byte => [byte >> 4, byte & 15]).map(nibble => String.fromCharCode(97 + nibble)).join('');
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

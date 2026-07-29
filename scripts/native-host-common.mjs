import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const HOST_NAME = 'com.htmlwright.native';
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const isWindows = process.platform === 'win32';

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local');
}

// Where the installed extension copy, the wrapper, and (on Windows) the manifest live.
export const runtimeRoot = isWindows
  ? path.join(localAppData(), 'htmlwright')
  : path.join(homedir(), 'Library', 'Application Support', 'htmlwright');
// The browser launches this wrapper: a POSIX shell script on macOS, a batch file on Windows.
export const wrapperPath = path.join(runtimeRoot, isWindows ? 'native-host.bat' : 'native-host.sh');
export const installedExtensionPath = path.join(runtimeRoot, 'extension');

// macOS points browsers at a per-browser NativeMessagingHosts directory; Windows points them
// at a single manifest file referenced from a registry key.
const macManifestDirectories = [
  path.join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
  path.join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome Beta', 'NativeMessagingHosts'),
  path.join(homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
  path.join(homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
];
const windowsManifestPath = path.join(runtimeRoot, `${HOST_NAME}.json`);
const windowsRegistryKeys = [
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
];

export function extensionIdFromKey(key) {
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16);
  return [...digest].flatMap(byte => [byte >> 4, byte & 15]).map(nibble => String.fromCharCode(97 + nibble)).join('');
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

// Register the native messaging host with the locally installed browsers.
export async function registerHost(nativeManifest) {
  const json = `${JSON.stringify(nativeManifest, null, 2)}\n`;
  if (isWindows) {
    await writeFile(windowsManifestPath, json, 'utf8');
    for (const key of windowsRegistryKeys) {
      await execFileAsync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', windowsManifestPath, '/f']);
    }
    return;
  }
  for (const directory of macManifestDirectories) {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${HOST_NAME}.json`), json, 'utf8');
  }
}

export async function unregisterHost() {
  if (isWindows) {
    for (const key of windowsRegistryKeys) {
      await execFileAsync('reg', ['delete', key, '/f']).catch(() => undefined);
    }
    return;
  }
  for (const directory of macManifestDirectories) {
    await rm(path.join(directory, `${HOST_NAME}.json`), { force: true });
  }
}

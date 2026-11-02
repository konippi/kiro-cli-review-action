import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function serializeJson(path: string, value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) throw new TypeError(`Cannot serialize ${path} as JSON`);
  return `${json}\n`;
}

/** Writes pretty JSON with a trailing newline and private file permissions. */
export function writeJsonFile(path: string, value: unknown): void {
  const json = serializeJson(path, value);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Atomically replaces a private JSON file through a temporary file in the same directory. */
export function writeJsonFileAtomic(path: string, value: unknown): void {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;

  try {
    writeFileSync(temporary, serializeJson(path, value), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } catch (error: unknown) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Reads and parses a JSON file without validating its shape. */
export function readJsonFile(path: string): unknown {
  const text = readFileSync(path, 'utf8');

  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new SyntaxError(`Invalid JSON in ${path}`, { cause: error });
  }
}

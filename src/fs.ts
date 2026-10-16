import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface JsonFile<T> {
  readonly text: string;
  readonly value: T;
}

function readJson<T>(path: string): JsonFile<T> {
  const text = readFileSync(path, 'utf8');

  try {
    const value: T = JSON.parse(text);
    return { text, value };
  } catch (error: unknown) {
    throw new SyntaxError(`Invalid JSON in ${path}`, { cause: error });
  }
}

/** Writes pretty JSON with a trailing newline and private file permissions. */
export function writeJsonFile(path: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) throw new TypeError(`Cannot serialize ${path} as JSON`);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${json}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Reads a JSON file written by this action. */
export function readJsonFile<T>(path: string): T {
  return readJson<T>(path).value;
}

/** Reads JSON text written by this action without changing its formatting. */
export function readJsonText(path: string): string {
  return readJson<unknown>(path).text;
}

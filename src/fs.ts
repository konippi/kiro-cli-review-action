import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Writes pretty JSON with a trailing newline and private file permissions. */
export function writeJsonFile(path: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) throw new TypeError(`Cannot serialize ${path} as JSON`);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${json}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

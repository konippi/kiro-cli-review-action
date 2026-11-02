import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonFile, writeJsonFile, writeJsonFileAtomic } from '../src/fs.js';
import { createTemporaryDirectory } from './helpers/temporary-directory.js';

describe('writeJsonFile', () => {
  it('writes pretty JSON with a trailing newline and mode 0600', () => {
    const path = join(createTemporaryDirectory(), 'nested', 'value.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"stale":true}');
    chmodSync(path, 0o644);

    writeJsonFile(path, { enabled: true });

    expect(readFileSync(path, 'utf8')).toBe('{\n  "enabled": true\n}\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('rejects undefined without creating a file', () => {
    const path = join(createTemporaryDirectory(), 'nested', 'value.json');

    expect(() => writeJsonFile(path, undefined)).toThrow(
      new TypeError(`Cannot serialize ${path} as JSON`),
    );
    expect(existsSync(path)).toBe(false);
  });
});

describe('writeJsonFileAtomic', () => {
  it('replaces the file with private JSON and leaves no temporary file', () => {
    const directory = createTemporaryDirectory();
    const path = join(directory, 'value.json');
    writeFileSync(path, '{"stale":true}');

    writeJsonFileAtomic(path, { enabled: true });

    expect(readJsonFile(path)).toEqual({ enabled: true });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(directory)).toEqual(['value.json']);
  });
});

describe('readJsonFile', () => {
  it('rejects invalid JSON with its path', () => {
    const path = join(createTemporaryDirectory(), 'value.json');
    writeFileSync(path, '{bad');

    expect(() => readJsonFile(path)).toThrow(`Invalid JSON in ${path}`);
  });
});

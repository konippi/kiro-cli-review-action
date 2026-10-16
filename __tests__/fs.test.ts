import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonFile, readJsonText, writeJsonFile } from '../src/fs.js';

let temporaryDirectory = '';

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('writeJsonFile', () => {
  it('writes pretty JSON with a trailing newline and mode 0600', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiro-json-'));
    const path = join(temporaryDirectory, 'nested', 'value.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"stale":true}');
    chmodSync(path, 0o644);

    writeJsonFile(path, { enabled: true });

    expect(readFileSync(path, 'utf8')).toBe('{\n  "enabled": true\n}\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('round-trips action-written JSON', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiro-json-'));
    const path = join(temporaryDirectory, 'value.json');

    writeJsonFile(path, { enabled: true });

    expect(readJsonFile<{ readonly enabled: boolean }>(path)).toEqual({ enabled: true });
  });

  it('rejects undefined without creating a file', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiro-json-'));
    const path = join(temporaryDirectory, 'nested', 'value.json');

    expect(() => writeJsonFile(path, undefined)).toThrow(
      new TypeError(`Cannot serialize ${path} as JSON`),
    );
    expect(existsSync(path)).toBe(false);
  });
});

describe('readJsonText', () => {
  it('returns valid JSON text verbatim', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiro-json-'));
    const path = join(temporaryDirectory, 'value.json');
    const text = '{\n  "enabled": true\n}\n\n';
    writeFileSync(path, text);

    expect(readJsonText(path)).toBe(text);
  });

  it('rejects invalid JSON with its path', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiro-json-'));
    const path = join(temporaryDirectory, 'value.json');
    writeFileSync(path, '{bad');

    expect(() => readJsonText(path)).toThrow(`Invalid JSON in ${path}`);
  });
});

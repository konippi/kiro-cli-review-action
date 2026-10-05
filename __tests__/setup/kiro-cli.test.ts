import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolInstallSpec } from '../../src/setup/download.js';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  fetchText: vi.fn(),
  installTool: vi.fn<(spec: ToolInstallSpec) => Promise<string>>(),
}));

vi.mock('node:child_process', () => ({ execFileSync: mocks.execFileSync }));
vi.mock('../../src/setup/download.js', () => ({
  fetchText: mocks.fetchText,
  installTool: mocks.installTool,
}));
vi.mock('@actions/core', () => ({ info: vi.fn() }));

const temporaryDirectories: string[] = [];
const KIRO_VERSION = '2.27.1';
const OTHER_KIRO_VERSION = '2.28.0';
const KIRO_MUSL_SHA256 = 'cb032b322b61b58ef59f6540a50c66d3c7ab4db61dc65fd187325a7d618affe3';
let resolvedSha256: string | undefined;

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'setup-kiro-'));
  temporaryDirectories.push(directory);

  return directory;
}

function writeBinary(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'kiro');
}

function useRunner(arch: NodeJS.Architecture = 'x64', glibc = '2.31'): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  vi.spyOn(process, 'arch', 'get').mockReturnValue(arch);
  vi.spyOn(process.report, 'getReport').mockReturnValue({
    header: { glibcVersionRuntime: glibc },
  });
}

function installedSpec(): ToolInstallSpec {
  const call = mocks.installTool.mock.calls[0];
  if (!call) throw new Error('Expected installTool to be called');

  return call[0];
}

async function loadKiroCli(): Promise<typeof import('../../src/setup/kiro-cli.js')> {
  return import('../../src/setup/kiro-cli.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resolvedSha256 = undefined;
  useRunner();
  mocks.execFileSync.mockReturnValue(`kiro-cli ${KIRO_VERSION}\n`);
  mocks.installTool.mockImplementation(async (spec) => {
    resolvedSha256 = await spec.resolveSha256();

    return '/tool-cache/kiro-cli';
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('selectKiroArtifact', () => {
  it.each([
    ['x64', '2.34', 'kirocli-x86_64-linux.tar.gz'],
    ['x64', '2.33', 'kirocli-x86_64-linux-musl.tar.gz'],
    ['x64', 'garbage', 'kirocli-x86_64-linux-musl.tar.gz'],
    ['arm64', '2.39', 'kirocli-aarch64-linux.tar.gz'],
    ['arm64', '2.38', 'kirocli-aarch64-linux-musl.tar.gz'],
    ['arm64', '2.39.1-development', 'kirocli-aarch64-linux.tar.gz'],
    ['arm64', undefined, 'kirocli-aarch64-linux-musl.tar.gz'],
  ])('selects %s glibc %s', async (arch, glibcVersion, filename) => {
    const { selectKiroArtifact } = await loadKiroCli();

    expect(selectKiroArtifact({ platform: 'linux', arch, glibcVersion }).filename).toBe(filename);
  });

  it.each([
    ['darwin', 'x64'],
    ['linux', 'ia32'],
  ])('rejects unsupported runner %s/%s', async (platform, arch) => {
    const { selectKiroArtifact } = await loadKiroCli();

    expect(() => selectKiroArtifact({ platform, arch, glibcVersion: undefined })).toThrow(
      'unsupported runner',
    );
  });
});

describe('installKiroCli', () => {
  it('installs the default artifact with a variant-specific cache key', async () => {
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(KIRO_VERSION)).resolves.toBe('/tool-cache/kiro-cli/kiro-cli');
    expect(mocks.fetchText).not.toHaveBeenCalled();
    expect(mocks.installTool).toHaveBeenCalledWith({
      tool: 'kiro-cli',
      version: KIRO_VERSION,
      archKey: 'x64-musl',
      asset: 'kirocli-x86_64-linux-musl.tar.gz',
      url: `https://prod.download.cli.kiro.dev/stable/${KIRO_VERSION}/kirocli-x86_64-linux-musl.tar.gz`,
      resolveSha256: expect.any(Function),
      archiveDirectory: join('kirocli', 'bin'),
      verify: expect.any(Function),
    });
    expect(resolvedSha256).toBe(KIRO_MUSL_SHA256);
    expect(core.info).toHaveBeenCalledWith(
      'Selected kirocli-x86_64-linux-musl.tar.gz for x64 (musl)',
    );
  });

  it('uses the glibc variant in the cache key', async () => {
    const { installKiroCli } = await loadKiroCli();

    useRunner('x64', '2.34');
    await installKiroCli(KIRO_VERSION);
    expect(installedSpec().archKey).toBe('x64-gnu');
  });

  it('fetches and validates a sidecar once for an overridden version', async () => {
    const digest = 'a'.repeat(64);
    mocks.fetchText.mockResolvedValue(`${digest.toUpperCase()}\n`);
    const { installKiroCli } = await loadKiroCli();

    await installKiroCli(OTHER_KIRO_VERSION);

    expect(mocks.fetchText).toHaveBeenCalledWith(
      `https://prod.download.cli.kiro.dev/stable/${OTHER_KIRO_VERSION}/kirocli-x86_64-linux-musl.tar.gz.sha256`,
    );
    expect(mocks.fetchText).toHaveBeenCalledOnce();
    expect(resolvedSha256).toBe(digest);
  });

  it('rejects an invalid overridden-version digest before installation', async () => {
    mocks.fetchText.mockResolvedValue('not-a-digest');
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(OTHER_KIRO_VERSION)).rejects.toThrow(
      `Invalid SHA256 checksum for kiro-cli ${OTHER_KIRO_VERSION} (kirocli-x86_64-linux-musl.tar.gz); expected 64 hexadecimal characters`,
    );
    expect(mocks.installTool).toHaveBeenCalledOnce();
    expect(mocks.fetchText).toHaveBeenCalledOnce();
  });

  it('preserves the sidecar 404 message and cause', async () => {
    const fetchError = new Error('HTTP 404: Not Found');
    mocks.fetchText.mockRejectedValue(fetchError);
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(OTHER_KIRO_VERSION)).rejects.toMatchObject({
      message: `Failed to fetch kirocli-x86_64-linux-musl.tar.gz.sha256 for kiro-cli ${OTHER_KIRO_VERSION}`,
      cause: fetchError,
    });
    expect(mocks.fetchText).toHaveBeenCalledOnce();
  });

  it.each([
    ['kiro-cli 2.26.0\n', '2.26.0'],
    ['unexpected output', 'unknown'],
  ])('rejects staged version output %s before caching', async (output, actual) => {
    mocks.execFileSync.mockReturnValue(output);
    mocks.installTool.mockImplementation(async (spec) => {
      const source = join(temporaryDirectory(), 'kirocli', 'bin');
      writeBinary(join(source, 'kiro-cli'));
      spec.verify(source);

      return '/unreachable';
    });
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(KIRO_VERSION)).rejects.toThrow(
      `kiro-cli version verification failed: expected ${KIRO_VERSION}, got ${actual}`,
    );
  });

  it('preserves a staged launcher execution failure as the cause', async () => {
    const executionError = new Error('staged launcher failed');
    mocks.execFileSync.mockImplementation(() => {
      throw executionError;
    });
    mocks.installTool.mockImplementation(async (spec) => {
      const source = join(temporaryDirectory(), 'kirocli', 'bin');
      const binary = join(source, 'kiro-cli');
      writeBinary(binary);
      spec.verify(source);

      return '/unreachable';
    });
    const { installKiroCli } = await loadKiroCli();

    let rejection: unknown;
    try {
      await installKiroCli(KIRO_VERSION);
    } catch (error: unknown) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(Error);
    if (!(rejection instanceof Error)) throw new Error('Expected installKiroCli to reject');

    expect(rejection.message).toContain('kiro-cli version verification failed: could not run');
    expect(rejection.cause).toBe(executionError);
  });

  it('accepts the expected staged version', async () => {
    const source = join(temporaryDirectory(), 'kirocli', 'bin');
    const binary = join(source, 'kiro-cli');
    writeBinary(binary);
    mocks.installTool.mockImplementation(async (spec) => {
      spec.verify(source);

      return source;
    });
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(KIRO_VERSION)).resolves.toBe(binary);
    expect(execFileSync).toHaveBeenCalledWith(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    });
  });
});

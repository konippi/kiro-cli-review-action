import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveInstall } from '../../src/setup/download.js';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  fetchText: vi.fn(),
  home: '',
  installArchive: vi.fn<(installRoot: string, archive: ArchiveInstall) => Promise<void>>(),
}));

vi.mock('node:child_process', () => ({ execFileSync: mocks.execFileSync }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();

  return { ...actual, homedir: () => mocks.home };
});
vi.mock('../../src/setup/download.js', () => ({
  fetchText: mocks.fetchText,
  installArchive: mocks.installArchive,
}));
vi.mock('@actions/core', () => ({ info: vi.fn() }));

const temporaryDirectories: string[] = [];
const KIRO_VERSION = '2.27.1';
const OTHER_KIRO_VERSION = '2.28.0';
const KIRO_MUSL_SHA256 = 'cb032b322b61b58ef59f6540a50c66d3c7ab4db61dc65fd187325a7d618affe3';

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

async function loadKiroCli(): Promise<typeof import('../../src/setup/kiro-cli.js')> {
  return import('../../src/setup/kiro-cli.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.home = temporaryDirectory();
  useRunner();
  mocks.execFileSync.mockReturnValue(`kiro-cli ${KIRO_VERSION}\n`);
  mocks.installArchive.mockImplementation(async (installRoot, archive) => {
    const extractDirectory = join(installRoot, 'staged-extract');
    writeBinary(join(extractDirectory, 'kirocli', 'bin', 'kiro-cli'));
    archive.verify?.(extractDirectory);

    for (const executable of archive.executables) writeBinary(executable.destination);
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
  it('reuses an exact installed version after validation', async () => {
    const binary = join(mocks.home, '.local', 'bin', 'kiro-cli');
    writeBinary(binary);
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(KIRO_VERSION, join(mocks.home, 'install'))).resolves.toBe(binary);
    expect(execFileSync).toHaveBeenCalledWith(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    });
    expect(mocks.installArchive).not.toHaveBeenCalled();
    expect(mocks.fetchText).not.toHaveBeenCalled();
  });

  it('reinstalls when the installed launcher fails to execute', async () => {
    const installRoot = join(mocks.home, 'install');
    const binary = join(mocks.home, '.local', 'bin', 'kiro-cli');
    const executionError = new Error('installed launcher failed');
    writeBinary(binary);
    mocks.execFileSync.mockImplementation((launcher: string) => {
      if (launcher === binary) throw executionError;

      return `kiro-cli ${KIRO_VERSION}\n`;
    });
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(KIRO_VERSION, installRoot)).resolves.toBe(binary);
    expect(mocks.installArchive).toHaveBeenCalledOnce();
    expect(readFileSync(binary, 'utf8')).toBe('kiro');
  });

  it('installs the default artifact, verifies its staged launcher, and publishes primary last', async () => {
    const installRoot = join(mocks.home, 'install');
    const binaryDirectory = join(mocks.home, '.local', 'bin');
    const stagedBinary = join(installRoot, 'staged-extract', 'kirocli', 'bin', 'kiro-cli');
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(KIRO_VERSION, installRoot)).resolves.toBe(
      join(binaryDirectory, 'kiro-cli'),
    );
    expect(mocks.fetchText).not.toHaveBeenCalled();
    expect(mocks.installArchive).toHaveBeenCalledWith(installRoot, {
      url: `https://prod.download.cli.kiro.dev/stable/${KIRO_VERSION}/kirocli-x86_64-linux-musl.tar.gz`,
      sha256: KIRO_MUSL_SHA256,
      executables: [
        {
          source: join('kirocli', 'bin', 'kiro-cli-chat'),
          destination: join(binaryDirectory, 'kiro-cli-chat'),
        },
        {
          source: join('kirocli', 'bin', 'kiro-cli-term'),
          destination: join(binaryDirectory, 'kiro-cli-term'),
        },
        {
          source: join('kirocli', 'bin', 'kiro-cli'),
          destination: join(binaryDirectory, 'kiro-cli'),
        },
      ],
      verify: expect.any(Function),
    });
    expect(execFileSync).toHaveBeenCalledWith(stagedBinary, ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    });
  });

  it('fetches and validates a sidecar for an overridden version', async () => {
    const digest = 'a'.repeat(64);
    mocks.fetchText.mockResolvedValue(`${digest.toUpperCase()}\n`);
    mocks.execFileSync.mockReturnValue(`kiro-cli ${OTHER_KIRO_VERSION}\n`);
    const { installKiroCli } = await loadKiroCli();

    await installKiroCli(OTHER_KIRO_VERSION, join(mocks.home, 'install'));

    expect(mocks.fetchText).toHaveBeenCalledWith(
      `https://prod.download.cli.kiro.dev/stable/${OTHER_KIRO_VERSION}/kirocli-x86_64-linux-musl.tar.gz.sha256`,
    );
    expect(mocks.installArchive).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sha256: digest }),
    );
  });

  it('rejects an invalid overridden-version digest before installation', async () => {
    mocks.fetchText.mockResolvedValue('not-a-digest');
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(OTHER_KIRO_VERSION, join(mocks.home, 'install'))).rejects.toThrow(
      `Invalid SHA256 checksum for kiro-cli ${OTHER_KIRO_VERSION} (kirocli-x86_64-linux-musl.tar.gz); expected 64 hexadecimal characters`,
    );
    expect(mocks.installArchive).not.toHaveBeenCalled();
  });

  it('preserves the checksum-fetch failure message and cause', async () => {
    const fetchError = new Error('offline');
    mocks.fetchText.mockRejectedValue(fetchError);
    const { installKiroCli } = await loadKiroCli();

    await expect(
      installKiroCli(OTHER_KIRO_VERSION, join(mocks.home, 'install')),
    ).rejects.toMatchObject({
      message: `Failed to fetch kirocli-x86_64-linux-musl.tar.gz.sha256 for kiro-cli ${OTHER_KIRO_VERSION}`,
      cause: fetchError,
    });
  });

  it('leaves pre-existing executables untouched when staged version verification fails', async () => {
    const binaryDirectory = join(mocks.home, '.local', 'bin');
    const existingExecutables = new Map(
      ['kiro-cli-chat', 'kiro-cli-term', 'kiro-cli'].map((name) => [
        join(binaryDirectory, name),
        `existing ${name}`,
      ]),
    );
    for (const [path, content] of existingExecutables) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    mocks.execFileSync.mockReturnValue('kiro-cli 2.26.0\n');
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(KIRO_VERSION, join(mocks.home, 'install'))).rejects.toThrow(
      `kiro-cli version verification failed: expected ${KIRO_VERSION}, got 2.26.0`,
    );
    for (const [path, content] of existingExecutables) {
      expect(readFileSync(path, 'utf8')).toBe(content);
    }
  });

  it('rejects malformed staged version output without publishing executables', async () => {
    const binaryDirectory = join(mocks.home, '.local', 'bin');
    const executablePaths = ['kiro-cli-chat', 'kiro-cli-term', 'kiro-cli'].map((name) =>
      join(binaryDirectory, name),
    );
    mocks.execFileSync.mockReturnValue('unexpected output');
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(KIRO_VERSION, join(mocks.home, 'install'))).rejects.toThrow(
      `kiro-cli version verification failed: expected ${KIRO_VERSION}, got unknown`,
    );
    expect(mocks.installArchive).toHaveBeenCalledOnce();
    expect(executablePaths.every((path) => !existsSync(path))).toBe(true);
  });

  it('reports a staged launcher execution failure without publishing executables', async () => {
    const installRoot = join(mocks.home, 'install');
    const binaryDirectory = join(mocks.home, '.local', 'bin');
    const stagedBinary = join(installRoot, 'staged-extract', 'kirocli', 'bin', 'kiro-cli');
    const executablePaths = ['kiro-cli-chat', 'kiro-cli-term', 'kiro-cli'].map((name) =>
      join(binaryDirectory, name),
    );
    const executionError = new Error('staged launcher failed');
    mocks.execFileSync.mockImplementation((launcher: string) => {
      if (launcher === stagedBinary) throw executionError;

      return `kiro-cli ${KIRO_VERSION}\n`;
    });
    const { installKiroCli } = await loadKiroCli();

    let rejection: unknown;
    try {
      await installKiroCli(KIRO_VERSION, installRoot);
    } catch (error: unknown) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(Error);
    if (!(rejection instanceof Error)) throw new Error('Expected installKiroCli to reject');

    expect(rejection.message).toBe(
      `kiro-cli version verification failed: could not run ${stagedBinary} --version`,
    );
    expect(rejection.cause).toBe(executionError);
    expect(execFileSync).toHaveBeenCalledWith(stagedBinary, ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    });
    expect(mocks.installArchive).toHaveBeenCalledOnce();
    expect(executablePaths.every((path) => !existsSync(path))).toBe(true);
  });
});

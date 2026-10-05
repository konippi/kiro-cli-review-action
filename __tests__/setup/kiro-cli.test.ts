import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  mocks.installArchive.mockImplementation(async (_installRoot, archive) => {
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
    });
    expect(mocks.installArchive).not.toHaveBeenCalled();
    expect(mocks.fetchText).not.toHaveBeenCalled();
  });

  it('installs the default artifact with its embedded checksum and primary binary last', async () => {
    const installRoot = join(mocks.home, 'install');
    const binaryDirectory = join(mocks.home, '.local', 'bin');
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

  it('rejects a post-install version mismatch', async () => {
    mocks.execFileSync.mockReturnValue('kiro-cli 2.26.0\n');
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(KIRO_VERSION, join(mocks.home, 'install'))).rejects.toThrow(
      `kiro-cli version verification failed: expected ${KIRO_VERSION}, got 2.26.0`,
    );
  });

  it('treats malformed version output as not installed', async () => {
    const binary = join(mocks.home, '.local', 'bin', 'kiro-cli');
    writeBinary(binary);
    mocks.execFileSync.mockReturnValue('unexpected output');
    const { installKiroCli } = await loadKiroCli();

    await expect(installKiroCli(KIRO_VERSION, join(mocks.home, 'install'))).rejects.toThrow(
      `kiro-cli version verification failed: expected ${KIRO_VERSION}, got unknown`,
    );
    expect(mocks.installArchive).toHaveBeenCalledOnce();
    expect(existsSync(binary)).toBe(true);
  });
});

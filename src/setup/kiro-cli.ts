import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { isPlainObject } from '../guards.js';
import { fetchText, installArchive } from './download.js';

/** Kiro CLI version installed unless kiro_cli_version overrides it. */
export const DEFAULT_KIRO_CLI_VERSION = '2.27.1';

const KIRO_CLI_BASE_URL = 'https://prod.download.cli.kiro.dev/stable';
const ARCHIVE_BIN_DIRECTORY = join('kirocli', 'bin');

type SupportedArchitecture = 'x64' | 'arm64';
type LibcVariant = 'gnu' | 'musl';

/** A glibc release version, compared on MAJOR.MINOR only. */
interface GlibcVersion {
  readonly major: number;
  readonly minor: number;
}

const ARTIFACTS = {
  'x64-gnu': {
    filename: 'kirocli-x86_64-linux.tar.gz',
    variant: 'gnu',
  },
  'arm64-gnu': {
    filename: 'kirocli-aarch64-linux.tar.gz',
    variant: 'gnu',
  },
  'x64-musl': {
    filename: 'kirocli-x86_64-linux-musl.tar.gz',
    variant: 'musl',
  },
  'arm64-musl': {
    filename: 'kirocli-aarch64-linux-musl.tar.gz',
    variant: 'musl',
  },
} as const satisfies Readonly<
  Record<
    `${SupportedArchitecture}-${LibcVariant}`,
    { readonly filename: string; readonly variant: LibcVariant }
  >
>;

type KiroArtifactFilename = (typeof ARTIFACTS)[keyof typeof ARTIFACTS]['filename'];

const DEFAULT_KIRO_CLI_SHA256: Readonly<Record<KiroArtifactFilename, string>> = {
  'kirocli-x86_64-linux.tar.gz': '3c0d7268a4bfb73f8e827822049978fa578e020b271afc1021c7532602d45d99',
  'kirocli-aarch64-linux.tar.gz':
    '33ad5462c3111ba4ef527f1d58bda08a9d1997e0ae73841a7c2ca734ebcba2d0',
  'kirocli-x86_64-linux-musl.tar.gz':
    'cb032b322b61b58ef59f6540a50c66d3c7ab4db61dc65fd187325a7d618affe3',
  'kirocli-aarch64-linux-musl.tar.gz':
    '2b0811ecf7128c850a0d5396596badf2c85e6e8d307c0d3bcc8674798e11ac64',
};

// Kiro's glibc builds require at least these runtime versions; older hosts use the musl build.
const MINIMUM_GLIBC: Readonly<Record<SupportedArchitecture, GlibcVersion>> = {
  x64: { major: 2, minor: 34 },
  arm64: { major: 2, minor: 39 },
};

// glibc reports MAJOR.MINOR; development builds append a third component that is ignored.
const GLIBC_VERSION = /^(?<major>\d+)\.(?<minor>\d+)/;
const KIRO_CLI_VERSION_OUTPUT = /^kiro-cli (?<version>\d+\.\d+\.\d+)\s*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A downloadable Kiro CLI artifact. */
export interface KiroArtifact {
  readonly filename: KiroArtifactFilename;
  readonly variant: LibcVariant;
}

/** Runner attributes used to select a compatible Kiro CLI artifact. */
export interface RunnerPlatform {
  readonly platform: string;
  readonly arch: string;
  readonly glibcVersion: string | undefined;
}

function tryParseGlibcVersion(version: string): GlibcVersion | undefined {
  const groups = GLIBC_VERSION.exec(version)?.groups;
  if (groups?.major === undefined || groups.minor === undefined) return undefined;

  return { major: parseInt(groups.major, 10), minor: parseInt(groups.minor, 10) };
}

function isAtLeast(actual: GlibcVersion, minimum: GlibcVersion): boolean {
  return (
    actual.major > minimum.major ||
    (actual.major === minimum.major && actual.minor >= minimum.minor)
  );
}

function runtimeGlibcVersion(): string | undefined {
  const report = process.report?.getReport();
  if (!isPlainObject(report) || !isPlainObject(report.header)) return undefined;

  return typeof report.header.glibcVersionRuntime === 'string'
    ? report.header.glibcVersionRuntime
    : undefined;
}

function runKiroCliVersion(launcher: string): string {
  try {
    return execFileSync(launcher, ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    });
  } catch (error: unknown) {
    throw new Error(`kiro-cli version verification failed: could not run ${launcher} --version`, {
      cause: error,
    });
  }
}

function parseKiroCliVersion(output: string): string | undefined {
  return KIRO_CLI_VERSION_OUTPUT.exec(output)?.groups?.version;
}

function tryReadKiroCliVersion(launcher: string): string | undefined {
  if (!existsSync(launcher)) return undefined;

  try {
    return parseKiroCliVersion(runKiroCliVersion(launcher));
  } catch {
    return undefined;
  }
}

function assertKiroCliVersion(launcher: string, expected: string): void {
  const output = runKiroCliVersion(launcher);
  const actual = parseKiroCliVersion(output);
  if (actual !== expected) {
    throw new Error(
      `kiro-cli version verification failed: expected ${expected}, got ${actual ?? 'unknown'}`,
    );
  }
}

async function fetchKiroArtifactSha256(
  version: string,
  filename: KiroArtifactFilename,
): Promise<string> {
  const text = await fetchText(`${KIRO_CLI_BASE_URL}/${version}/${filename}.sha256`).catch(
    (error: unknown) => {
      throw new Error(`Failed to fetch ${filename}.sha256 for kiro-cli ${version}`, {
        cause: error,
      });
    },
  );

  const digest = text.trim().toLowerCase();
  if (!SHA256_HEX.test(digest)) {
    throw new Error(
      `Invalid SHA256 checksum for kiro-cli ${version} (${filename}); expected 64 hexadecimal characters`,
    );
  }

  return digest;
}

async function resolveKiroArtifactSha256(
  version: string,
  filename: KiroArtifactFilename,
): Promise<string> {
  return version === DEFAULT_KIRO_CLI_VERSION
    ? DEFAULT_KIRO_CLI_SHA256[filename]
    : fetchKiroArtifactSha256(version, filename);
}

/** Selects the Linux artifact compatible with the runner architecture and glibc. */
export function selectKiroArtifact(runner: RunnerPlatform): KiroArtifact {
  const arch = runner.arch;
  if (runner.platform !== 'linux' || (arch !== 'x64' && arch !== 'arm64')) {
    throw new Error(
      `unsupported runner: ${runner.platform}/${arch}; Linux x64 and arm64 are supported`,
    );
  }

  const glibc =
    runner.glibcVersion === undefined ? undefined : tryParseGlibcVersion(runner.glibcVersion);
  const variant = glibc !== undefined && isAtLeast(glibc, MINIMUM_GLIBC[arch]) ? 'gnu' : 'musl';
  const artifactKey = `${arch}-${variant}` satisfies keyof typeof ARTIFACTS;

  return ARTIFACTS[artifactKey];
}

/** Installs and verifies the requested Kiro CLI, reusing only an exact-version installation. */
export async function installKiroCli(version: string, installRoot: string): Promise<string> {
  const binaryDirectory = join(homedir(), '.local', 'bin');
  const binary = join(binaryDirectory, 'kiro-cli');

  if (tryReadKiroCliVersion(binary) === version) {
    core.info(`Reusing kiro-cli ${version}`);
    return binary;
  }

  const arch = process.arch;
  const artifact = selectKiroArtifact({
    platform: process.platform,
    arch,
    glibcVersion: runtimeGlibcVersion(),
  });
  core.info(`Selected ${artifact.filename} for ${arch} (${artifact.variant})`);

  const sha256 = await resolveKiroArtifactSha256(version, artifact.filename);

  const url = `${KIRO_CLI_BASE_URL}/${version}/${artifact.filename}`;
  // The launcher goes last so an interrupted install is never reused.
  const executables = ['kiro-cli-chat', 'kiro-cli-term', 'kiro-cli'].map((name) => ({
    source: join(ARCHIVE_BIN_DIRECTORY, name),
    destination: join(binaryDirectory, name),
  }));
  core.info(`Installing kiro-cli ${version} from ${url}`);

  await installArchive(installRoot, {
    url,
    sha256,
    executables,
    verify: (directory) =>
      assertKiroCliVersion(join(directory, ARCHIVE_BIN_DIRECTORY, 'kiro-cli'), version),
  });

  core.info(`kiro-cli ${version} installed and verified`);

  return binary;
}

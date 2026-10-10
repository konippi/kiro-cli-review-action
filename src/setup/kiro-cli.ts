import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import * as core from '@actions/core';
import * as semver from 'semver';
import { isPlainObject } from '../guards.js';
import { buildKiroProcessEnv } from '../kiro/env.js';
import { fetchText, installTool } from './download.js';

/** Kiro CLI version installed unless kiro_cli_version overrides it. */
export const DEFAULT_KIRO_CLI_VERSION = '2.27.1';

const MINIMUM_KIRO_CLI_VERSION = '2.27.1';

/** Throws unless the version is an exact release at or above the supported minimum. */
export function assertSupportedKiroCliVersion(version: string): void {
  if (
    semver.valid(version) !== version ||
    semver.prerelease(version) !== null ||
    !semver.gte(version, MINIMUM_KIRO_CLI_VERSION)
  ) {
    throw new Error(
      `Input kiro_cli_version is not supported: requested ${version}; supported versions are >=${MINIMUM_KIRO_CLI_VERSION}`,
    );
  }
}

const KIRO_CLI_BASE_URL = 'https://prod.download.cli.kiro.dev/stable';

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

interface KiroArtifact {
  readonly filename: KiroArtifactFilename;
  readonly variant: LibcVariant;
}

interface RunnerPlatform {
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
      env: buildKiroProcessEnv(process.env, dirname(launcher)),
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
export async function installKiroCli(version: string): Promise<string> {
  assertSupportedKiroCliVersion(version);

  const arch = process.arch;
  const artifact = selectKiroArtifact({
    platform: process.platform,
    arch,
    glibcVersion: runtimeGlibcVersion(),
  });
  core.info(`Selected ${artifact.filename} for ${arch} (${artifact.variant})`);

  const url = `${KIRO_CLI_BASE_URL}/${version}/${artifact.filename}`;
  const cacheDirectory = await installTool({
    tool: 'kiro-cli',
    version,
    archKey: `${arch}-${artifact.variant}`,
    asset: artifact.filename,
    url,
    resolveSha256: () => resolveKiroArtifactSha256(version, artifact.filename),
    archiveDirectory: join('kirocli', 'bin'),
    verify: (directory) => assertKiroCliVersion(join(directory, 'kiro-cli'), version),
  });

  return join(cacheDirectory, 'kiro-cli');
}

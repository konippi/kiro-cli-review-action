import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { EnvHttpProxyAgent, fetch, type Response } from 'undici';
import { isErrnoException } from '../errors.js';
import { withRetry } from '../retry.js';

const dispatcher = new EnvHttpProxyAgent();

/** An executable to publish from an extracted archive. */
export interface ArchiveExecutable {
  readonly source: string;
  readonly destination: string;
}

/** An archive to download, verify, and unpack into executables. */
export interface ArchiveInstall {
  readonly url: string;
  readonly sha256: string;
  readonly executables: ReadonlyArray<ArchiveExecutable>;
  readonly verify?: (extractDirectory: string) => void;
}

class HttpError extends Error {
  readonly status: number;

  constructor(response: Response) {
    super(`HTTP ${response.status}: ${response.statusText}`);
    this.status = response.status;
  }
}

async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function checkStatus(response: Response): Promise<void> {
  if (response.ok) return;
  await discardBody(response);
  throw new HttpError(response);
}

// tool-cache policy: statuses below 500 are permanent except 408 and 429.
function isRetryableDownloadError(error: unknown): boolean {
  return (
    !(error instanceof HttpError) ||
    error.status >= 500 ||
    error.status === 408 ||
    error.status === 429
  );
}

/** Fetches text with proxy support and retries transient download failures. */
export async function fetchText(url: string): Promise<string> {
  return withRetry(
    async () => {
      const response = await fetch(url, { dispatcher });
      await checkStatus(response);
      return response.text();
    },
    { isRetryable: isRetryableDownloadError },
  );
}

async function downloadVerified(
  url: string,
  destination: string,
  expectedSha256: string,
): Promise<void> {
  const actualSha256 = await withRetry(
    async () => {
      rmSync(destination, { force: true });

      try {
        const response = await fetch(url, { dispatcher });
        await checkStatus(response);

        // A successful empty response can be a transient proxy/CDN failure, so retry it.
        if (!response.body) throw new Error(`Empty response body for ${url}`);

        const hash = createHash('sha256');
        mkdirSync(dirname(destination), { recursive: true });
        await pipeline(
          Readable.fromWeb(response.body),
          async function* (chunks: AsyncIterable<Uint8Array>) {
            for await (const chunk of chunks) {
              hash.update(chunk);
              yield chunk;
            }
          },
          createWriteStream(destination),
        );

        return hash.digest('hex');
      } catch (error: unknown) {
        rmSync(destination, { force: true });
        throw error;
      }
    },
    { isRetryable: isRetryableDownloadError },
  );

  if (actualSha256 !== expectedSha256) {
    rmSync(destination, { force: true });
    throw new Error(
      `SHA256 mismatch for ${basename(destination)}: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
}

function createStagingDirectory(installRoot: string): string {
  mkdirSync(installRoot, { recursive: true });

  return mkdtempSync(join(installRoot, 'staging-'));
}

/** Installs through a same-directory temporary file so reuse never sees truncation or ETXTBSY. */
function installExecutable(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}`;

  try {
    copyFileSync(source, temporary);
    chmodSync(temporary, 0o755);
    renameSync(temporary, destination);
  } catch (error: unknown) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function extract(archive: string, destination: string): void {
  mkdirSync(destination, { recursive: true });

  try {
    execFileSync('tar', ['xzf', archive, '-C', destination], { stdio: 'pipe' });
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      throw new Error('Required executable "tar" was not found on PATH', { cause: error });
    }

    throw error;
  }
}

/** Downloads and verifies an archive, then atomically installs its executables. */
export async function installArchive(installRoot: string, archive: ArchiveInstall): Promise<void> {
  const filename = basename(new URL(archive.url).pathname);
  const stagingDirectory = createStagingDirectory(installRoot);

  try {
    const archivePath = join(stagingDirectory, filename);
    await downloadVerified(archive.url, archivePath, archive.sha256);

    const extractDirectory = join(stagingDirectory, 'extract');
    extract(archivePath, extractDirectory);
    archive.verify?.(extractDirectory);

    for (const executable of archive.executables) {
      installExecutable(join(extractDirectory, executable.source), executable.destination);
    }
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';

/** A tool archive to download, verify, extract, and cache. */
export interface ToolInstallSpec {
  readonly tool: string;
  readonly version: string;
  readonly archKey: string;
  readonly asset: string;
  readonly url: string;
  readonly resolveSha256: () => Promise<string>;
  readonly archiveDirectory?: string;
  readonly verify: (directory: string) => void;
}

/** Fetches text through the Actions tool-cache downloader. */
export async function fetchText(url: string): Promise<string> {
  const download = await tc.downloadTool(url);

  try {
    return await readFile(download, 'utf8');
  } finally {
    await Promise.allSettled([rm(download, { force: true })]);
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** Installs a verified tool archive into the Actions tool cache. */
export async function installTool(spec: ToolInstallSpec): Promise<string> {
  const hit = tc.find(spec.tool, spec.version, spec.archKey);
  if (hit) {
    try {
      spec.verify(hit);
      core.info(`Reusing ${spec.tool} ${spec.version}`);
      return hit;
    } catch {
      core.info(`Cached ${spec.tool} ${spec.version} failed verification; reinstalling`);
    }
  }

  core.info(`Installing ${spec.tool} ${spec.version} from ${spec.url}`);
  const expectedSha256 = await spec.resolveSha256();
  let archive: string | undefined;
  let extracted: string | undefined;

  try {
    archive = await tc.downloadTool(spec.url);

    const actualSha256 = await sha256(archive);
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `SHA256 mismatch for ${spec.asset}: expected ${expectedSha256}, got ${actualSha256}`,
      );
    }

    extracted = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'kiro-tool-extract-'));
    await tc.extractTar(archive, extracted, ['xz', '--no-same-owner']);

    const source =
      spec.archiveDirectory === undefined ? extracted : join(extracted, spec.archiveDirectory);
    spec.verify(source);

    const cacheDirectory = await tc.cacheDir(source, spec.tool, spec.version, spec.archKey);
    core.info(`${spec.tool} ${spec.version} installed and verified`);

    return cacheDirectory;
  } finally {
    const cleanups: Promise<void>[] = [];
    if (archive !== undefined) cleanups.push(rm(archive, { recursive: true, force: true }));
    if (extracted !== undefined) cleanups.push(rm(extracted, { recursive: true, force: true }));
    await Promise.allSettled(cleanups);
  }
}

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheDir: vi.fn(),
  downloadTool: vi.fn(),
  extractTar: vi.fn(),
  find: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  rm: mocks.rm,
}));
vi.mock('@actions/tool-cache', () => ({
  cacheDir: mocks.cacheDir,
  downloadTool: mocks.downloadTool,
  extractTar: mocks.extractTar,
  find: mocks.find,
}));
vi.mock('@actions/core', () => ({ info: vi.fn() }));

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'setup-download-'));
  temporaryDirectories.push(directory);

  return directory;
}

function temporaryFile(content: string): string {
  const path = join(temporaryDirectory(), 'download');
  writeFileSync(path, content);

  return path;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function loadDownload(): Promise<typeof import('../../src/setup/download.js')> {
  return import('../../src/setup/download.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.rm.mockImplementation(async (path: string) => {
    rmSync(path, { recursive: true, force: true });
  });
  mocks.find.mockReturnValue('');
  mocks.cacheDir.mockResolvedValue('/tool-cache/tool/1.2.3/x64');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('fetchText', () => {
  it('downloads text and removes the temporary file', async () => {
    const download = temporaryFile('checksum\n');
    mocks.downloadTool.mockResolvedValue(download);
    const { fetchText } = await loadDownload();

    await expect(fetchText('https://example.test/checksum')).resolves.toBe('checksum\n');
    expect(mocks.downloadTool).toHaveBeenCalledWith('https://example.test/checksum');
    expect(existsSync(download)).toBe(false);
  });

  it('preserves a read rejection when cleanup also rejects', async () => {
    const download = join(temporaryDirectory(), 'broken-link');
    symlinkSync(join(temporaryDirectory(), 'missing'), download);
    expect(lstatSync(download).isSymbolicLink()).toBe(true);
    mocks.downloadTool.mockResolvedValue(download);
    mocks.rm.mockRejectedValue(new Error('cleanup failed'));
    const { fetchText } = await loadDownload();

    await expect(fetchText('https://example.test/checksum')).rejects.toThrow('ENOENT');
    expect(mocks.rm).toHaveBeenCalledWith(download, { force: true });
  });

  it('propagates a tool-cache download rejection', async () => {
    mocks.downloadTool.mockRejectedValue(new Error('HTTP 404: Not Found'));
    const { fetchText } = await loadDownload();

    await expect(fetchText('https://example.test/checksum')).rejects.toThrow('HTTP 404: Not Found');
    expect(mocks.rm).not.toHaveBeenCalled();
  });
});

describe('installTool', () => {
  it('reuses a cache hit that passes verification without downloading', async () => {
    mocks.find.mockReturnValue('/tool-cache/hit');
    const verify = vi.fn();
    const { installTool } = await loadDownload();

    await expect(
      installTool({
        tool: 'tool',
        version: '1.2.3',
        archKey: 'x64',
        asset: 'tool.tar.gz',
        url: 'https://example.test/tool.tar.gz',
        resolveSha256: async () => '0'.repeat(64),
        verify,
      }),
    ).resolves.toBe('/tool-cache/hit');
    expect(mocks.find).toHaveBeenCalledWith('tool', '1.2.3', 'x64');
    expect(verify).toHaveBeenCalledWith('/tool-cache/hit');
    expect(core.info).toHaveBeenCalledWith('Reusing tool 1.2.3');
    expect(mocks.downloadTool).not.toHaveBeenCalled();
  });

  it('reinstalls a cache hit that fails verification and uses the extraction root', async () => {
    const archive = temporaryFile('archive');
    let extractionDirectory: string | undefined;
    mocks.find.mockReturnValue('/tool-cache/stale');
    mocks.downloadTool.mockResolvedValue(archive);
    mocks.extractTar.mockImplementation(async (_archive, destination) => {
      if (destination === undefined) throw new Error('missing extraction destination');
      extractionDirectory = destination;

      return destination;
    });
    const verify = vi.fn((directory: string) => {
      if (directory === '/tool-cache/stale') throw new Error('stale cache');
    });
    const { installTool } = await loadDownload();

    await installTool({
      tool: 'tool',
      version: '1.2.3',
      archKey: 'x64',
      asset: 'tool.tar.gz',
      url: 'https://example.test/tool.tar.gz',
      resolveSha256: async () => sha256('archive'),
      verify,
    });

    expect(core.info).toHaveBeenCalledWith('Cached tool 1.2.3 failed verification; reinstalling');
    expect(mocks.downloadTool).toHaveBeenCalledOnce();
    expect(extractionDirectory).toBeDefined();
    if (extractionDirectory === undefined) throw new Error('missing extraction destination');
    expect(verify).toHaveBeenNthCalledWith(2, extractionDirectory);
    expect(mocks.cacheDir).toHaveBeenCalledWith(extractionDirectory, 'tool', '1.2.3', 'x64');
  });

  it('downloads, verifies a joined archive directory, caches, and cleans up', async () => {
    const archive = temporaryFile('archive');
    const runnerTemporaryDirectory = temporaryDirectory();
    vi.stubEnv('RUNNER_TEMP', runnerTemporaryDirectory);
    let extractionDirectory: string | undefined;
    mocks.downloadTool.mockResolvedValue(archive);
    mocks.extractTar.mockImplementation(async (_archive, destination) => {
      if (destination === undefined) throw new Error('missing extraction destination');
      extractionDirectory = destination;
      mkdirSync(join(destination, 'nested', 'bin'), { recursive: true });

      return destination;
    });
    const verify = vi.fn();
    const resolveSha256 = vi.fn(async () => {
      expect(core.info).toHaveBeenCalledWith(
        'Installing tool 1.2.3 from https://example.test/tool.tar.gz',
      );

      return sha256('archive');
    });
    const { installTool } = await loadDownload();

    await expect(
      installTool({
        tool: 'tool',
        version: '1.2.3',
        archKey: 'x64-gnu',
        asset: 'tool.tar.gz',
        url: 'https://example.test/tool.tar.gz',
        resolveSha256,
        archiveDirectory: join('nested', 'bin'),
        verify,
      }),
    ).resolves.toBe('/tool-cache/tool/1.2.3/x64');
    expect(resolveSha256).toHaveBeenCalledOnce();
    expect(extractionDirectory).toBeDefined();
    if (extractionDirectory === undefined) throw new Error('missing extraction destination');
    expect(
      extractionDirectory.startsWith(join(runnerTemporaryDirectory, 'kiro-tool-extract-')),
    ).toBe(true);
    const source = join(extractionDirectory, 'nested', 'bin');
    expect(mocks.extractTar).toHaveBeenCalledWith(archive, extractionDirectory, [
      'xz',
      '--no-same-owner',
    ]);
    expect(verify).toHaveBeenCalledWith(source);
    expect(mocks.cacheDir).toHaveBeenCalledWith(source, 'tool', '1.2.3', 'x64-gnu');
    expect(core.info).toHaveBeenCalledWith('tool 1.2.3 installed and verified');
    expect(existsSync(archive)).toBe(false);
    expect(existsSync(extractionDirectory)).toBe(false);
  });

  it('uses the declared asset in a checksum mismatch', async () => {
    const archive = temporaryFile('wrong archive');
    mocks.downloadTool.mockResolvedValue(archive);
    const verify = vi.fn();
    const { installTool } = await loadDownload();

    await expect(
      installTool({
        tool: 'tool',
        version: '1.2.3',
        archKey: 'x64',
        asset: 'declared-asset.tar.gz',
        url: 'https://example.test/releases/download',
        resolveSha256: async () => '0'.repeat(64),
        verify,
      }),
    ).rejects.toThrow(
      `SHA256 mismatch for declared-asset.tar.gz: expected ${'0'.repeat(64)}, got ${sha256('wrong archive')}`,
    );
    expect(mocks.extractTar).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(mocks.cacheDir).not.toHaveBeenCalled();
    expect(existsSync(archive)).toBe(false);
  });

  it('does not cache and cleans up when fresh verification fails', async () => {
    const archive = temporaryFile('archive');
    let extractionDirectory: string | undefined;
    mocks.downloadTool.mockResolvedValue(archive);
    mocks.extractTar.mockImplementation(async (_archive, destination) => {
      if (destination === undefined) throw new Error('missing extraction destination');
      extractionDirectory = destination;

      return destination;
    });
    const { installTool } = await loadDownload();

    await expect(
      installTool({
        tool: 'tool',
        version: '1.2.3',
        archKey: 'x64',
        asset: 'tool.tar.gz',
        url: 'https://example.test/tool.tar.gz',
        resolveSha256: async () => sha256('archive'),
        verify: () => {
          throw new Error('staged version mismatch');
        },
      }),
    ).rejects.toThrow('staged version mismatch');
    expect(core.info).not.toHaveBeenCalledWith('tool 1.2.3 installed and verified');
    expect(mocks.cacheDir).not.toHaveBeenCalled();
    expect(existsSync(archive)).toBe(false);
    expect(extractionDirectory).toBeDefined();
    if (extractionDirectory === undefined) throw new Error('missing extraction destination');
    expect(existsSync(extractionDirectory)).toBe(false);
  });

  it('preserves an extraction error and attempts both cleanups when archive removal fails', async () => {
    const archive = temporaryFile('archive');
    const extractionError = new Error('tar failed');
    const cleanupError = new Error('archive cleanup failed');
    let extractionDirectory: string | undefined;
    mocks.downloadTool.mockResolvedValue(archive);
    mocks.rm.mockRejectedValueOnce(cleanupError);
    mocks.extractTar.mockImplementation(async (_archive, destination) => {
      if (destination === undefined) throw new Error('missing extraction destination');
      extractionDirectory = destination;
      writeFileSync(join(destination, 'partial'), 'partial archive');

      throw extractionError;
    });
    const { installTool } = await loadDownload();

    await expect(
      installTool({
        tool: 'tool',
        version: '1.2.3',
        archKey: 'x64',
        asset: 'tool.tar.gz',
        url: 'https://example.test/tool.tar.gz',
        resolveSha256: async () => sha256('archive'),
        verify: () => undefined,
      }),
    ).rejects.toBe(extractionError);
    expect(mocks.cacheDir).not.toHaveBeenCalled();
    expect(existsSync(archive)).toBe(true);
    expect(extractionDirectory).toBeDefined();
    if (extractionDirectory === undefined) throw new Error('missing extraction destination');
    expect(existsSync(extractionDirectory)).toBe(false);
    expect(mocks.rm).toHaveBeenCalledWith(archive, { recursive: true, force: true });
    expect(mocks.rm).toHaveBeenCalledWith(extractionDirectory, { recursive: true, force: true });
  });
});

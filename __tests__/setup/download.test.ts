import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stringArray(): string[] {
  return [];
}

const mocks = vi.hoisted(() => ({
  copyFileSync: vi.fn<(source: string, destination: string) => void>(),
  dispatcher: { name: 'proxy-dispatcher' },
  execFileSync: vi.fn(),
  extractedSources: stringArray(),
  fetch: vi.fn(),
  randomUUID: vi.fn(() => 'atomic-temp'),
  rmSync:
    vi.fn<
      (path: string, options?: { readonly force?: boolean; readonly recursive?: boolean }) => void
    >(),
}));

vi.mock('node:child_process', () => ({ execFileSync: mocks.execFileSync }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();

  return { ...actual, randomUUID: mocks.randomUUID };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  mocks.rmSync.mockImplementation((path, options) => {
    if (options) actual.rmSync(path, options);
    else actual.rmSync(path);
  });

  return { ...actual, copyFileSync: mocks.copyFileSync, rmSync: mocks.rmSync };
});
vi.mock('undici', () => ({
  EnvHttpProxyAgent: function EnvHttpProxyAgent() {
    return mocks.dispatcher;
  },
  fetch: mocks.fetch,
}));
vi.mock('@actions/core', () => ({ info: vi.fn() }));

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'setup-download-'));
  temporaryDirectories.push(directory);

  return directory;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function responseBody(response: Response): ReadableStream<Uint8Array> {
  if (!response.body) throw new Error('Expected response body');

  return response.body;
}

async function loadDownload(): Promise<typeof import('../../src/setup/download.js')> {
  return import('../../src/setup/download.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.extractedSources.length = 0;
  mocks.copyFileSync.mockImplementation((source, destination) => {
    writeFileSync(destination, readFileSync(source));
  });
  mocks.execFileSync.mockImplementation((executable: string, args: readonly string[]) => {
    const destination = args.at(-1);
    if (!destination) throw new Error(`Missing ${executable} extraction destination`);

    for (const source of mocks.extractedSources) {
      const extracted = join(destination, source);
      mkdirSync(dirname(extracted), { recursive: true });
      writeFileSync(extracted, source);
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('fetchText', () => {
  it.each([
    ['succeeds', false],
    ['fails', true],
  ])(
    'cancels the body and preserves a permanent HTTP error when cancellation %s',
    async (_, fails) => {
      const response = new Response('failure', { status: 404, statusText: 'Not Found' });
      const cancel = vi.spyOn(responseBody(response), 'cancel');
      if (fails) cancel.mockRejectedValue(new Error('cancel failed'));
      mocks.fetch.mockResolvedValue(response);
      const { fetchText } = await loadDownload();

      await expect(fetchText('https://example.test/checksum')).rejects.toThrow(
        'HTTP 404: Not Found',
      );
      expect(cancel).toHaveBeenCalledOnce();
      expect(mocks.fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['an HTTP 503', () => mocks.fetch.mockResolvedValueOnce(new Response('', { status: 503 }))],
    [
      'a network TypeError',
      () => mocks.fetch.mockRejectedValueOnce(new TypeError('network unavailable')),
    ],
  ])('retries %s and passes the proxy dispatcher', async (_, arrangeFailure) => {
    vi.useFakeTimers();
    arrangeFailure();
    mocks.fetch.mockResolvedValueOnce(new Response('checksum', { status: 200 }));
    const { fetchText } = await loadDownload();
    const result = fetchText('https://example.test/checksum');

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('checksum');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenLastCalledWith('https://example.test/checksum', {
      dispatcher: mocks.dispatcher,
    });
  });
});

describe('installArchive', () => {
  it('does not create a staging directory for a malformed archive URL', async () => {
    const root = temporaryDirectory();
    const { installArchive } = await loadDownload();

    await expect(
      installArchive(root, {
        url: 'not a valid URL',
        sha256: '0'.repeat(64),
        executables: [],
      }),
    ).rejects.toThrow();
    expect(readdirSync(root).filter((entry) => entry.startsWith('staging-'))).toEqual([]);
  });

  it('installs a tiny tar.gz archive atomically', async () => {
    const root = temporaryDirectory();
    const source = join('nested', 'tar-tool');
    const destination = join(root, 'bin', 'tar-tool');
    const content = 'tar.gz archive';
    mocks.extractedSources.push(source);
    mocks.fetch.mockResolvedValue(new Response(content, { status: 200 }));
    const { installArchive } = await loadDownload();

    await installArchive(root, {
      url: 'https://example.test/archive.tar.gz',
      sha256: sha256(content),
      executables: [{ source, destination }],
    });

    expect(readFileSync(destination, 'utf8')).toBe(source);
    expect(statSync(destination).mode & 0o777).toBe(0o755);
    expect(existsSync(`${destination}.atomic-temp`)).toBe(false);
    expect(readdirSync(root).filter((entry) => entry.startsWith('staging-'))).toEqual([]);
    expect(execFileSync).toHaveBeenCalledWith('tar', expect.arrayContaining(['xzf']), {
      stdio: 'pipe',
    });
  });

  it('deletes a mismatched download and throws the expected digest error', async () => {
    const root = temporaryDirectory();
    mocks.fetch.mockResolvedValue(new Response('wrong archive', { status: 200 }));
    const { installArchive } = await loadDownload();

    await expect(
      installArchive(root, {
        url: 'https://example.test/archive.tar.gz',
        sha256: '0'.repeat(64),
        executables: [],
      }),
    ).rejects.toThrow('SHA256 mismatch for archive.tar.gz');
    expect(mocks.rmSync).toHaveBeenNthCalledWith(2, expect.stringMatching(/archive\.tar\.gz$/), {
      force: true,
    });
  });

  it('does not mask an archive HTTP 404 when body cancellation fails', async () => {
    const root = temporaryDirectory();
    const response = new Response('failure', { status: 404, statusText: 'Not Found' });
    const cancel = vi
      .spyOn(responseBody(response), 'cancel')
      .mockRejectedValue(new Error('cancel failed'));
    mocks.fetch.mockResolvedValue(response);
    const { installArchive } = await loadDownload();

    await expect(
      installArchive(root, {
        url: 'https://example.test/archive.tar.gz',
        sha256: '0'.repeat(64),
        executables: [],
      }),
    ).rejects.toThrow('HTTP 404: Not Found');
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith('https://example.test/archive.tar.gz', {
      dispatcher: mocks.dispatcher,
    });
  });

  it.each([
    ['HTTP 503', () => mocks.fetch.mockResolvedValueOnce(new Response('', { status: 503 }))],
    [
      'network TypeError',
      () => mocks.fetch.mockRejectedValueOnce(new TypeError('network unavailable')),
    ],
  ])(
    'retries an archive %s and passes the dispatcher to every fetch',
    async (_, arrangeFailure) => {
      vi.useFakeTimers();
      const root = temporaryDirectory();
      const content = 'archive';
      arrangeFailure();
      mocks.fetch.mockResolvedValueOnce(new Response(content, { status: 200 }));
      const { installArchive } = await loadDownload();
      const installation = installArchive(root, {
        url: 'https://example.test/archive.tar.gz',
        sha256: sha256(content),
        executables: [],
      });

      await vi.runAllTimersAsync();
      await expect(installation).resolves.toBeUndefined();
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      for (const call of mocks.fetch.mock.calls) {
        expect(call).toEqual([
          'https://example.test/archive.tar.gz',
          { dispatcher: mocks.dispatcher },
        ]);
      }
    },
  );

  it('reports an empty archive response body after exhausting retries', async () => {
    vi.useFakeTimers();
    const root = temporaryDirectory();
    const url = 'https://example.test/archive.tar.gz';
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    const { installArchive } = await loadDownload();
    const installation = installArchive(root, {
      url,
      sha256: '0'.repeat(64),
      executables: [],
    });
    const rejection = expect(installation).rejects.toThrow(`Empty response body for ${url}`);

    await vi.runAllTimersAsync();
    await rejection;
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('propagates non-ENOENT extraction failures', async () => {
    const root = temporaryDirectory();
    const extractionError = Object.assign(new Error('spawn tar EACCES'), { code: 'EACCES' });
    mocks.fetch.mockResolvedValue(new Response('archive', { status: 200 }));
    mocks.execFileSync.mockImplementation(() => {
      throw extractionError;
    });
    const { installArchive } = await loadDownload();

    await expect(
      installArchive(root, {
        url: 'https://example.test/archive.tar.gz',
        sha256: sha256('archive'),
        executables: [],
      }),
    ).rejects.toBe(extractionError);
  });

  it('installs executables in caller-provided order', async () => {
    const root = temporaryDirectory();
    const sources = ['companion-one', 'companion-two', 'primary'];
    mocks.extractedSources.push(...sources);
    mocks.fetch.mockResolvedValue(new Response('archive', { status: 200 }));
    const { installArchive } = await loadDownload();

    await installArchive(root, {
      url: 'https://example.test/archive.tar.gz',
      sha256: sha256('archive'),
      executables: sources.map((source) => ({ source, destination: join(root, 'bin', source) })),
    });

    expect(mocks.copyFileSync.mock.calls.map(([source]) => basename(source))).toEqual(sources);
  });

  it('removes the temporary executable and staging directory when copying fails', async () => {
    const root = temporaryDirectory();
    const destination = join(root, 'bin', 'tool');
    mocks.extractedSources.push('tool');
    mocks.fetch.mockResolvedValue(new Response('archive', { status: 200 }));
    mocks.copyFileSync.mockImplementation((_source, temporary) => {
      writeFileSync(temporary, 'partial');
      throw new Error('copy failed');
    });
    const { installArchive } = await loadDownload();

    await expect(
      installArchive(root, {
        url: 'https://example.test/archive.tar.gz',
        sha256: sha256('archive'),
        executables: [{ source: 'tool', destination }],
      }),
    ).rejects.toThrow('copy failed');
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(`${destination}.atomic-temp`)).toBe(false);
    expect(readdirSync(root).filter((entry) => entry.startsWith('staging-'))).toEqual([]);
  });

  it('turns a missing tar executable into a PATH error', async () => {
    const root = temporaryDirectory();
    const spawnError = Object.assign(new Error('spawn tar ENOENT'), { code: 'ENOENT' });
    mocks.fetch.mockResolvedValue(new Response('archive', { status: 200 }));
    mocks.execFileSync.mockImplementation(() => {
      throw spawnError;
    });
    const { installArchive } = await loadDownload();

    await expect(
      installArchive(root, {
        url: 'https://example.test/archive.tar.gz',
        sha256: sha256('archive'),
        executables: [],
      }),
    ).rejects.toMatchObject({
      message: 'Required executable "tar" was not found on PATH',
      cause: spawnError,
    });
  });
});

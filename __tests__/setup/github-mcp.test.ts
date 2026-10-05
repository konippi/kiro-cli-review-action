import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveInstall } from '../../src/setup/download.js';

const mocks = vi.hoisted(() => ({
  fetchText: vi.fn(),
  installArchive: vi.fn<(installRoot: string, archive: ArchiveInstall) => Promise<void>>(),
}));

vi.mock('../../src/setup/download.js', () => ({
  fetchText: mocks.fetchText,
  installArchive: mocks.installArchive,
}));
vi.mock('@actions/core', () => ({ info: vi.fn() }));

const temporaryDirectories: string[] = [];
const MCP_VERSION = '0.32.0';
const OTHER_MCP_VERSION = '0.33.0';
const MCP_SHA256 = 'c90fcbd681b716fdb845cc6e19f88fac1c26fec0b8084b11ef39fc410a17e304';

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'setup-mcp-'));
  temporaryDirectories.push(directory);

  return directory;
}

function useRunner(platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
  vi.spyOn(process, 'arch', 'get').mockReturnValue(arch);
}

async function loadGithubMcp(): Promise<typeof import('../../src/setup/github-mcp.js')> {
  return import('../../src/setup/github-mcp.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  useRunner('linux', 'x64');
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('installGithubMcpServer', () => {
  it.each<{ readonly platform: NodeJS.Platform; readonly arch: NodeJS.Architecture }>([
    { platform: 'darwin', arch: 'x64' },
    { platform: 'linux', arch: 'ia32' },
  ])(
    'rejects unsupported runner $platform/$arch before filesystem or network work',
    async ({ platform, arch }) => {
      useRunner(platform, arch);
      const root = temporaryDirectory();
      const { installGithubMcpServer } = await loadGithubMcp();

      await expect(installGithubMcpServer(MCP_VERSION, root)).rejects.toThrow(
        `unsupported runner: ${platform}/${arch}; Linux x64 and arm64 are supported`,
      );
      expect(mocks.fetchText).not.toHaveBeenCalled();
      expect(mocks.installArchive).not.toHaveBeenCalled();
    },
  );

  it('reuses an architecture-stamped installation', async () => {
    const root = temporaryDirectory();
    const binary = join(root, 'github-mcp-server', MCP_VERSION, 'x64', 'github-mcp-server');
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, 'mcp');
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer(MCP_VERSION, root)).resolves.toBe(binary);
    expect(mocks.fetchText).not.toHaveBeenCalled();
    expect(mocks.installArchive).not.toHaveBeenCalled();
  });

  it('installs the default tarball with its embedded checksum and no fetch', async () => {
    const root = temporaryDirectory();
    const binary = join(root, 'github-mcp-server', MCP_VERSION, 'x64', 'github-mcp-server');
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer(MCP_VERSION, root)).resolves.toBe(binary);
    expect(mocks.fetchText).not.toHaveBeenCalled();
    expect(mocks.installArchive).toHaveBeenCalledWith(root, {
      url:
        `https://github.com/github/github-mcp-server/releases/download/v${MCP_VERSION}/` +
        'github-mcp-server_Linux_x86_64.tar.gz',
      sha256: MCP_SHA256,
      executables: [{ source: 'github-mcp-server', destination: binary }],
    });
  });

  it('fetches and parses checksums.txt for a custom version', async () => {
    const root = temporaryDirectory();
    const asset = 'github-mcp-server_Linux_x86_64.tar.gz';
    const digest = 'b'.repeat(64);
    mocks.fetchText.mockResolvedValue(`${'a'.repeat(64)}  another.tar.gz\n${digest}  ${asset}\n`);
    const { installGithubMcpServer } = await loadGithubMcp();

    await installGithubMcpServer(OTHER_MCP_VERSION, root);

    expect(mocks.fetchText).toHaveBeenCalledWith(
      `https://github.com/github/github-mcp-server/releases/download/v${OTHER_MCP_VERSION}/github-mcp-server_${OTHER_MCP_VERSION}_checksums.txt`,
    );
    expect(mocks.installArchive).toHaveBeenCalledWith(
      root,
      expect.objectContaining({ sha256: digest }),
    );
  });

  it('preserves the checksum-fetch failure message and cause', async () => {
    const root = temporaryDirectory();
    const fetchError = new Error('HTTP 404: Not Found');
    mocks.fetchText.mockRejectedValue(fetchError);
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer(OTHER_MCP_VERSION, root)).rejects.toMatchObject({
      message:
        `Failed to fetch github-mcp-server_${OTHER_MCP_VERSION}_checksums.txt for ` +
        `github-mcp-server ${OTHER_MCP_VERSION}`,
      cause: fetchError,
    });
    expect(mocks.installArchive).not.toHaveBeenCalled();
  });

  it('rejects a custom release whose checksum file omits the asset', async () => {
    const root = temporaryDirectory();
    mocks.fetchText.mockResolvedValue(`${'a'.repeat(64)}  another.tar.gz\n`);
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer(OTHER_MCP_VERSION, root)).rejects.toThrow(
      'No checksum for github-mcp-server_Linux_x86_64.tar.gz in ' +
        `github-mcp-server_${OTHER_MCP_VERSION}_checksums.txt`,
    );
    expect(mocks.installArchive).not.toHaveBeenCalled();
  });
});

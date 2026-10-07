import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolInstallSpec } from '../../src/setup/download.js';

const mocks = vi.hoisted(() => ({
  fetchText: vi.fn(),
  installTool: vi.fn<(spec: ToolInstallSpec) => Promise<string>>(),
}));

vi.mock('../../src/setup/download.js', () => ({
  fetchText: mocks.fetchText,
  installTool: mocks.installTool,
}));

const temporaryDirectories: string[] = [];
const MCP_VERSION = '0.32.0';
const MINIMUM_MCP_VERSION = '0.23.0';
const MCP_SHA256 = 'c90fcbd681b716fdb845cc6e19f88fac1c26fec0b8084b11ef39fc410a17e304';
let resolvedSha256: string | undefined;

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'setup-github-mcp-'));
  temporaryDirectories.push(directory);

  return directory;
}

function useRunner(platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
  vi.spyOn(process, 'arch', 'get').mockReturnValue(arch);
}

function installedSpec(): ToolInstallSpec {
  const call = mocks.installTool.mock.calls[0];
  if (!call) throw new Error('Expected installTool to be called');

  return call[0];
}

async function loadGithubMcp(): Promise<typeof import('../../src/setup/github-mcp.js')> {
  return import('../../src/setup/github-mcp.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resolvedSha256 = undefined;
  useRunner('linux', 'x64');
  mocks.installTool.mockImplementation(async (spec) => {
    resolvedSha256 = await spec.resolveSha256();

    return '/tool-cache/github-mcp-server';
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('installGithubMcpServer', () => {
  it('rejects a version just below the minimum before installer work', async () => {
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer('0.22.0')).rejects.toThrow(
      'Input github_mcp_version is not supported: requested 0.22.0; supported versions are >=0.23.0',
    );
    expect(mocks.installTool).not.toHaveBeenCalled();
  });

  it.each<{ readonly platform: NodeJS.Platform; readonly arch: NodeJS.Architecture }>([
    { platform: 'darwin', arch: 'x64' },
    { platform: 'linux', arch: 'ia32' },
  ])('rejects unsupported runner $platform/$arch', async ({ platform, arch }) => {
    useRunner(platform, arch);
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer(MCP_VERSION)).rejects.toThrow(
      `unsupported runner: ${platform}/${arch}; Linux x64 and arm64 are supported`,
    );
    expect(mocks.fetchText).not.toHaveBeenCalled();
    expect(mocks.installTool).not.toHaveBeenCalled();
  });

  it('installs the default root-layout tarball and returns the cached binary', async () => {
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer(MCP_VERSION)).resolves.toBe(
      '/tool-cache/github-mcp-server/github-mcp-server',
    );
    expect(mocks.fetchText).not.toHaveBeenCalled();
    expect(mocks.installTool).toHaveBeenCalledWith({
      tool: 'github-mcp-server',
      version: MCP_VERSION,
      archKey: 'x64',
      asset: 'github-mcp-server_Linux_x86_64.tar.gz',
      url:
        `https://github.com/github/github-mcp-server/releases/download/v${MCP_VERSION}/` +
        'github-mcp-server_Linux_x86_64.tar.gz',
      resolveSha256: expect.any(Function),
      verify: expect.any(Function),
    });
    expect(resolvedSha256).toBe(MCP_SHA256);
  });

  it('uses the arm64 architecture key and asset', async () => {
    useRunner('linux', 'arm64');
    const { installGithubMcpServer } = await loadGithubMcp();

    await installGithubMcpServer(MCP_VERSION);

    expect(installedSpec().archKey).toBe('arm64');
    expect(installedSpec().asset).toBe('github-mcp-server_Linux_arm64.tar.gz');
    expect(installedSpec().url).toContain('github-mcp-server_Linux_arm64.tar.gz');
  });

  it('fetches and parses checksums.txt once for a custom version', async () => {
    const asset = 'github-mcp-server_Linux_x86_64.tar.gz';
    const digest = 'b'.repeat(64);
    mocks.fetchText.mockResolvedValue(
      `${'a'.repeat(64)}  another.tar.gz\r\n${digest}  ${asset}\r\n`,
    );
    const { installGithubMcpServer } = await loadGithubMcp();

    await installGithubMcpServer(MINIMUM_MCP_VERSION);

    expect(mocks.fetchText).toHaveBeenCalledWith(
      `https://github.com/github/github-mcp-server/releases/download/v${MINIMUM_MCP_VERSION}/github-mcp-server_${MINIMUM_MCP_VERSION}_checksums.txt`,
    );
    expect(mocks.fetchText).toHaveBeenCalledOnce();
    expect(resolvedSha256).toBe(digest);
  });

  it('preserves the checksums 404 message and cause', async () => {
    const fetchError = new Error('HTTP 404: Not Found');
    mocks.fetchText.mockRejectedValue(fetchError);
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer(MINIMUM_MCP_VERSION)).rejects.toMatchObject({
      message:
        `Failed to fetch github-mcp-server_${MINIMUM_MCP_VERSION}_checksums.txt for ` +
        `github-mcp-server ${MINIMUM_MCP_VERSION}`,
      cause: fetchError,
    });
    expect(mocks.installTool).toHaveBeenCalledOnce();
    expect(mocks.fetchText).toHaveBeenCalledOnce();
  });

  it('rejects malformed checksum content that omits the asset digest', async () => {
    mocks.fetchText.mockResolvedValue(
      `not-a-digest  github-mcp-server_Linux_x86_64.tar.gz\n${'a'.repeat(64)}  another.tar.gz\n`,
    );
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer(MINIMUM_MCP_VERSION)).rejects.toThrow(
      'No checksum for github-mcp-server_Linux_x86_64.tar.gz in ' +
        `github-mcp-server_${MINIMUM_MCP_VERSION}_checksums.txt`,
    );
    expect(mocks.installTool).toHaveBeenCalledOnce();
    expect(mocks.fetchText).toHaveBeenCalledOnce();
  });

  it('rejects a non-executable binary before caching a fresh extraction', async () => {
    const extractionDirectory = temporaryDirectory();
    const binary = join(extractionDirectory, 'github-mcp-server');
    writeFileSync(binary, 'github-mcp-server');
    chmodSync(binary, 0o644);
    const cacheDir = vi.fn(() => '/tool-cache/unreachable');
    mocks.installTool.mockImplementation(async (spec) => {
      spec.verify(extractionDirectory);

      return cacheDir();
    });
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer(MCP_VERSION)).rejects.toMatchObject({
      message: `github-mcp-server verification failed: ${binary} is not executable`,
      cause: expect.any(Error),
    });
    expect(cacheDir).not.toHaveBeenCalled();
  });

  it('accepts an executable binary in a fresh extraction', async () => {
    const extractionDirectory = temporaryDirectory();
    const binary = join(extractionDirectory, 'github-mcp-server');
    writeFileSync(binary, 'github-mcp-server');
    chmodSync(binary, 0o755);
    mocks.installTool.mockImplementation(async (spec) => {
      spec.verify(extractionDirectory);

      return extractionDirectory;
    });
    const { installGithubMcpServer } = await loadGithubMcp();

    await expect(installGithubMcpServer(MCP_VERSION)).resolves.toBe(binary);
  });
});

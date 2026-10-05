import { accessSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';
import { fetchText, installTool } from './download.js';

/** Default GitHub MCP server release installed by this action. */
export const DEFAULT_GITHUB_MCP_VERSION = '0.32.0';

type SupportedGithubMcpArchitecture = 'x64' | 'arm64';

const MCP_ASSET_SUFFIX_BY_ARCH = {
  x64: 'Linux_x86_64',
  arm64: 'Linux_arm64',
} as const satisfies Readonly<Record<SupportedGithubMcpArchitecture, `Linux_${string}`>>;

type GithubMcpAsset =
  `github-mcp-server_${(typeof MCP_ASSET_SUFFIX_BY_ARCH)[SupportedGithubMcpArchitecture]}.tar.gz`;

const DEFAULT_GITHUB_MCP_SHA256: Readonly<Record<GithubMcpAsset, string>> = {
  'github-mcp-server_Linux_x86_64.tar.gz':
    'c90fcbd681b716fdb845cc6e19f88fac1c26fec0b8084b11ef39fc410a17e304',
  'github-mcp-server_Linux_arm64.tar.gz':
    'def367faff0bd5b971765f407df24f8679938e8fbcb467896c8ab8a39ad92ba4',
};

const CHECKSUM_LINE = /^(?<digest>[0-9a-f]{64})\s+(?<name>\S+)$/;

function assertExecutable(path: string): void {
  try {
    if (!statSync(path).isFile()) throw new Error(`${path} is not a file`);
    accessSync(path, constants.X_OK);
  } catch (error: unknown) {
    throw new Error(`github-mcp-server verification failed: ${path} is not executable`, {
      cause: error,
    });
  }
}

async function fetchGithubMcpAssetSha256(
  version: string,
  releaseUrl: string,
  checksumsFile: string,
  asset: GithubMcpAsset,
): Promise<string> {
  const checksums = await fetchText(`${releaseUrl}${checksumsFile}`).catch((error: unknown) => {
    throw new Error(`Failed to fetch ${checksumsFile} for github-mcp-server ${version}`, {
      cause: error,
    });
  });

  for (const line of checksums.split(/\r?\n/)) {
    const groups = CHECKSUM_LINE.exec(line)?.groups;
    if (groups?.name === asset && groups.digest !== undefined) return groups.digest;
  }

  throw new Error(`No checksum for ${asset} in ${checksumsFile}`);
}

/** Downloads and installs the configured GitHub MCP server release. */
export async function installGithubMcpServer(version: string): Promise<string> {
  const platform = process.platform;
  const arch = process.arch;
  if (platform !== 'linux' || (arch !== 'x64' && arch !== 'arm64')) {
    throw new Error(`unsupported runner: ${platform}/${arch}; Linux x64 and arm64 are supported`);
  }

  const asset: GithubMcpAsset = `github-mcp-server_${MCP_ASSET_SUFFIX_BY_ARCH[arch]}.tar.gz`;
  const checksumsFile = `github-mcp-server_${version}_checksums.txt`;
  const releaseUrl = `https://github.com/github/github-mcp-server/releases/download/v${version}/`;
  const url = `${releaseUrl}${asset}`;
  const cacheDirectory = await installTool({
    tool: 'github-mcp-server',
    version,
    archKey: arch,
    asset,
    url,
    resolveSha256: async () =>
      version === DEFAULT_GITHUB_MCP_VERSION
        ? DEFAULT_GITHUB_MCP_SHA256[asset]
        : fetchGithubMcpAssetSha256(version, releaseUrl, checksumsFile, asset),
    verify: (directory) => assertExecutable(join(directory, 'github-mcp-server')),
  });

  return join(cacheDirectory, 'github-mcp-server');
}

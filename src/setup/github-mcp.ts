import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';
import { fetchText, installArchive } from './download.js';

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
export async function installGithubMcpServer(
  version: string,
  installRoot: string,
): Promise<string> {
  const platform = process.platform;
  const arch = process.arch;
  if (platform !== 'linux' || (arch !== 'x64' && arch !== 'arm64')) {
    throw new Error(`unsupported runner: ${platform}/${arch}; Linux x64 and arm64 are supported`);
  }

  const binaryDirectory = join(installRoot, 'github-mcp-server', version, arch);
  const binary = join(binaryDirectory, 'github-mcp-server');
  if (existsSync(binary)) {
    core.info(`Reusing github-mcp-server ${version}`);
    return binary;
  }

  const asset: GithubMcpAsset = `github-mcp-server_${MCP_ASSET_SUFFIX_BY_ARCH[arch]}.tar.gz`;
  const checksumsFile = `github-mcp-server_${version}_checksums.txt`;
  const releaseUrl = `https://github.com/github/github-mcp-server/releases/download/v${version}/`;
  const sha256 =
    version === DEFAULT_GITHUB_MCP_VERSION
      ? DEFAULT_GITHUB_MCP_SHA256[asset]
      : await fetchGithubMcpAssetSha256(version, releaseUrl, checksumsFile, asset);

  const url = `${releaseUrl}${asset}`;
  core.info(`Installing github-mcp-server ${version} from ${url}`);

  await installArchive(installRoot, {
    url,
    sha256,
    executables: [{ source: 'github-mcp-server', destination: binary }],
  });
  core.info(`github-mcp-server ${version} installed and verified`);

  return binary;
}

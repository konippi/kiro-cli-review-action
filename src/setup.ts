import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3_000;

async function downloadWithRetry(url: string): Promise<Buffer> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error;
      core.warning(`Download attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw new Error('Unreachable');
}

async function downloadAndExtract(
  url: string,
  installDir: string,
  binaryName: string,
): Promise<string> {
  const binaryPath = join(installDir, binaryName);
  if (existsSync(binaryPath)) {
    core.info(`${binaryName} already installed`);
    return binaryPath;
  }

  mkdirSync(installDir, { recursive: true });
  core.info(`Downloading ${binaryName}...`);

  const tarball = await downloadWithRetry(url);
  const tarPath = join(installDir, `${binaryName}.tar.gz`);
  writeFileSync(tarPath, tarball);
  execFileSync('tar', ['xzf', tarPath, '-C', installDir], { stdio: 'pipe' });

  if (!existsSync(binaryPath)) {
    throw new Error(`${binaryName} binary not found after extraction`);
  }
  chmodSync(binaryPath, 0o755);
  core.info(`${binaryName} installed`);
  return binaryPath;
}

export async function installGithubMcpServer(version: string, installDir: string): Promise<string> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid github_mcp_version: ${version}`);
  }
  const url = `https://github.com/github/github-mcp-server/releases/download/v${version}/github-mcp-server_Linux_x86_64.tar.gz`;
  return downloadAndExtract(url, installDir, 'github-mcp-server');
}

/**
 * Install kiro-cli using the official install script.
 * The script verifies SHA256 checksums via manifest.json internally.
 */
export async function installKiroCli(): Promise<string> {
  const expectedBinary = join(process.env.HOME || '/root', '.local', 'bin', 'kiro-cli');
  if (existsSync(expectedBinary)) {
    core.info('kiro-cli already installed');
    return expectedBinary;
  }

  core.info('Installing kiro-cli via official install script...');
  execFileSync('bash', ['-c', 'curl -fsSL https://cli.kiro.dev/install | bash -s -- --force'], {
    stdio: 'inherit',
    env: { ...process.env },
  });

  if (!existsSync(expectedBinary)) {
    throw new Error('kiro-cli binary not found after installation');
  }

  core.info('kiro-cli installed');
  return expectedBinary;
}

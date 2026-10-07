import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const repository = process.cwd();
const bundle = join(repository, 'dist', 'main', 'index.cjs');
const fixture = join(repository, '__tests__', 'fixtures', 'fake-kiro-cli.ts');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function execute(scenario: string): {
  status: number | null;
  output: string;
  stderr: string;
  stdout: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'kiro-bundle-'));
  temporaryDirectories.push(root);
  const home = join(root, 'home');
  const runnerTemp = join(root, 'runner');
  const toolCache = join(root, 'tool-cache');
  const kiroDirectories = ['gnu', 'musl'].map((variant) =>
    join(toolCache, 'kiro-cli', '2.27.1', `${process.arch}-${variant}`),
  );
  const mcpDirectory = join(toolCache, 'github-mcp-server', '0.32.0', process.arch);
  const mcp = join(mcpDirectory, 'github-mcp-server');
  const githubOutput = join(root, 'github-output');
  const githubState = join(root, 'github-state');
  const launcherScript =
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "kiro-cli 2.27.1"; exit 0; fi\nexec kiro-cli-chat "$@"\n';
  const chatScript = `#!/bin/sh\nexport FAKE_KIRO_CLI_SCENARIO=${scenario}\nexec node ${JSON.stringify(fixture)} "$@"\n`;

  mkdirSync(home, { recursive: true });
  mkdirSync(runnerTemp, { recursive: true });
  for (const directory of kiroDirectories) {
    const launcher = join(directory, 'kiro-cli');
    const chat = join(directory, 'kiro-cli-chat');
    mkdirSync(directory, { recursive: true });
    writeFileSync(launcher, launcherScript);
    writeFileSync(chat, chatScript);
    writeFileSync(`${directory}.complete`, '');
    chmodSync(launcher, 0o755);
    chmodSync(chat, 0o755);
  }
  mkdirSync(mcpDirectory, { recursive: true });
  writeFileSync(mcp, '#!/bin/sh\nexit 0\n');
  writeFileSync(`${mcpDirectory}.complete`, '');
  writeFileSync(githubOutput, '');
  writeFileSync(githubState, '');
  chmodSync(mcp, 0o755);

  const platformShim =
    "Object.defineProperty(process, 'platform', { value: 'linux' }); require(process.argv[1]);";
  const result = spawnSync(process.execPath, ['-e', platformShim, bundle], {
    cwd: repository,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      RUNNER_TEMP: realpathSync(runnerTemp),
      RUNNER_TOOL_CACHE: realpathSync(toolCache),
      GITHUB_ACTION_PATH: repository,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_STATE: githubState,
      INPUT_KIRO_API_KEY: 'x',
      INPUT_GITHUB_TOKEN: 't',
      INPUT_PROMPT: 'hello',
      INPUT_DEBUG: 'false',
      INPUT_TIMEOUT_MINUTES: '1',
      INPUT_GITHUB_MCP_VERSION: '0.32.0',
    },
  });

  const agentConfig = join(
    runnerTemp,
    'kiro-review',
    'kiro-home',
    'agents',
    'kiro-review-action.json',
  );

  return {
    status: result.status,
    output: readFileSync(githubOutput, 'utf8'),
    stderr: result.stderr,
    stdout: `${result.stdout}\n${existsSync(agentConfig) ? readFileSync(agentConfig, 'utf8') : ''}`,
  };
}

describe('built action bundle', () => {
  beforeAll(() => {
    if (!existsSync(bundle)) throw new Error(`Built action bundle is missing: ${bundle}`);
  });

  it('writes successful outputs', () => {
    const result = execute('success');

    if (result.status !== 0) {
      throw new Error(`${result.stderr}\n${result.stdout}\n${result.output}`);
    }
    expect(result.output).toMatch(/conclusion<<[^\n]+\nsuccess\n/);
  });

  it('maps MCP startup exit 3 to a failed action conclusion', () => {
    const result = execute('mcp');

    expect(result.status).toBe(1);
    expect(result.output).toMatch(/conclusion<<[^\n]+\nmcp_startup_failure\n/);
  });
});

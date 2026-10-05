import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: string[] = [];

  return {
    calls,
    setFailed: vi.fn(),
    setOutput: vi.fn(),
    parseInputs: vi.fn(),
    parseEventContext: vi.fn(),
    parseCommentContext: vi.fn(),
    resolveReviewMode: vi.fn(),
    checkoutPullRequestHead: vi.fn(),
    buildGitAuthEnv: vi.fn(),
    restoreConfigFromBase: vi.fn(),
    prepareAgentConfig: vi.fn(() => 'code-reviewer'),
    installKiroCli: vi.fn(async () => '/kiro'),
    installGithubMcpServer: vi.fn(async () => '/mcp'),
    acpConstructor: vi.fn(),
    prompt: vi.fn(async (_sessionId: string, _promptText: string) => ({ toolCalls: [] })),
  };
});

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => 'Review prompt'),
}));

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setSecret: vi.fn(),
  saveState: vi.fn(),
  setFailed: mocks.setFailed,
  setOutput: mocks.setOutput,
}));

vi.mock('../src/inputs.js', () => ({
  parseInputs: mocks.parseInputs,
}));

vi.mock('../src/context.js', () => ({
  parseEventContext: mocks.parseEventContext,
  parseCommentContext: mocks.parseCommentContext,
}));

vi.mock('../src/review-mode.js', () => ({
  resolveReviewMode: mocks.resolveReviewMode,
}));

vi.mock('../src/git.js', () => ({
  buildGitAuthEnv: mocks.buildGitAuthEnv,
  checkoutPullRequestHead: mocks.checkoutPullRequestHead,
}));

vi.mock('../src/restore-config.js', () => ({
  restoreConfigFromBase: mocks.restoreConfigFromBase,
}));

vi.mock('../src/agent-config.js', () => ({
  prepareAgentConfig: mocks.prepareAgentConfig,
}));

vi.mock('../src/setup/kiro-cli.js', () => ({
  installKiroCli: mocks.installKiroCli,
}));

vi.mock('../src/setup/github-mcp.js', () => ({
  installGithubMcpServer: mocks.installGithubMcpServer,
}));

vi.mock('../src/acp-client.js', () => ({
  AcpClient: class {
    process = { pid: 123 };
    constructor(binary: string) {
      mocks.acpConstructor(binary);
    }
    async start(): Promise<void> {}
    async initialize(): Promise<void> {}
    async createSession(): Promise<string> {
      return 'session';
    }
    async prompt(sessionId: string, promptText: string): Promise<{ toolCalls: string[] }> {
      return mocks.prompt(sessionId, promptText);
    }
    kill(): void {}
  },
}));

const target = {
  owner: 'owner',
  repo: 'repo',
  prNumber: 7,
  baseBranch: 'main',
  headSha: '0123456789abcdef0123456789abcdef01234567',
  isFork: false,
};

const comment = {
  owner: 'owner',
  repo: 'repo',
  prNumber: 7,
  commentId: 1234,
  commenterLogin: 'trusted-user',
  userRequest: 'focus on authentication',
};

const baseInputs = {
  kiroApiKey: 'kiro-key',
  githubToken: 'github-token',
  agent: '',
  model: '',
  prompt: '',
  triggerPhrase: '@kiro',
  maxDiffSize: 10000,
  debug: false,
  githubMcpVersion: '0.32.0',
  kiroCliVersion: '2.27.1',
};

async function importMain(): Promise<void> {
  const { run } = await import('../src/main.js');
  await run();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.parseInputs.mockReturnValue(baseInputs);
  mocks.parseEventContext.mockReturnValue(target);
  mocks.parseCommentContext.mockReturnValue(null);
  mocks.resolveReviewMode.mockResolvedValue({ kind: 'pull_request', target });
  // Extra microtask ticks make a missing await in main.ts surface as an ordering failure.
  mocks.checkoutPullRequestHead.mockImplementation(async () => {
    await Promise.resolve();
    await Promise.resolve();
    mocks.calls.push('checkout');
  });
  mocks.buildGitAuthEnv.mockReturnValue({ GIT_CONFIG_COUNT: 'sentinel-auth-env' });
  mocks.restoreConfigFromBase.mockImplementation(async () => {
    await Promise.resolve();
    mocks.calls.push('restore');
  });
});

describe('review mode preparation', () => {
  it('installs configured versions and passes the Kiro binary to ACP', async () => {
    await importMain();

    expect(mocks.installKiroCli).toHaveBeenCalledWith('2.27.1');
    expect(mocks.installGithubMcpServer).toHaveBeenCalledWith('0.32.0');
    expect(mocks.acpConstructor).toHaveBeenCalledWith('/kiro');
  });

  it('checks out a PR head, then restores base config with auth', async () => {
    await importMain();

    expect(mocks.checkoutPullRequestHead).toHaveBeenCalledWith(target.headSha, 'github-token');
    expect(mocks.buildGitAuthEnv).toHaveBeenCalledWith(process.env, 'github-token');
    expect(mocks.restoreConfigFromBase).toHaveBeenCalledWith('main', {
      GIT_CONFIG_COUNT: 'sentinel-auth-env',
    });
    expect(mocks.calls).toEqual(['checkout', 'restore']);
  });

  it('skips a fork PR before parsing required inputs', async () => {
    mocks.parseEventContext.mockReturnValue({ ...target, isFork: true });
    mocks.parseInputs.mockImplementation(() => {
      throw new Error('Input required and not supplied: kiro_api_key');
    });

    await importMain();

    expect(mocks.parseInputs).not.toHaveBeenCalled();
    expect(mocks.resolveReviewMode).not.toHaveBeenCalled();
    expect(mocks.checkoutPullRequestHead).not.toHaveBeenCalled();
    expect(mocks.setFailed).not.toHaveBeenCalled();
    expect(mocks.setOutput).toHaveBeenCalledWith('review_result', 'skip');
    expect(mocks.setOutput).toHaveBeenCalledWith('exit_code', '0');
  });

  it('prepares a comment target after resolving its review mode', async () => {
    mocks.parseEventContext.mockReturnValue(null);
    mocks.parseCommentContext.mockReturnValue(comment);
    mocks.resolveReviewMode.mockImplementation(async () => {
      mocks.calls.push('resolve');
      return { kind: 'comment', target, userRequest: comment.userRequest };
    });

    await importMain();

    expect(mocks.resolveReviewMode).toHaveBeenCalledWith(baseInputs, null, comment);
    expect(mocks.calls).toEqual(['resolve', 'checkout', 'restore']);
  });

  it('reports a resolution failure without checking out the pull request', async () => {
    mocks.resolveReviewMode.mockRejectedValue(new Error('resolution failed'));

    await importMain();

    expect(mocks.setFailed).toHaveBeenCalledWith('resolution failed');
    expect(mocks.setOutput).toHaveBeenCalledWith('review_result', 'fail');
    expect(mocks.setOutput).toHaveBeenCalledWith('exit_code', '1');
    expect(mocks.checkoutPullRequestHead).not.toHaveBeenCalled();
  });

  it('skips when no review mode matches without checking out a pull request', async () => {
    mocks.parseEventContext.mockReturnValue(null);
    mocks.resolveReviewMode.mockResolvedValue(null);

    await importMain();

    expect(mocks.checkoutPullRequestHead).not.toHaveBeenCalled();
    expect(mocks.setOutput).toHaveBeenCalledWith('review_result', 'skip');
    expect(mocks.setOutput).toHaveBeenCalledWith('exit_code', '0');
  });

  it('sends a direct prompt without checking out a pull request', async () => {
    const inputs = { ...baseInputs, prompt: 'Review this snippet' };
    mocks.parseInputs.mockReturnValue(inputs);
    mocks.resolveReviewMode.mockResolvedValue({ kind: 'prompt', prompt: inputs.prompt });

    await importMain();

    expect(mocks.checkoutPullRequestHead).not.toHaveBeenCalled();
    expect(mocks.prompt).toHaveBeenCalledWith('session', 'Review this snippet');
  });

  it('reports an unexpected non-Error thrown by review setup', async () => {
    mocks.parseEventContext.mockImplementation(() => {
      throw 'payload failed';
    });

    await importMain();

    expect(mocks.setFailed).toHaveBeenCalledWith('Unexpected error: payload failed');
    expect(mocks.setOutput).toHaveBeenCalledWith('review_result', 'fail');
    expect(mocks.setOutput).toHaveBeenCalledWith('exit_code', '1');
  });
});

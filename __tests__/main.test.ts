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
    authorizeCommentTrigger: vi.fn(),
    fetchCommentPullRequest: vi.fn(),
    checkoutPullRequestHead: vi.fn(),
    buildGitAuthEnv: vi.fn(),
    restoreConfigFromBase: vi.fn(),
  };
});

vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => 'Review prompt'),
  writeFileSync: vi.fn(),
}));

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setSecret: vi.fn(),
  saveState: vi.fn(),
  setFailed: mocks.setFailed,
  setOutput: mocks.setOutput,
}));

vi.mock('../src/context.js', () => ({
  parseInputs: mocks.parseInputs,
  parseEventContext: mocks.parseEventContext,
  parseCommentContext: mocks.parseCommentContext,
  authorizeCommentTrigger: mocks.authorizeCommentTrigger,
  fetchCommentPullRequest: mocks.fetchCommentPullRequest,
}));

vi.mock('../src/git.js', () => ({
  buildGitAuthEnv: mocks.buildGitAuthEnv,
  checkoutPullRequestHead: mocks.checkoutPullRequestHead,
}));

vi.mock('../src/restore-config.js', () => ({
  restoreConfigFromBase: mocks.restoreConfigFromBase,
}));

vi.mock('../src/setup.js', () => ({
  installKiroCli: vi.fn(async () => '/kiro'),
  installGithubMcpServer: vi.fn(async () => '/mcp'),
}));

vi.mock('../src/acp-client.js', () => ({
  AcpClient: class {
    process = { pid: 123 };
    async start(): Promise<void> {}
    async initialize(): Promise<void> {}
    async createSession(): Promise<string> {
      return 'session';
    }
    async prompt(): Promise<{ toolCalls: string[] }> {
      return { toolCalls: [] };
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
};

async function importMain(): Promise<void> {
  await (await import('../src/main.js')).default;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.parseInputs.mockReturnValue(baseInputs);
  mocks.parseEventContext.mockReturnValue(target);
  mocks.parseCommentContext.mockReturnValue(null);
  mocks.authorizeCommentTrigger.mockImplementation(async () => {
    mocks.calls.push('authorize');
  });
  mocks.fetchCommentPullRequest.mockImplementation(async () => {
    mocks.calls.push('fetch-pr');
    return target;
  });
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

describe('PR preparation order', () => {
  it('checks out the PR head, then restores base config with auth', async () => {
    await importMain();

    expect(mocks.calls).toEqual(['checkout', 'restore']);
    expect(mocks.checkoutPullRequestHead).toHaveBeenCalledWith(target.headSha, 'github-token');
    expect(mocks.buildGitAuthEnv).toHaveBeenCalledWith(process.env, 'github-token');
    expect(mocks.restoreConfigFromBase).toHaveBeenCalledWith('main', {
      GIT_CONFIG_COUNT: 'sentinel-auth-env',
    });
  });

  it('skips a fork PR before parsing required inputs', async () => {
    mocks.parseEventContext.mockReturnValue({ ...target, isFork: true });
    mocks.parseInputs.mockImplementation(() => {
      throw new Error('Input required and not supplied: kiro_api_key');
    });

    await importMain();

    expect(mocks.parseInputs).not.toHaveBeenCalled();
    expect(mocks.checkoutPullRequestHead).not.toHaveBeenCalled();
    expect(mocks.setFailed).not.toHaveBeenCalled();
    expect(mocks.setOutput).toHaveBeenCalledWith('review_result', 'skip');
    expect(mocks.setOutput).toHaveBeenCalledWith('exit_code', '0');
  });

  it('authorizes a comment before fetching and checking out, then restores base config', async () => {
    mocks.parseEventContext.mockReturnValue(null);
    mocks.parseCommentContext.mockReturnValue(comment);

    await importMain();

    expect(mocks.calls).toEqual(['authorize', 'fetch-pr', 'checkout', 'restore']);
    expect(mocks.authorizeCommentTrigger).toHaveBeenCalledWith(
      'owner',
      'repo',
      'trusted-user',
      'github-token',
    );
    expect(mocks.fetchCommentPullRequest).toHaveBeenCalledWith('owner', 'repo', 7, 'github-token');
  });

  it('fails a comment-triggered review without a GitHub token', async () => {
    mocks.parseEventContext.mockReturnValue(null);
    mocks.parseCommentContext.mockReturnValue(comment);
    mocks.parseInputs.mockReturnValue({ ...baseInputs, githubToken: '' });

    await importMain();

    expect(mocks.setFailed).toHaveBeenCalledWith(
      'github_token is required for comment-triggered reviews',
    );
    expect(mocks.setOutput).toHaveBeenCalledWith('review_result', 'fail');
    expect(mocks.setOutput).toHaveBeenCalledWith('exit_code', '1');
    expect(mocks.authorizeCommentTrigger).not.toHaveBeenCalled();
    expect(mocks.fetchCommentPullRequest).not.toHaveBeenCalled();
    expect(mocks.checkoutPullRequestHead).not.toHaveBeenCalled();
  });

  it('fails an unauthorized comment without checking out the pull request', async () => {
    mocks.parseEventContext.mockReturnValue(null);
    mocks.parseCommentContext.mockReturnValue(comment);
    mocks.authorizeCommentTrigger.mockRejectedValue(
      new Error(
        'Commenter trusted-user must have write access to owner/repo; detected permission: read',
      ),
    );

    await importMain();

    expect(mocks.setFailed).toHaveBeenCalledWith(
      'Commenter trusted-user must have write access to owner/repo; detected permission: read',
    );
    expect(mocks.setOutput).toHaveBeenCalledWith('review_result', 'fail');
    expect(mocks.setOutput).toHaveBeenCalledWith('exit_code', '1');
    expect(mocks.fetchCommentPullRequest).not.toHaveBeenCalled();
    expect(mocks.checkoutPullRequestHead).not.toHaveBeenCalled();
  });

  it('reports a checkout failure through failure outputs', async () => {
    mocks.checkoutPullRequestHead.mockRejectedValue(new Error('checkout failed'));

    await importMain();

    expect(mocks.setFailed).toHaveBeenCalledWith('checkout failed');
    expect(mocks.setOutput).toHaveBeenCalledWith('review_result', 'fail');
    expect(mocks.setOutput).toHaveBeenCalledWith('exit_code', '1');
  });
});

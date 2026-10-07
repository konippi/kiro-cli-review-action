import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ENV_KEYS, buildKiroEnv } from '../../src/kiro/env.js';

describe('buildKiroEnv', () => {
  it('copies exactly every allowlisted key plus fixed and explicit values', () => {
    const parentEnv: NodeJS.ProcessEnv = Object.fromEntries(
      ALLOWED_ENV_KEYS.map((key) => [key, `parent-${key}`]),
    );
    parentEnv.AWS_SECRET_ACCESS_KEY = 'leak';
    parentEnv.GITHUB_TOKEN = 'leak';
    parentEnv.ACTIONS_RUNTIME_TOKEN = 'leak';
    const kiroHome = '/kiro-home';

    expect(
      buildKiroEnv(parentEnv, {
        kiroApiKey: 'kiro-secret',
        githubToken: 'github-secret',
        kiroHome,
        kiroBinDir: '/kiro-bin',
      }),
    ).toEqual({
      ...Object.fromEntries(ALLOWED_ENV_KEYS.map((key) => [key, `parent-${key}`])),
      PATH: `/kiro-bin${delimiter}parent-PATH`,
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      TERM: 'dumb',
      KIRO_API_KEY: 'kiro-secret',
      GITHUB_PERSONAL_ACCESS_TOKEN: 'github-secret',
      KIRO_HOME: kiroHome,
      KIRO_AGENT_CONFIG_DIR: join(kiroHome, 'agents'),
    });
  });

  it('uses only the Kiro binary directory when parent PATH is unset', () => {
    const env = buildKiroEnv(
      {},
      {
        kiroApiKey: 'kiro-secret',
        githubToken: '',
        kiroHome: '/kiro-home',
        kiroBinDir: '/kiro-bin',
      },
    );

    expect(env.PATH).toBe('/kiro-bin');
  });

  it('omits GITHUB_PERSONAL_ACCESS_TOKEN when the GitHub token is empty', () => {
    const env = buildKiroEnv(
      {},
      {
        kiroApiKey: 'kiro-secret',
        githubToken: '',
        kiroHome: '/kiro-home',
        kiroBinDir: '/kiro-bin',
      },
    );

    expect(env).not.toHaveProperty('GITHUB_PERSONAL_ACCESS_TOKEN');
  });

  it('derives GITHUB_HOST for GitHub Enterprise', () => {
    const env = buildKiroEnv(
      { GITHUB_SERVER_URL: 'https://ghe.example.com/' },
      {
        kiroApiKey: 'kiro-secret',
        githubToken: '',
        kiroHome: '/kiro-home',
        kiroBinDir: '/kiro-bin',
      },
    );

    expect(env).toHaveProperty('GITHUB_HOST', 'https://ghe.example.com');
    expect(env).not.toHaveProperty('GITHUB_SERVER_URL');
  });

  it('does not set GITHUB_HOST for github.com', () => {
    const env = buildKiroEnv(
      { GITHUB_SERVER_URL: 'https://github.com' },
      {
        kiroApiKey: 'kiro-secret',
        githubToken: '',
        kiroHome: '/kiro-home',
        kiroBinDir: '/kiro-bin',
      },
    );

    expect(env).not.toHaveProperty('GITHUB_HOST');
  });

  it('throws when GITHUB_SERVER_URL is not a valid URL', () => {
    expect(() =>
      buildKiroEnv(
        { GITHUB_SERVER_URL: 'not a url' },
        { kiroApiKey: '', githubToken: '', kiroHome: '/kiro-home', kiroBinDir: '/kiro-bin' },
      ),
    ).toThrow(TypeError);
  });
});

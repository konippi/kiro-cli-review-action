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
    parentEnv.GITHUB_SERVER_URL = 'https://ghe.example.com';
    const kiroHome = '/kiro-home';

    expect(
      buildKiroEnv(parentEnv, {
        kiroApiKey: 'kiro-secret',
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
      KIRO_HOME: kiroHome,
      KIRO_AGENT_CONFIG_DIR: join(kiroHome, 'agents'),
    });
  });

  it('uses only the Kiro binary directory when parent PATH is unset', () => {
    const env = buildKiroEnv(
      {},
      {
        kiroApiKey: 'kiro-secret',
        kiroHome: '/kiro-home',
        kiroBinDir: '/kiro-bin',
      },
    );

    expect(env.PATH).toBe('/kiro-bin');
  });
});

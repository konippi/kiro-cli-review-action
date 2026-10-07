import type { ActionInputs } from '../../src/inputs.js';

/** Creates valid action inputs with optional test-specific overrides. */
export function createActionInputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
  return {
    kiroApiKey: 'kiro-key',
    githubToken: 'github-token',
    agent: '',
    model: '',
    prompt: '',
    triggerPhrase: '@kiro',
    maxDiffSize: 10_000,
    timeoutMinutes: 10,
    debug: false,
    githubMcpVersion: '0.32.0',
    kiroCliVersion: '2.27.1',
    ...overrides,
  };
}

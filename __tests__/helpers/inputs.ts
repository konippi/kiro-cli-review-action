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
    timeoutMinutes: 10,
    debug: false,
    kiroCliVersion: '2.27.1',
    ...overrides,
  };
}

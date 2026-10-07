import { runKiro } from '../../src/kiro/runner.js';

const kiroBinary = process.env.FAKE_KIRO_CLI_BINARY;
const pidFile = process.env.GRANDCHILD_PID_FILE;

if (!kiroBinary || !pidFile) throw new Error('Missing standalone runner environment');

const timeoutMs = 1_000;
// runKiro unrefs its run timeout, so keep the process alive until it fires; the grace timer must keep it alive afterwards.
setTimeout(() => {}, timeoutMs + 100);

void runKiro({
  kiroBinary,
  agentName: 'kiro-review-action',
  prompt: 'review prompt',
  cwd: process.cwd(),
  env: {
    PATH: process.env.PATH ?? '',
    FAKE_KIRO_CLI_SCENARIO: 'resistant-grandchild',
    GRANDCHILD_PID_FILE: pidFile,
  },
  timeoutMs,
  graceMs: 500,
  debug: false,
}).then((result) => {
  process.stdout.write(JSON.stringify(result));
});

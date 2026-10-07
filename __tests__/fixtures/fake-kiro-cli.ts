#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function emit(type: string, data: unknown): void {
  console.log(JSON.stringify({ type, data }));
}

function recordPid(pid: number | undefined): void {
  const pidFile = process.env.GRANDCHILD_PID_FILE;

  if (pidFile && pid) {
    appendFileSync(pidFile, String(pid));
  }
}

function startHang(resistant: boolean): void {
  const script = resistant
    ? "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"
    : 'setInterval(() => {}, 1000)';

  if (resistant) {
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    child.once('message', () => {
      recordPid(child.pid);
    });
  } else {
    const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
    recordPid(child.pid);
  }

  setInterval(() => {}, 1_000);
}

function generatedAgentPolicyIsValid(agentConfigDirectory: string): boolean {
  const parsedAgent: unknown = JSON.parse(
    readFileSync(join(agentConfigDirectory, 'kiro-review-action.json'), 'utf8'),
  );

  if (!isRecord(parsedAgent)) return false;

  const mcpServers = parsedAgent.mcpServers;
  const github = isRecord(mcpServers) ? mcpServers.github : undefined;
  const args = isRecord(github) ? github.args : undefined;

  return (
    JSON.stringify(parsedAgent.tools) === JSON.stringify(['read', 'grep', 'glob', '@github']) &&
    JSON.stringify(parsedAgent.allowedTools) === JSON.stringify(['@github']) &&
    JSON.stringify(args) ===
      JSON.stringify([
        'stdio',
        '--tools',
        'pull_request_read,pull_request_review_write,add_comment_to_pending_review',
      ])
  );
}

function handleInputEnd(): void {
  const expected = [
    'chat',
    '--no-interactive',
    '--agent-engine',
    'v2',
    '--agent',
    'kiro-review-action',
    '--output-format',
    'stream-json',
    '--require-mcp-startup',
  ];
  const argsOk = JSON.stringify(args) === JSON.stringify(expected);
  const agentConfigDirectory = process.env.KIRO_AGENT_CONFIG_DIR;
  const policyOk =
    agentConfigDirectory === undefined || generatedAgentPolicyIsValid(agentConfigDirectory);

  if (!argsOk || !policyOk) {
    emit('runError', {
      sessionId: 's-invalid-policy',
      stage: 'init',
      message: 'unexpected CLI arguments or generated agent policy',
    });
    process.exit(1);
  }

  if (scenario === 'missing-agent') {
    emit('runError', {
      sessionId: 's-missing-agent',
      stage: 'init',
      message: ['failed', "to set agent 'kiro-review-action': invalid config"].join(' '),
    });
    process.exit(4);
  }

  if (scenario === 'hang' || scenario === 'resistant-grandchild') {
    startHang(scenario === 'resistant-grandchild');
    return;
  }

  if (scenario === 'controlled-stderr') {
    process.stderr.write(`${process.env.FAKE_KIRO_CLI_STDERR ?? ''}\n`);
    process.exit(1);
  }

  if (scenario === 'crlf-stderr') {
    process.stderr.write('a\r\nb\rc\n');
    process.exit(1);
  }

  if (scenario === 'protocol-edges') {
    emit('metadata', {
      meteringUsage: [
        { value: 1.25, unit: 'credit' },
        { value: 2.75, unit: 'credit' },
        { value: 99, unit: 'token' },
      ],
    });
    emit('metadata', { meteringUsage: { value: 100, unit: 'credit' } });
    emit('sessionUpdate', { update: { sessionUpdate: 'tool_call', title: '' } });
    emit('sessionUpdate', { update: { sessionUpdate: 'tool_call' } });
    emit('sessionUpdate', { update: 'not-an-object' });
    console.log(JSON.stringify({ type: 'metadata', data: [] }));
    console.log(JSON.stringify({ type: 'metadata', data: null }));
    console.log(JSON.stringify('not-an-envelope'));
    emit('runError', { stage: 1, message: null });

    if (process.env.FAKE_KIRO_CLI_PROTOCOL_TERMINAL === 'error') {
      emit('runError', { stage: 'protocol', message: 'edge failure' });
    } else if (process.env.FAKE_KIRO_CLI_PROTOCOL_TERMINAL === 'finished-without-text') {
      emit('runFinished', { status: 'success', stopReason: 'end_turn' });
    } else {
      emit('runFinished', { status: 'success' });
    }
    process.exit(0);
  }

  if (scenario === 'error' || scenario === 'mcp') {
    emit('runError', { sessionId: 's-error', stage: 'init', message: 'failed' });
    process.exit(scenario === 'mcp' ? 3 : 1);
  }

  if (scenario === 'no-terminal') process.exit(0);
  if (scenario === 'malformed') {
    console.log('{broken');
    process.exit(0);
  }

  emit('runStarted', { payloadSchema: 'acp', acpProtocolVersion: 1, engine: 'v2' });
  emit('metadata', {
    sessionId: 's-success',
    meteringUsage: [
      { value: 1.25, unit: 'credit' },
      { value: 99, unit: 'token' },
    ],
  });
  if (scenario === 'untrusted-output') {
    process.stderr.write('stderr-ok\r::add-mask::stderr-secret\n');
  }
  emit('sessionUpdate', {
    sessionId: 's-success',
    update: {
      sessionUpdate: 'tool_call',
      title: scenario === 'untrusted-output' ? 'test\n::add-mask::tool-secret' : 'test',
    },
  });
  emit('sessionUpdate', {
    sessionId: 's-success',
    update: { sessionUpdate: 'tool_call_update', status: 'failed' },
  });
  emit('stepStarted', { sessionId: 's-success' });
  emit('runFinished', {
    sessionId: 's-success',
    status: 'success',
    stopReason: 'end_turn',
    finalText:
      scenario === 'untrusted-output' ? 'ok\r::add-mask::final-secret' : `${argsOk}:${input}`,
  });

  if (scenario === 'lingering-descendant') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    recordPid(child.pid);
    process.exit(0);
  }
}

const args = process.argv.slice(2);
const scenario = process.env.FAKE_KIRO_CLI_SCENARIO ?? 'success';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  input += chunk;
});
process.stdin.on('end', handleInputEnd);

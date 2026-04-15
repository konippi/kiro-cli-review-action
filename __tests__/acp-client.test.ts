import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { AcpClient } from '../src/acp-client.js';

function sendMessage(stdout: PassThrough, json: string): void {
  stdout.push(`${json}\n`);
}

function createMockProcess() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const proc = {
    stdin,
    stdout,
    stderr: new PassThrough(),
    pid: 12345,
    killed: false,
    on: vi.fn(),
    kill: vi.fn(),
  };
  vi.mocked(spawn).mockReturnValue(proc as never);
  return { proc, stdin, stdout };
}

describe('AcpClient', () => {
  it('starts ACP process with KIRO_API_KEY in env', async () => {
    const { proc } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'test-api-key');
    await client.start();

    expect(spawn).toHaveBeenCalledWith('/usr/bin/kiro-cli', ['acp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: expect.objectContaining({ KIRO_API_KEY: 'test-api-key' }),
    });
  });

  it('passes --agent flag when agent is specified', async () => {
    const { proc } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start('my-agent');

    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/kiro-cli',
      ['acp', '--agent', 'my-agent'],
      expect.any(Object),
    );
  });

  it('rejects send when process stdin is not writable', async () => {
    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await expect(client.initialize()).rejects.toThrow('ACP process not available');
  });

  it('resolves send when response received', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    const promise = client.initialize();
    sendMessage(stdout, '{"jsonrpc":"2.0","id":1,"result":{}}');

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects send on JSON-RPC error', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    const promise = client.initialize();
    sendMessage(stdout, '{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"fail"}}');

    await expect(promise).rejects.toThrow('ACP error -1: fail');
  });

  it('tracks tool calls and returns result from prompt', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    const initP = client.initialize();
    sendMessage(stdout, '{"jsonrpc":"2.0","id":1,"result":{}}');
    await initP;

    const sessP = client.createSession('/bin/mcp', 'token');
    sendMessage(stdout, '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"sess-1"}}');
    const sessionId = await sessP;
    expect(sessionId).toBe('sess-1');

    const promptP = client.prompt(sessionId, 'review this');

    // tool_call notification
    sendMessage(
      stdout,
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess-1","update":{"sessionUpdate":"tool_call","title":"pull_request_read"}}}',
    );
    sendMessage(stdout, '{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}');

    const result = await promptP;
    expect(result.toolCalls).toEqual(['pull_request_read']);
  });

  it('kills process on kill()', async () => {
    const { proc } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();
    client.kill();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('ignores non-JSON lines', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    stdout.push('not json at all\n');

    const initP = client.initialize();
    sendMessage(stdout, '{"jsonrpc":"2.0","id":1,"result":{}}');
    await expect(initP).resolves.toBeUndefined();
  });

  it('rejects pending promises when process exits', async () => {
    const { proc } = createMockProcess();
    const handlers = new Map<string, (...args: unknown[]) => void>();
    proc.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return proc;
    });

    const client = new AcpClient('/usr/bin/kiro-cli', true, 'key');
    await client.start();

    const initP = client.initialize();
    handlers.get('exit')?.(1);

    await expect(initP).rejects.toThrow('ACP process exited with code 1');
  });

  it('throws when createSession response has no sessionId', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    const sessP = client.createSession('/bin/mcp', 'token');
    sendMessage(stdout, '{"jsonrpc":"2.0","id":1,"result":{}}');

    await expect(sessP).rejects.toThrow('session/new response missing sessionId');
  });

  it('ignores session/update with no update field', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    // Notification with no update field — should not throw
    sendMessage(stdout, '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1"}}');

    const initP = client.initialize();
    sendMessage(stdout, '{"jsonrpc":"2.0","id":1,"result":{}}');
    await expect(initP).resolves.toBeUndefined();
  });
});

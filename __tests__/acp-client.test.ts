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

  it('rejects send when process stdin is not writable', async () => {
    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    // proc is null — not started
    await expect(client.initialize()).rejects.toThrow('ACP process not available');
  });

  it('resolves send when response received', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    const promise = client.initialize();
    // Simulate JSON-RPC response
    stdout.push('{"jsonrpc":"2.0","id":1,"result":{}}\n');

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects send on JSON-RPC error', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    const promise = client.initialize();
    stdout.push('{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"fail"}}\n');

    await expect(promise).rejects.toThrow('ACP error -1: fail');
  });

  it('accumulates review text from AgentMessageChunk', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    // Initialize
    const initPromise = client.initialize();
    stdout.push('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await initPromise;

    // Create session
    const sessionPromise = client.createSession('agent', '/bin/mcp', 'token');
    stdout.push('{"jsonrpc":"2.0","id":2,"result":{"session_id":"sess-1"}}\n');
    const sessionId = await sessionPromise;
    expect(sessionId).toBe('sess-1');

    // Prompt
    const promptPromise = client.prompt(sessionId, 'review this');
    stdout.push('{"jsonrpc":"2.0","id":3,"result":{}}\n');
    await promptPromise;

    // Notifications
    stdout.push(
      '{"jsonrpc":"2.0","method":"session/notification","params":{"type":"AgentMessageChunk","data":{"text":"looks "}}}\n',
    );
    stdout.push(
      '{"jsonrpc":"2.0","method":"session/notification","params":{"type":"ToolCall","data":{"name":"fs_read","status":"success"}}}\n',
    );
    stdout.push(
      '{"jsonrpc":"2.0","method":"session/notification","params":{"type":"AgentMessageChunk","data":{"text":"good"}}}\n',
    );
    stdout.push(
      '{"jsonrpc":"2.0","method":"session/notification","params":{"type":"TurnEnd","data":{}}}\n',
    );

    const result = await client.waitForTurnEnd(5000, sessionId);
    expect(result.reviewText).toBe('looks good');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('fs_read');
    expect(result.success).toBe(true);
  });

  it('kills process on kill()', async () => {
    const { proc } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();
    client.kill();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('calls cancel on timeout then rejects', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    // Initialize + create session + prompt
    const initP = client.initialize();
    stdout.push('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await initP;
    const sessP = client.createSession('a', '/b', 't');
    stdout.push('{"jsonrpc":"2.0","id":2,"result":{"session_id":"s1"}}\n');
    await sessP;
    const promptP = client.prompt('s1', 'hi');
    stdout.push('{"jsonrpc":"2.0","id":3,"result":{}}\n');
    await promptP;

    // waitForTurnEnd with very short timeout — no TurnEnd sent
    // cancel will be called, which sends id:4, respond to it
    const waitP = client.waitForTurnEnd(1, 's1');
    setTimeout(() => {
      stdout.push('{"jsonrpc":"2.0","id":4,"result":{}}\n');
    }, 10);
    await expect(waitP).rejects.toThrow('ACP turn timed out');
  });

  it('ignores non-JSON lines', async () => {
    const { proc, stdout } = createMockProcess();
    proc.on.mockImplementation(() => proc);

    const client = new AcpClient('/usr/bin/kiro-cli', false, 'key');
    await client.start();

    // Push garbage — should not throw
    stdout.push('not json at all\n');

    const initP = client.initialize();
    stdout.push('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await expect(initP).resolves.toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entryMocks = vi.hoisted(() => {
  return {
    connect: vi.fn(() => {
      return Promise.resolve();
    }),
    createReviewServer: vi.fn(),
    parseArguments: vi.fn(),
    transport: vi.fn(function transport() {}),
  };
});

vi.mock('@modelcontextprotocol/server/stdio', () => {
  return { StdioServerTransport: entryMocks.transport };
});

vi.mock('../../src/mcp/args.js', () => {
  return { parseArguments: entryMocks.parseArguments };
});

vi.mock('../../src/mcp/server.js', () => {
  return { createReviewServer: entryMocks.createReviewServer };
});

const originalArgv = process.argv;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  entryMocks.parseArguments.mockReturnValue({ directory: '/context' });
  entryMocks.createReviewServer.mockReturnValue({ connect: entryMocks.connect });
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

describe('review MCP entry', () => {
  it('passes argv through and connects the review server to stdio', async () => {
    process.argv = ['node', 'mcp', '--directory', '/context'];

    await import('../../src/mcp/index.js');
    await vi.waitFor(() => {
      expect(entryMocks.connect).toHaveBeenCalledTimes(1);
    });

    expect(entryMocks.parseArguments).toHaveBeenCalledWith(['--directory', '/context']);
    expect(entryMocks.createReviewServer).toHaveBeenCalledWith({ directory: '/context' });
    expect(entryMocks.transport).toHaveBeenCalledTimes(1);
    expect(entryMocks.connect).toHaveBeenCalledWith(expect.any(entryMocks.transport));
  });

  it('exits with failure only after stderr finishes writing', async () => {
    const failure = new Error('start failed');
    const exitError = new Error('process.exit called');
    let completeWrite: (() => void) | undefined;
    entryMocks.parseArguments.mockImplementation(function parseArguments() {
      throw failure;
    });
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(function write(_message, callback) {
        if (typeof callback === 'function') completeWrite = callback;
        return true;
      });
    const exit = vi.spyOn(process, 'exit').mockImplementation(function exit(): never {
      throw exitError;
    });
    process.argv = ['node', 'mcp'];

    await import('../../src/mcp/index.js');
    await vi.waitFor(function waitForWrite() {
      expect(stderr).toHaveBeenCalledWith('start failed\n', expect.any(Function));
    });

    expect(entryMocks.createReviewServer).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    if (completeWrite === undefined) throw new Error('stderr callback was not provided');
    expect(completeWrite).toThrow(exitError);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

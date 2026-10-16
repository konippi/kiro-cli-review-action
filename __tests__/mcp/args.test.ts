import { describe, expect, it } from 'vitest';
import { parseArguments } from '../../src/mcp/args.js';

const USAGE = 'Usage: mcp --directory <directory>';

describe('parseArguments', () => {
  it.each([
    [['--directory', '/context'], { directory: '/context' }],
    [['--directory=/context'], { directory: '/context' }],
  ])('parses %j', (args, expected) => {
    expect(parseArguments(args)).toEqual(expected);
  });

  it.each([
    [['--directory'], `Option '--directory <value>' argument missing\n${USAGE}`],
    [['x'], `Unexpected argument 'x'. This command does not take positional arguments\n${USAGE}`],
    [['--directory='], `Missing required option: --directory\n${USAGE}`],
  ])('rejects %j with the exact message', (args, message) => {
    expect(() => parseArguments(args)).toThrow(new Error(message));
  });

  it('preserves parse errors as the cause', () => {
    try {
      parseArguments(['--foo']);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toBe(`Unknown option '--foo'\n${USAGE}`);
      expect(error.cause).toBeInstanceOf(TypeError);
      if (!(error.cause instanceof Error)) throw error.cause;
      expect(error.cause.message).toBe("Unknown option '--foo'");
      return;
    }

    throw new Error('parseArguments did not throw');
  });
});

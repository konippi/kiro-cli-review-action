import { describe, expect, it } from 'vitest';
import { parseArguments } from '../../src/mcp/args.js';

describe('parseArguments', () => {
  it('reads the directory', () => {
    expect(parseArguments(['--directory', '/review'])).toEqual({ directory: '/review' });
  });

  it.each([
    [[], /^Missing required option: --directory\nUsage: /],
    [['--directory='], /^Missing required option: --directory\nUsage: /],
    [['--foo'], /^Unknown option '--foo'\nUsage: /],
  ])('rejects %j with usage', (args, message) => {
    expect(() => parseArguments(args)).toThrow(message);
  });
});

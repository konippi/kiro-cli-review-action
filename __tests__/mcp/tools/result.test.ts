import { describe, expect, it } from 'vitest';
import { ok } from '../../../src/mcp/tools/result.js';

describe('MCP tool results', () => {
  it('prefixes successful values with ok', () => {
    expect(ok({ posted: false })).toEqual({
      content: [{ type: 'text', text: '{"ok":true,"posted":false}' }],
    });
  });
});

import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolPolicy, customServerNames } from '../../src/kiro/tool-policy.js';

vi.mock('@actions/core', () => ({ info: vi.fn(), warning: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildToolPolicy', () => {
  it('accepts the bundled default tool policy without dropped-entry logs', () => {
    const policy = buildToolPolicy(
      { tools: ['read', 'grep', 'glob', '@github'], allowedTools: ['@github'] },
      [],
    );

    expect(policy.tools).toEqual(['read', 'grep', 'glob', '@github']);
    expect(policy.allowedTools).toEqual(['@github']);
    expect(core.info).not.toHaveBeenCalled();
    expect(core.warning).not.toHaveBeenCalled();
  });

  it('expands wildcard exposure only to declared custom MCP servers', () => {
    const source = {
      mcpServers: { jira: { command: '/jira' } },
      tools: ['*', '@jira'],
      allowedTools: ['@builtin', 'code', 'read'],
    };
    const policy = buildToolPolicy(source, customServerNames(source.mcpServers));

    expect(policy.tools).toEqual(['read', 'grep', 'glob', '@github', '@jira']);
    expect(policy.allowedTools).toEqual(['@github']);
    expect(core.info).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith(
      'Review agent auto-approves custom MCP servers only; dropped allowedTools: @builtin, code, read',
    );
  });

  it('preserves selectors and auto-approvals for declared custom MCP servers', () => {
    const policy = buildToolPolicy(
      {
        tools: ['@jira', 'fs_write', '@jira/read_*', '@github/read_*'],
        allowedTools: ['@jira/search', '*'],
      },
      ['jira'],
    );

    expect(policy.tools).toEqual(['read', 'grep', 'glob', '@github', '@jira']);
    expect(policy.allowedTools).toEqual(['@github', '@jira/search']);
    expect(core.info).toHaveBeenCalledWith(
      'Review agent exposes read, grep, glob and MCP servers only; dropped tools: fs_write, @jira/read_*, @github/read_*',
    );
    expect(core.warning).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      'Review agent auto-approves custom MCP servers only; dropped allowedTools: *',
    );
  });

  it.each([
    {
      name: 'server-wide exposure',
      tools: ['@jira'],
      allowedTools: ['@jira/read_*', '@jira/*_get', '@*/status', '@jira-*', '@jira-*/x', 'fs_*'],
      expected: ['@github', '@jira/read_*', '@jira/*_get'],
      dropped: '@*/status, @jira-*, @jira-*/x, fs_*',
    },
    {
      name: 'granular-only exposure',
      tools: ['@jira/search'],
      allowedTools: ['@jira/read_*'],
      expected: ['@github'],
      dropped: '@jira/read_*',
    },
  ])('handles allowedTools wildcards with $name', ({ tools, allowedTools, expected, dropped }) => {
    const policy = buildToolPolicy({ tools, allowedTools }, ['jira']);

    expect(policy.allowedTools).toEqual(expected);
    expect(core.info).toHaveBeenCalledWith(
      `Review agent auto-approves custom MCP servers only; dropped allowedTools: ${dropped}`,
    );
  });

  it('auto-approves only granular selectors that are exposed exactly', () => {
    const policy = buildToolPolicy(
      {
        tools: ['@jira/search'],
        allowedTools: ['@jira/search', '@jira', '@jira/other'],
      },
      ['jira'],
    );

    expect(policy.tools).toEqual(['read', 'grep', 'glob', '@github', '@jira/search']);
    expect(policy.allowedTools).toEqual(['@github', '@jira/search']);
  });

  it('drops non-string exposure and auto-approval entries', () => {
    const policy = buildToolPolicy({ tools: [42], allowedTools: [{ unsafe: true }] }, []);

    expect(policy.tools).toEqual(['read', 'grep', 'glob', '@github']);
    expect(policy.allowedTools).toEqual(['@github']);
    expect(core.info).toHaveBeenCalledWith(
      'Review agent exposes read, grep, glob and MCP servers only; dropped tools: 42',
    );
    expect(core.info).toHaveBeenCalledWith(
      'Review agent auto-approves custom MCP servers only; dropped allowedTools: {"unsafe":true}',
    );
  });

  it('formats undefined dropped tool entries without throwing', () => {
    const policy = buildToolPolicy({ tools: [undefined] }, []);

    expect(policy.tools).toEqual(['read', 'grep', 'glob', '@github']);
    expect(core.info).toHaveBeenCalledWith(
      'Review agent exposes read, grep, glob and MCP servers only; dropped tools: undefined',
    );
  });

  it('warns about selectors for undeclared MCP servers without double-reporting', () => {
    const policy = buildToolPolicy({ tools: ['@unknown'] }, []);

    expect(policy.tools).toEqual(['read', 'grep', 'glob', '@github']);
    expect(core.info).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(
      'Review agent dropped selectors for undeclared MCP servers: @unknown',
    );
  });

  it('normalizes read aliases and restricts all exposed read tools to the workspace', () => {
    const policy = buildToolPolicy(
      {
        toolsSettings: {
          read: { maxFileSize: 1000 },
          fs_read: { deniedPaths: ['secrets/**'] },
          fsRead: { allowReadOnly: true },
          grep: { timeout: 5 },
          other: { retained: true },
        },
      },
      [],
    );

    expect(policy.toolsSettings).toEqual({
      read: {
        maxFileSize: 1000,
        deniedPaths: ['secrets/**'],
        allowReadOnly: true,
        allowedPaths: ['./**'],
      },
      grep: { timeout: 5, allowedPaths: ['./**'] },
      glob: { allowedPaths: ['./**'] },
      other: { retained: true },
    });
  });

  it('uses fixed defaults when source tools and allowedTools are absent', () => {
    const policy = buildToolPolicy({}, []);

    expect(policy).toEqual({
      tools: ['read', 'grep', 'glob', '@github'],
      allowedTools: ['@github'],
      toolsSettings: {
        read: { allowedPaths: ['./**'] },
        grep: { allowedPaths: ['./**'] },
        glob: { allowedPaths: ['./**'] },
      },
    });
    expect(customServerNames({ github: {}, jira: {}, search: {} })).toEqual(['jira', 'search']);
  });
});

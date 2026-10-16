import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createToolFixture, textResult } from './helpers.js';

const fixtures = [
  createToolFixture([{ filename: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }]),
  createToolFixture([]),
];

afterEach(async () => {
  await Promise.all(fixtures.map((fixture) => fixture.close()));
});

describe('submit_review tool', () => {
  it('maps mutation results and write failures', async () => {
    const fixture = fixtures[0];
    if (!fixture) throw new Error('Expected fixture');
    const client = await fixture.connect();
    await client.callTool({
      name: 'add_review_finding',
      arguments: { path: 'a.ts', side: 'RIGHT', line: 1, body: 'Issue' },
    });

    expect(
      textResult(
        await client.callTool({
          name: 'submit_review',
          arguments: { finding_ids: ['x'], summary: 'Summary' },
        }),
      ),
    ).toEqual({
      ok: false,
      code: 'UNKNOWN_FINDING',
      message: 'Finding ID is unknown',
      retryable: true,
      valid_finding_ids: ['f1'],
    });
    const duplicate = await client.callTool({
      name: 'submit_review',
      arguments: { finding_ids: ['f1', 'f1'], summary: 'Summary' },
    });
    expect(duplicate).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('Finding IDs must be unique') }],
    });
    expect(
      textResult(
        await client.callTool({
          name: 'submit_review',
          arguments: { finding_ids: ['f1'], summary: 'Summary' },
        }),
      ),
    ).toEqual({ ok: true, posted: false });
    expect(
      textResult(
        await client.callTool({
          name: 'submit_review',
          arguments: { finding_ids: [], summary: 'Late' },
        }),
      ),
    ).toMatchObject({ code: 'FINALIZED', retryable: false });

    const missingWorkspace = fixtures[1];
    if (!missingWorkspace) throw new Error('Expected fixture');
    const missingWorkspaceClient = await missingWorkspace.connect();
    rmSync(missingWorkspace.directory, { recursive: true });
    expect(
      textResult(
        await missingWorkspaceClient.callTool({
          name: 'submit_review',
          arguments: { finding_ids: [], summary: 'Summary' },
        }),
      ),
    ).toEqual({
      ok: false,
      code: 'STATE_ERROR',
      message: 'Review proposal could not be written',
      retryable: true,
    });
  });
});

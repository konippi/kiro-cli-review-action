import { readFileSync, rmSync } from 'node:fs';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { reviewWorkspacePaths } from '../../../src/review/input.js';
import { callTool, callToolError, connectReviewTools } from '../helpers.js';

const files = [{ filename: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }];
const finding = { path: 'a.ts', side: 'RIGHT', line: 1, body: 'Issue' };

describe('submit_review tool', () => {
  it.each([
    {
      name: 'an unknown finding id',
      findingIds: ['f2'],
      expected: expect.objectContaining({ error: 'UNKNOWN_FINDING', valid_finding_ids: ['f1'] }),
    },
    {
      name: 'duplicate finding ids',
      findingIds: ['f1', 'f1'],
      expected: expect.stringMatching(/finding_ids must be unique/),
    },
  ])('rejects $name', async ({ findingIds, expected }) => {
    const { client } = await connectReviewTools(files);
    await callTool(client, 'add_review_finding', finding);

    expect(
      await callToolError(client, 'submit_review', { finding_ids: findingIds, summary: 'Summary' }),
    ).toEqual(expected);
  });

  it('writes the selected findings and the summary', async () => {
    const { client, directory } = await connectReviewTools(files);
    await callTool(client, 'add_review_finding', finding);

    expect(
      await callTool(client, 'submit_review', { finding_ids: ['f1'], summary: 'Summary' }),
    ).toEqual(['Saved 1 inline finding. The review is posted after this session.']);
    expect(JSON.parse(readFileSync(reviewWorkspacePaths(directory).proposal, 'utf8'))).toEqual({
      summary: 'Summary',
      findings: [{ id: 'f1', ...finding }],
    });
  });

  it('reports a write failure as a retryable state error', async () => {
    const { client, directory } = await connectReviewTools(files);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    onTestFinished(() => stderr.mockRestore());
    rmSync(directory, { recursive: true });

    expect(
      await callToolError(client, 'submit_review', { finding_ids: [], summary: 'Summary' }),
    ).toMatchObject({ error: 'STATE_ERROR' });
    expect(stderr).toHaveBeenCalledWith(
      expect.stringMatching(/^Review proposal could not be written: /),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { REVIEW_LIMITS } from '../../../src/review/proposal.js';
import { callTool, callToolError, connectReviewTools } from '../helpers.js';

const files = [{ filename: 'a.ts', status: 'modified', patch: '@@ -1 +1,2 @@\n-old\n+new\n+next' }];

describe('add_review_finding tool', () => {
  it('records a finding until the review is submitted', async () => {
    const { client } = await connectReviewTools(files);
    const input = { path: 'a.ts', side: 'RIGHT', line: 2, body: 'Issue' };

    expect(await callTool(client, 'add_review_finding', input)).toEqual([
      { finding_id: 'f1', recorded: 1, max_recorded: REVIEW_LIMITS.recordedFindings },
    ]);

    await callTool(client, 'submit_review', { finding_ids: [], summary: 'Done' });
    expect(await callToolError(client, 'add_review_finding', input)).toMatchObject({
      error: 'FINALIZED',
    });
  });

  it('rejects a line outside the diff with the allowed ranges', async () => {
    const { client } = await connectReviewTools(files);

    expect(
      await callToolError(client, 'add_review_finding', {
        path: 'a.ts',
        side: 'RIGHT',
        line: 9,
        body: 'Issue',
      }),
    ).toMatchObject({
      error: 'OUTSIDE_DIFF',
      message: expect.any(String),
      allowed_ranges: ['1-2'],
    });
  });
});

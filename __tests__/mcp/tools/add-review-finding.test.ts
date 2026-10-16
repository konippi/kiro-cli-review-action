import { afterEach, describe, expect, it } from 'vitest';
import { REVIEW_LIMITS } from '../../../src/review/proposal.js';
import { createToolFixture, textResult } from './helpers.js';

const fixture = createToolFixture([
  { filename: 'a.ts', status: 'modified', patch: '@@ -1 +1,2 @@\n-old\n+new\n+next' },
  { filename: 'binary.dat', status: 'modified' },
]);

afterEach(async () => {
  await fixture.close();
});

describe('add_review_finding tool', () => {
  it('records a finding and maps anchor and state failures', async () => {
    const client = await fixture.connect();

    for (const [arguments_, expected] of [
      [
        { path: 'missing.ts', side: 'RIGHT', line: 1, body: 'Issue' },
        { code: 'UNKNOWN_PATH', retryable: true, allowed_ranges: [] },
      ],
      [
        { path: 'a.ts', side: 'RIGHT', start_line: 2, line: 2, body: 'Issue' },
        { code: 'INVALID_RANGE', retryable: true, allowed_ranges: ['1-2'] },
      ],
      [
        { path: 'a.ts', side: 'RIGHT', line: 99, body: 'Issue' },
        { code: 'OUTSIDE_DIFF', retryable: true, allowed_ranges: ['1-2'] },
      ],
      [
        { path: 'binary.dat', side: 'RIGHT', line: 1, body: 'Issue' },
        { code: 'NO_PATCH', retryable: false, allowed_ranges: [] },
      ],
    ] as const) {
      expect(
        textResult(await client.callTool({ name: 'add_review_finding', arguments: arguments_ })),
      ).toMatchObject(expected);
    }

    const arguments_ = { path: 'a.ts', side: 'RIGHT', line: 2, body: 'Issue' };
    expect(
      textResult(await client.callTool({ name: 'add_review_finding', arguments: arguments_ })),
    ).toEqual({ ok: true, finding_id: 'f1', posted: false });

    for (let index = 2; index <= REVIEW_LIMITS.recordedFindings; index += 1) {
      await client.callTool({
        name: 'add_review_finding',
        arguments: { ...arguments_, body: `Issue ${index}` },
      });
    }
    expect(
      textResult(
        await client.callTool({
          name: 'add_review_finding',
          arguments: { ...arguments_, body: 'Over limit' },
        }),
      ),
    ).toMatchObject({ code: 'LIMIT_EXCEEDED', retryable: false });

    await client.callTool({
      name: 'submit_review',
      arguments: { finding_ids: [], summary: 'Summary' },
    });
    expect(
      textResult(await client.callTool({ name: 'add_review_finding', arguments: arguments_ })),
    ).toMatchObject({ code: 'FINALIZED', retryable: false });
  });
});

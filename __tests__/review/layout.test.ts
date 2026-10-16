import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reviewWorkspacePaths } from '../../src/review/layout.js';

describe('review workspace layout', () => {
  it('resolves every shared file within the review workspace', () => {
    const directory = join('tmp', 'review-workspace');

    expect(reviewWorkspacePaths(directory)).toEqual({
      context: join(directory, 'context.json'),
      patches: join(directory, 'patches.json'),
      proposal: join(directory, 'proposal.json'),
    });
  });
});

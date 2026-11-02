import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readReviewInput } from '../../src/review/input.js';
import { createTemporaryDirectory } from '../helpers/temporary-directory.js';

describe('readReviewInput', () => {
  it('rejects input that does not match the schema with its path and the failing field', () => {
    const path = join(createTemporaryDirectory(), 'pull-request.json');
    writeFileSync(path, JSON.stringify({ pullRequest: { number: 1 }, files: [] }));

    expect(() => readReviewInput(path)).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          new RegExp(`^Invalid review input in ${path}\\n.*pullRequest\\.title`, 's'),
        ),
      }),
    );
  });
});

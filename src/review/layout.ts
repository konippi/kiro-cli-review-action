import { join } from 'node:path';
import type { PullRequestFile } from './diff.js';

const REVIEW_FILE_NAMES = {
  context: 'context.json',
  patches: 'patches.json',
  proposal: 'proposal.json',
} as const;

interface ReviewWorkspacePaths {
  readonly context: string;
  readonly patches: string;
  readonly proposal: string;
}

/** Host-prepared pull-request patches file. */
export interface ReviewPatchesFile {
  readonly files: readonly PullRequestFile[];
}

/** Resolves every file shared by the review host and recorder. */
export function reviewWorkspacePaths(directory: string): ReviewWorkspacePaths {
  return {
    context: join(directory, REVIEW_FILE_NAMES.context),
    patches: join(directory, REVIEW_FILE_NAMES.patches),
    proposal: join(directory, REVIEW_FILE_NAMES.proposal),
  };
}

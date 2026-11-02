import { join } from 'node:path';
import * as z from 'zod/v4';
import { readJsonFile } from '../fs.js';

const PullRequestFileSchema = z.object({
  filename: z.string().min(1),
  previous_filename: z.string().optional(),
  status: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().optional(),
});

const ReviewInputSchema = z.object({
  pullRequest: z.object({
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string(),
    author: z.string(),
    baseRef: z.string(),
    headRef: z.string(),
    changedFiles: z.number().int().nonnegative(),
  }),
  files: z.array(PullRequestFileSchema),
});

/** GitHub pull-request file entry as returned by the list files API. */
export type PullRequestFile = z.infer<typeof PullRequestFileSchema>;

/** Host-prepared pull request the review server exposes. */
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

interface ReviewWorkspacePaths {
  readonly input: string;
  readonly proposal: string;
}

/** Resolves every file shared by the review host and recorder. */
export function reviewWorkspacePaths(directory: string): ReviewWorkspacePaths {
  return {
    input: join(directory, 'pull-request.json'),
    proposal: join(directory, 'proposal.json'),
  };
}

/** Reads and validates the host-prepared review input. */
export function readReviewInput(path: string): ReviewInput {
  const result = ReviewInputSchema.safeParse(readJsonFile(path));
  if (!result.success) {
    throw new Error(`Invalid review input in ${path}\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  return result.data;
}

import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { throttling } from '@octokit/plugin-throttling';
import type { PullRequestTarget } from '../context.js';
import { isHttpError } from '../errors.js';
import { indexAnchors, parsePatch, validateAnchor } from './diff.js';
import type { ReviewInput } from './input.js';
import type { ReviewFinding, ReviewProposal } from './proposal.js';

const MAX_BODY_LENGTH = 65_536;
const SERVER_ERROR_DELAY_SECONDS = 10;

type Octokit = ReturnType<typeof getOctokit>;

/** Posted review and where its findings ended up. */
export interface PublishedReview {
  readonly reviewId: number;
  readonly inlineFindings: number;
  readonly bodyFindings: number;
}

interface ReviewDraft {
  readonly body: string;
  readonly inline: readonly ReviewFinding[];
}

function isAnchored(input: ReviewInput, finding: ReviewFinding): boolean {
  const file = input.files.find((candidate) => candidate.filename === finding.path);
  const hunks = file?.patch ? parsePatch(file.patch) : null;
  if (!file || !hunks) return false;

  return validateAnchor(indexAnchors(hunks, file.status === 'renamed'), finding).ok;
}

function formatLocation({ path, side, line, startLine }: ReviewFinding): string {
  const prefix = side === 'RIGHT' ? 'R' : 'L';
  const lines =
    startLine === undefined ? `${prefix}${line}` : `${prefix}${startLine}-${prefix}${line}`;
  return `\`${path}\` ${lines}`;
}

function renderBody(
  summary: string,
  bodyFindings: readonly ReviewFinding[],
  marker: string,
): string {
  const sections = [summary];
  if (bodyFindings.length > 0) {
    sections.push(
      '### Findings not posted inline',
      ...bodyFindings.map((finding) => `**${formatLocation(finding)}**\n\n${finding.body}`),
    );
  }

  const body = sections.join('\n\n');
  const limit = MAX_BODY_LENGTH - marker.length - 2;
  const fitted = body.length > limit ? `${body.slice(0, limit - 1)}…` : body;
  return `${fitted}\n\n${marker}`;
}

async function findReview(
  octokit: Octokit,
  target: PullRequestTarget,
  marker: string,
): Promise<number | undefined> {
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner: target.owner,
    repo: target.repo,
    pull_number: target.prNumber,
    per_page: 100,
  });
  return reviews.find((review) => review.body?.includes(marker))?.id;
}

async function createReview(
  octokit: Octokit,
  target: PullRequestTarget,
  marker: string,
  { body, inline }: ReviewDraft,
): Promise<number> {
  const request = {
    owner: target.owner,
    repo: target.repo,
    pull_number: target.prNumber,
    event: 'COMMENT' as const,
    body,
    ...(inline.length === 0
      ? {}
      : {
          commit_id: target.headSha,
          comments: inline.map((finding) => ({
            path: finding.path,
            side: finding.side,
            line: finding.line,
            ...(finding.startLine === undefined
              ? {}
              : { start_line: finding.startLine, start_side: finding.side }),
            body: finding.body,
          })),
        }),
  };

  try {
    return (await octokit.rest.pulls.createReview(request)).data.id;
  } catch (error: unknown) {
    if (!isHttpError(error) || error.status < 500) throw error;

    core.warning(
      `Posting the review failed, retrying in ${SERVER_ERROR_DELAY_SECONDS} seconds: ${error.message}`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, SERVER_ERROR_DELAY_SECONDS * 1000));

    const existing = await findReview(octokit, target, marker);
    if (existing !== undefined) return existing;
    return (await octokit.rest.pulls.createReview(request)).data.id;
  }
}

/** Posts the proposal as one COMMENT review, moving findings GitHub cannot anchor into the body. */
export async function publishReview(
  target: PullRequestTarget,
  token: string,
  input: ReviewInput,
  proposal: ReviewProposal,
): Promise<PublishedReview> {
  const octokit = getOctokit(
    token,
    {
      throttle: {
        onRateLimit: () => false,
        onSecondaryRateLimit: (_retryAfter, _options, _octokit, retryCount) => retryCount === 0,
      },
    },
    throttling,
  );
  const marker = `<!-- kiro-review:${crypto.randomUUID()} -->`;
  const inline = proposal.findings.filter((finding) => isAnchored(input, finding));
  const bodyFindings = proposal.findings.filter((finding) => !inline.includes(finding));

  try {
    const reviewId = await createReview(octokit, target, marker, {
      body: renderBody(proposal.summary, bodyFindings, marker),
      inline,
    });
    return { reviewId, inlineFindings: inline.length, bodyFindings: bodyFindings.length };
  } catch (error: unknown) {
    if (!isHttpError(error) || error.status !== 422 || inline.length === 0) throw error;

    core.warning(
      `GitHub rejected the inline comments, posting every finding in the review body: ${error.message}`,
    );
    const reviewId = await createReview(octokit, target, marker, {
      body: renderBody(proposal.summary, proposal.findings, marker),
      inline: [],
    });
    return { reviewId, inlineFindings: 0, bodyFindings: proposal.findings.length };
  }
}

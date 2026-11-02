import { anchorHunkLines, type FileAnchors, indexAnchors, parsePatch } from '../review/diff.js';
import { type PullRequestFile, readReviewInput, reviewWorkspacePaths } from '../review/input.js';
import { paginateHunks, paginateItems } from '../review/pages.js';
import { createReviewRecorder, type ReviewRecorder } from '../review/proposal.js';

/** Diff pages and commentable lines of a changed file with a text patch. */
export interface ReviewPatch {
  readonly pages: readonly string[];
  readonly anchors: FileAnchors;
}

/** Host-prepared review state shared by the tools of one server. */
export interface ReviewWorkspace {
  readonly contextPages: readonly object[];
  readonly files: ReadonlyMap<string, ReviewPatch | null>;
  readonly recorder: ReviewRecorder;
}

function loadPatch(file: PullRequestFile): ReviewPatch | null {
  const hunks = file.patch ? parsePatch(file.patch) : null;
  if (!hunks) return null;

  const renamed = file.status === 'renamed';
  return {
    pages: paginateHunks(
      hunks.map((hunk) => ({ header: hunk.header, lines: anchorHunkLines(hunk, renamed) })),
    ),
    anchors: indexAnchors(hunks, renamed),
  };
}

/** Loads the host-prepared pull request and lays out every patch once. */
export function loadReviewWorkspace(directory: string): ReviewWorkspace {
  const paths = reviewWorkspacePaths(directory);
  const { pullRequest, files } = readReviewInput(paths.input);
  const loaded = files.map((file) => ({ file, patch: loadPatch(file) }));
  const omittedFiles = pullRequest.changedFiles - files.length;
  const metadata = {
    pull_request: {
      number: pullRequest.number,
      author: pullRequest.author,
      base: pullRequest.baseRef,
      head: pullRequest.headRef,
    },
    author_content: { title: pullRequest.title, description: pullRequest.body },
    ...(omittedFiles > 0 ? { omitted_files: omittedFiles } : {}),
  };
  const filePages = paginateItems(
    loaded.map(({ file, patch }) => ({
      path: file.filename,
      ...(file.previous_filename === undefined ? {} : { previous_path: file.previous_filename }),
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      diff_pages: patch?.pages.length ?? 0,
    })),
    (entry) => JSON.stringify(entry).length + 1,
  );

  return {
    contextPages: filePages.map((pageFiles, index) => ({
      page: index + 1,
      total_pages: filePages.length,
      ...(index === 0 ? metadata : {}),
      files: pageFiles,
    })),
    files: new Map(loaded.map(({ file, patch }) => [file.filename, patch])),
    recorder: createReviewRecorder(paths.proposal),
  };
}

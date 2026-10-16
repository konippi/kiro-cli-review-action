import { readJsonFile, readJsonText } from '../../fs.js';
import { type AnchorMap, buildAnchorMap, type PullRequestFile } from '../../review/diff.js';
import { type ReviewPatchesFile, reviewWorkspacePaths } from '../../review/layout.js';
import { createReviewState, type ReviewState } from '../../review/proposal.js';

/** Host-prepared review workspace shared by tools. */
export interface ReviewWorkspace {
  readonly context: string;
  readonly proposalPath: string;
  readonly state: ReviewState;
  readonly files: ReadonlyMap<string, PullRequestFile>;
  readonly anchors: AnchorMap;
}

/** Loads the host-prepared review workspace shared by tools. */
export function loadReviewWorkspace(directory: string): ReviewWorkspace {
  const paths = reviewWorkspacePaths(directory);

  const { files: patches } = readJsonFile<ReviewPatchesFile>(paths.patches);

  const files = new Map<string, PullRequestFile>();
  for (const file of patches) files.set(file.filename, file);

  return {
    context: readJsonText(paths.context),
    proposalPath: paths.proposal,
    state: createReviewState(),
    files,
    anchors: buildAnchorMap(patches),
  };
}

/** Validated action inputs. */
export interface ActionInputs {
  readonly kiroApiKey: string;
  readonly githubToken: string;
  readonly agent: string;
  readonly model: string;
  readonly prompt: string;
  readonly triggerPhrase: string;
  readonly maxDiffSize: number;
  readonly debug: boolean;
  readonly githubMcpVersion: string;
}

/** Parsed GitHub event context for pull_request events. */
export interface EventContext {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly baseBranch: string;
  readonly isFork: boolean;
}

export interface CommentContext {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
}

export interface ReviewResult {
  readonly toolCalls: readonly string[];
}

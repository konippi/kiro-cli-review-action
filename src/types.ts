/** Validated action inputs. */
export interface ActionInputs {
  readonly kiroApiKey: string;
  readonly githubToken: string;
  readonly agent: string;
  readonly prompt: string;
  readonly maxDiffSize: number;
  readonly debug: boolean;
  readonly githubMcpVersion: string;
}

/** Parsed GitHub event context. Only available for pull_request events. */
export interface EventContext {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly baseBranch: string;
  readonly isFork: boolean;
}

/** Result of a kiro-cli review session. */
export interface ReviewResult {
  readonly reviewText: string;
  readonly toolCalls: readonly string[];
}

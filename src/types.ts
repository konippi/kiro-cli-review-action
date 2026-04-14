/** Validated action inputs. */
export interface ActionInputs {
  readonly kiroApiKey: string;
  readonly githubToken: string;
  readonly agent: string;
  readonly prompt: string;
  readonly maxDiffSize: number;
  readonly timeoutMinutes: number;
  readonly debug: boolean;
  readonly githubMcpVersion: string;
}

/** Parsed GitHub event context. Only available for pull_request events. */
export interface EventContext {
  readonly eventName: string;
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly baseBranch: string;
  readonly isFork: boolean;
}

/** Result of a kiro-cli review session. */
export interface ReviewResult {
  readonly success: boolean;
  readonly reviewText: string;
  readonly toolCalls: readonly ToolCallRecord[];
}

/** Record of a tool call observed via ACP. */
export interface ToolCallRecord {
  readonly name: string;
  readonly status: string;
}

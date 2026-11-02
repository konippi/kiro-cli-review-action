/** Narrows an unknown error to a Node.js system error carrying a `code`. */
export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** Returns the message of an Error, or the string form of any other thrown value. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fields of an Octokit request error that this action reads. */
export interface HttpError extends Error {
  readonly status: number;
}

/** Narrows a caught value to an Octokit request error carrying a numeric HTTP status. */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error && 'status' in error && typeof error.status === 'number';
}

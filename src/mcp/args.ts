import { parseArgs } from 'node:util';
import { toErrorMessage } from '../errors.js';
import type { ReviewServerOptions } from './server.js';

const USAGE = 'Usage: mcp --directory <directory>';

/** Parses the review server command-line arguments. */
export function parseArguments(args: readonly string[]): ReviewServerOptions {
  let values: { readonly directory?: string };
  try {
    ({ values } = parseArgs({ args: [...args], options: { directory: { type: 'string' } } }));
  } catch (error: unknown) {
    throw new Error(`${toErrorMessage(error)}\n${USAGE}`, { cause: error });
  }

  if (!values.directory) throw new Error(`Missing required option: --directory\n${USAGE}`);
  return { directory: values.directory };
}

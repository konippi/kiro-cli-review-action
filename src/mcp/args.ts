import { parseArgs } from 'node:util';
import { toErrorMessage } from '../errors.js';

const USAGE = 'Usage: mcp --directory <directory>';

/** Parses the MCP command-line arguments. */
export function parseArguments(args: readonly string[]): { readonly directory: string } {
  let directory: string | undefined;

  try {
    const { values } = parseArgs({
      args,
      options: { directory: { type: 'string' } },
    });
    directory = values.directory;
  } catch (error) {
    throw new Error(`${toErrorMessage(error)}\n${USAGE}`, { cause: error });
  }

  if (directory === undefined || directory === '') {
    throw new Error(`Missing required option: --directory\n${USAGE}`);
  }

  return { directory };
}

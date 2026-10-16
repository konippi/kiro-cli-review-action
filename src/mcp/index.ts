import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { toErrorMessage } from '../errors.js';
import { parseArguments } from './args.js';
import { createReviewServer } from './server.js';

async function run(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const server = createReviewServer(options);
  await server.connect(new StdioServerTransport());
}

function exitFailure(): void {
  process.exit(1);
}

function fail(error: unknown): void {
  process.stderr.write(`${toErrorMessage(error)}\n`, exitFailure);
}

run().catch(fail);

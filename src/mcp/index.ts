import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { toErrorMessage } from '../errors.js';
import { parseArguments } from './args.js';
import { createReviewServer } from './server.js';

async function run(): Promise<void> {
  const server = createReviewServer(parseArguments(process.argv.slice(2)));
  await server.connect(new StdioServerTransport());
}

run().catch((error: unknown) => {
  process.stderr.write(`${toErrorMessage(error)}\n`);
  process.exitCode = 1;
});

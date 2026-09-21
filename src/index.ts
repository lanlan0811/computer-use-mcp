/**
 * stdio MCP server entry point (the published `computer-use` bin).
 *
 * stdout is reserved for the MCP protocol; all diagnostics go to stderr.
 */

import process from 'node:process';

import { config } from './core/config.js';
import { createLogger } from './mcp/logging.js';
import { main } from './mcp/server.js';

const logger = createLogger('startup');

main().catch((error: unknown) => {
  logger.error(
    `fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  process.exitCode = 1;
});

if (config.disabled) {
  logger.warn('COMPUTER_USE_DISABLED is set: every tool call will refuse');
}

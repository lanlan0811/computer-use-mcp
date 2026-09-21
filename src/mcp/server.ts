/**
 * stdio MCP server wiring: the `tools` capability only (plan decision 12).
 *
 * The server instructions carry the model-facing guidance (the work loop,
 * the shared-input-stream rules, and the safety boundary lists), which is
 * where cc-haha's WINDOWS_COMPUTER_USE_PROMPT lands in this project
 * (plan §6.3).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { config } from '../core/config.js';
import { COMPUTER_USE_INSTRUCTIONS } from '../core/instructions.js';
import { createLogger } from './logging.js';
import { ToolDispatcher, type ToolResult } from './dispatcher.js';
import { FileLock } from './fileLock.js';
import { WorkerClient } from './workerClient.js';

const logger = createLogger('server');

export interface ServerHandle {
  server: Server;
  dispatcher: ToolDispatcher;
  worker: WorkerClient;
  lock: FileLock;
  close(): Promise<void>;
}

export async function createServer(): Promise<ServerHandle> {
  const lock = new FileLock(config.shotDir);
  const worker = new WorkerClient();
  const dispatcher = new ToolDispatcher(worker, lock);

  const server = new Server(
    {
      name: config.serverName,
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: COMPUTER_USE_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: dispatcher.tools() };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request, extra): Promise<CallToolResult> => {
      const started = Date.now();
      const result: ToolResult = await dispatcher.handleToolCall(
        request.params.name,
        (request.params.arguments ?? {}) as Record<string, unknown>,
        { signal: extra.signal },
      );
      logger.debug(
        `${request.params.name} ${result.isError ? 'error' : 'ok'} in ${Date.now() - started}ms`,
      );
      return {
        content: result.content.map((block) =>
          block.type === 'text'
            ? { type: 'text' as const, text: block.text }
            : {
                type: 'image' as const,
                data: block.data,
                mimeType: block.mimeType,
              },
        ),
        isError: result.isError,
      };
    },
  );

  const close = async (): Promise<void> => {
    worker.shutdown();
    lock.release();
    await server.close();
  };

  // stdin EOF or process exit: never leave the worker or the lock behind.
  const onExit = (): void => {
    worker.shutdown();
    lock.release();
  };
  process.on('exit', onExit);
  process.on('SIGINT', () => {
    void close().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void close().then(() => process.exit(0));
  });

  return { server, dispatcher, worker, lock, close };
}

/** Boot the server over stdio. */
export async function main(): Promise<void> {
  const handle = await createServer();
  const transport = new StdioServerTransport();
  await handle.server.connect(transport);
  logger.info(`${config.serverName} MCP server ready (stdio)`);
}

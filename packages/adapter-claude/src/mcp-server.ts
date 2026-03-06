#!/usr/bin/env node
/**
 * dot-ai MCP server for Claude Code.
 * Exposes extension tools as MCP tools via stdio transport.
 * Zero dependencies — speaks JSON-RPC 2.0 directly.
 *
 * Usage in .claude/settings.json:
 *   "mcpServers": {
 *     "dot-ai": {
 *       "command": "node",
 *       "args": ["path/to/mcp-server.js"]
 *     }
 *   }
 */
import { DotAiRuntime } from '@dot-ai/core';
import type { Capability } from '@dot-ai/core';

// ── JSON-RPC types ──

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── MCP Protocol constants ──
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'dot-ai';
const SERVER_VERSION = '0.6.0';

// ── State ──
let capabilities: Capability[] = [];
let initialized = false;
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (initialized) return;
  if (!initPromise) {
    initPromise = initCapabilities();
  }
  return initPromise;
}

// ── Initialize runtime ──
async function initCapabilities(): Promise<void> {
  if (initialized) return;

  try {
    const workspaceRoot = process.cwd();
    const runtime = new DotAiRuntime({ workspaceRoot });
    await runtime.boot();
    capabilities = runtime.capabilities;
    initialized = true;
  } catch (err) {
    process.stderr.write(`[dot-ai-mcp] Init error: ${err}\n`);
  }
}

// ── MCP method handlers ──

function handleInitialize(_params: Record<string, unknown>): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  };
}

async function handleToolsList(): Promise<unknown> {
  await ensureInit();
  return {
    tools: capabilities.map((cap) => ({
      name: cap.name,
      description: cap.description,
      inputSchema: {
        ...cap.parameters,
      },
    })),
  };
}

async function handleToolsCall(params: Record<string, unknown>): Promise<unknown> {
  await ensureInit();
  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  const cap = capabilities.find((c) => c.name === name);
  if (!cap) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await cap.execute(args);
    return {
      content: [{ type: 'text', text: result.text }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

// ── Message handling ──

function send(msg: JsonRpcResponse): void {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

async function handleMessage(msg: JsonRpcRequest): Promise<void> {
  // Notifications (no id) — just acknowledge
  if (msg.method === 'notifications/initialized') {
    ensureInit().catch((err) => process.stderr.write(`[dot-ai-mcp] Init error: ${err}\n`));
    return;
  }

  if (msg.method === 'notifications/cancelled') {
    return;
  }

  const id = msg.id;

  try {
    let result: unknown;

    switch (msg.method) {
      case 'initialize':
        result = handleInitialize(msg.params ?? {});
        break;

      case 'tools/list':
        result = await handleToolsList();
        break;

      case 'tools/call':
        result = await handleToolsCall(msg.params ?? {});
        break;

      case 'ping':
        result = {};
        break;

      default:
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        });
        return;
    }

    send({ jsonrpc: '2.0', id, result });
  } catch (err) {
    send({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

// ── Stdio transport (Content-Length framing) ──

function main(): void {
  let buffer = '';

  process.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');

    // Process all complete messages in buffer
    while (true) {
      // Look for Content-Length header
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Skip malformed header
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;

      if (buffer.length < bodyStart + contentLength) {
        // Wait for more data
        break;
      }

      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as JsonRpcRequest;
        handleMessage(msg).catch((err) => {
          process.stderr.write(`[dot-ai-mcp] Handler error: ${err}\n`);
        });
      } catch {
        process.stderr.write('[dot-ai-mcp] Failed to parse JSON-RPC message\n');
      }
    }
  });

  process.stderr.write('[dot-ai-mcp] Server started\n');
}

main();

// Authenticated MCP server for the console (ADR 0003, Phase 3).
//
// A minimal, spec-shaped JSON-RPC 2.0 MCP server exposing the telemetry / cost
// analytics as MCP tools. Transport-agnostic: this module is the pure protocol
// handler; console-hub-server mounts it at POST /mcp behind the OAuth
// Resource-Server auth (requires the `telemetry:read` scope). Tools are tenant-
// scoped via the authenticated request context. Hand-rolled (no SDK dependency)
// for slice 1; the official @modelcontextprotocol/sdk can replace this later for
// richer features (resources, prompts, streaming) without changing callers.
import type { ConsoleRequestContext } from "./types";

/** Latest MCP protocol revision this server speaks. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "kontour-console", version: "0.1.0" };

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Minimal slice of the telemetry store the MCP tools need (keeps this decoupled). */
export interface McpTelemetry {
  summarize(context: ConsoleRequestContext): Promise<unknown>;
}
export interface McpContext {
  telemetry: McpTelemetry;
  requestContext: ConsoleRequestContext;
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: McpContext) => Promise<unknown>;
}

const TOOLS: McpToolDef[] = [
  {
    name: "get_usage_summary",
    description:
      "Token usage and estimated cost analytics for the authenticated tenant: totals plus breakdowns by model, project, agent, and runtime.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_args, ctx) => {
      const summary = (await ctx.telemetry.summarize(ctx.requestContext)) as {
        generatedAt?: string;
        totals?: { recordCount?: number; sessionCount?: number; usage?: unknown };
        analytics?: unknown;
      };
      // Curated, cost-focused projection — omit the bulky raw records/sources.
      return {
        generatedAt: summary.generatedAt,
        totals: {
          recordCount: summary.totals?.recordCount,
          sessionCount: summary.totals?.sessionCount,
          usage: summary.totals?.usage
        },
        analytics: summary.analytics
      };
    }
  }
];

const ok = (id: string | number | null, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const fail = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

/** List the tool descriptors (also useful for tests / docs). */
export function listMcpTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

/**
 * Handle one JSON-RPC MCP message. Returns the response, or null for a
 * notification (no `id`) that warrants no reply.
 */
export async function handleMcpRequest(message: unknown, ctx: McpContext): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== "object") return fail(null, -32600, "invalid request");
  const req = message as Partial<JsonRpcRequest>;
  const id = req.id ?? null;
  const isNotification = req.id === undefined;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return isNotification ? null : fail(id, -32600, "invalid request");
  }

  switch (req.method) {
    case "initialize":
      return ok(id, { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: listMcpTools() });
    case "tools/call": {
      const params = (req.params || {}) as { name?: string; arguments?: Record<string, unknown> };
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `unknown tool: ${params.name ?? "(none)"}`);
      try {
        const output = await tool.run(params.arguments || {}, ctx);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(output) }], isError: false });
      } catch (err) {
        // Tool-level failures are returned as isError content (per MCP), not JSON-RPC errors.
        return ok(id, { content: [{ type: "text", text: `tool error: ${(err as Error).message}` }], isError: true });
      }
    }
    default:
      // Unknown notifications (e.g. notifications/initialized) are silently accepted.
      return isNotification ? null : fail(id, -32601, `method not found: ${req.method}`);
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import { handleMcpRequest, listMcpTools, MCP_PROTOCOL_VERSION, type McpContext } from "../src/console-foundation/mcp-server";

const SUMMARY = {
  generatedAt: "2026-06-29",
  totals: { recordCount: 2, sessionCount: 1, usage: { estimatedCostUsd: 1.5 } },
  analytics: { usageByModel: [{ model: "claude-opus-4-8", estimatedCostUsd: 1.5 }] },
  records: [{ big: "omitted" }],
  sources: [{ big: "omitted" }]
};
const ctx = (summary: unknown = SUMMARY): McpContext => ({
  telemetry: { summarize: async () => summary },
  requestContext: { tenantId: "t1", runtimeMode: "hosted", authMethod: "jwt" }
});

test("initialize returns the protocol version + tools capability + serverInfo", async () => {
  const res = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, ctx());
  assert.equal(res?.error, undefined);
  const r = res!.result as any;
  assert.equal(r.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.ok(r.capabilities.tools);
  assert.equal(r.serverInfo.name, "kontour-console");
});

test("tools/list advertises get_usage_summary with an object input schema", async () => {
  const res = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx());
  const tools = (res!.result as any).tools;
  const tool = tools.find((t: any) => t.name === "get_usage_summary");
  assert.ok(tool);
  assert.equal(tool.inputSchema.type, "object");
  assert.deepEqual(listMcpTools().map((t) => t.name), tools.map((t: any) => t.name));
});

test("tools/call get_usage_summary returns the curated analytics (records/sources omitted)", async () => {
  const res = await handleMcpRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_usage_summary", arguments: {} } }, ctx());
  const result = res!.result as any;
  assert.equal(result.isError, false);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.generatedAt, "2026-06-29");
  assert.equal(payload.totals.recordCount, 2);
  assert.deepEqual(payload.analytics.usageByModel, [{ model: "claude-opus-4-8", estimatedCostUsd: 1.5 }]);
  assert.equal(payload.records, undefined); // bulky fields dropped
  assert.equal(payload.sources, undefined);
});

test("tools/call unknown tool -> JSON-RPC -32602", async () => {
  const res = await handleMcpRequest({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } }, ctx());
  assert.equal(res!.error!.code, -32602);
});

test("tools/call surfaces tool failures as isError content, not a JSON-RPC error", async () => {
  const failing: McpContext = {
    telemetry: { summarize: async () => { throw new Error("boom"); } },
    requestContext: { tenantId: "t1", runtimeMode: "hosted", authMethod: "jwt" }
  };
  const res = await handleMcpRequest({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_usage_summary" } }, failing);
  assert.equal(res!.error, undefined);
  assert.equal((res!.result as any).isError, true);
  assert.match((res!.result as any).content[0].text, /boom/);
});

test("unknown method -> -32601; notification -> null; bad jsonrpc -> -32600", async () => {
  assert.equal((await handleMcpRequest({ jsonrpc: "2.0", id: 6, method: "nope" }, ctx()))!.error!.code, -32601);
  assert.equal(await handleMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx()), null);
  assert.equal((await handleMcpRequest({ jsonrpc: "1.0", id: 7, method: "x" }, ctx()))!.error!.code, -32600);
});

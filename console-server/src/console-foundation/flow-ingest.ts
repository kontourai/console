// Hosted-console ingest stub for the Flow ingest contract v1 (provisional).
//
// Implements `POST /ingest/flow`: validates a request body against Flow's
// EXPORTED `FlowIngestRequest` envelope (Flow OWNS the payload), then wraps the
// `payload` (a `FlowConsoleProjection`) into console's own `kontour.console.event`
// envelope and returns `202 { recordId }`. A bad contractVersion/shape returns
// `4xx { error }`.
//
// Dependency direction is console -> flow: we import Flow's contract type from
// the stable `@kontourai/flow/console-contract` subpath, TYPE-ONLY (mirroring how
// flow-bridge already imports Flow's projection types). Console pulls in NO Flow
// runtime; the import erases at compile time. Console stays read-only — it owns
// no authoritative trust/process state; it only records.
//
// This is a focused, tested stub. It is NOT wired into the production HTTP
// server with real auth middleware yet — see the TODO at the bottom.
import type {
  FlowIngestRequest,
  FlowConsoleProjection,
} from "@kontourai/flow/console-contract" with { "resolution-mode": "import" };
import type { ConsoleEventRecord } from "./types";

/** Status + JSON body the stub returns. The caller maps this onto the response. */
export interface FlowIngestResult {
  status: 202 | 400;
  body: { recordId: string } | { error: string };
}

/** The only contract version this handler accepts. */
const CONTRACT_VERSION = "1" as const;

/**
 * Validate an unknown request body against Flow's `FlowIngestRequest` envelope.
 * Returns the typed request on success, or a human-readable error string. We do
 * shape validation here (the dependency-correct place: console owns ingest); the
 * exported Flow type is the source of truth for the shape.
 */
export function validateFlowIngestRequest(
  body: unknown,
): { ok: true; request: FlowIngestRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "ingest body must be a JSON object" };
  }
  const candidate = body as Record<string, unknown>;

  if (candidate.contractVersion !== CONTRACT_VERSION) {
    return {
      ok: false,
      error: `unsupported contractVersion ${JSON.stringify(candidate.contractVersion)}; expected "1"`,
    };
  }
  if (candidate.source !== "flow") {
    return { ok: false, error: `unsupported source ${JSON.stringify(candidate.source)}; expected "flow"` };
  }
  if (typeof candidate.type !== "string" || candidate.type.length === 0) {
    return { ok: false, error: "missing or invalid `type`" };
  }
  if (typeof candidate.idempotencyKey !== "string" || candidate.idempotencyKey.length === 0) {
    return { ok: false, error: "missing or invalid `idempotencyKey`" };
  }
  if (typeof candidate.occurredAt !== "string" || candidate.occurredAt.length === 0) {
    return { ok: false, error: "missing or invalid `occurredAt`" };
  }
  const payload = candidate.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, error: "missing or invalid `payload`" };
  }
  // Minimal FlowConsoleProjection shape check: it must carry run.run_id, which
  // we need to derive the console event subject/scope. Console does not re-derive
  // Flow's process state; it only records a reference.
  const run = (payload as Record<string, unknown>).run;
  if (typeof run !== "object" || run === null || typeof (run as Record<string, unknown>).run_id !== "string") {
    return { ok: false, error: "payload is not a FlowConsoleProjection (missing run.run_id)" };
  }

  // Type assertion is safe: the runtime checks above mirror the FlowIngestRequest
  // contract whose authoritative shape lives in @kontourai/flow.
  return { ok: true, request: body as FlowIngestRequest };
}

/**
 * Wrap a validated ingest request's Flow-owned `payload` into console's own
 * `kontour.console.event` envelope. Mirrors the derivation path the flow-bridge
 * uses (`deriveFlowRunEvents` `base()`): deterministic id, producer/scope/
 * subject/actor derived from the run identity. `idempotencyKey` becomes the
 * event id so a re-POST dedups (hub projections dedup by id).
 */
export function wrapFlowIngestRecord(request: FlowIngestRequest): ConsoleEventRecord {
  const projection = request.payload as FlowConsoleProjection;
  const runId = projection.run.run_id;
  const subject = projection.run.subject ?? runId;
  // Deterministic, idempotency-stable record id (the contract dedups on
  // idempotencyKey). Sanitize for an id-safe token.
  const recordId = `evt-flowingest-${request.idempotencyKey.replace(/[^A-Za-z0-9_:.-]/g, "-")}`;

  return {
    schema: "kontour.console.event",
    version: "0.1",
    id: recordId,
    type: request.type,
    occurredAt: request.occurredAt,
    producer: { id: "flow-ingest", product: "flow", name: "Flow hosted ingest", runId: `run-${runId}` },
    scope: { kind: "project", id: "flow-hosted", label: "Flow hosted runs" },
    subject: { product: "flow", kind: "run", id: `run-${runId}`, label: `${subject} (${runId})` },
    summary: `Flow run ${runId} projection ingested (${request.type}).`,
    payload: {
      // Console owns the envelope; Flow owns the projection it wraps, recorded
      // read-only as `after`.
      after: projection as unknown as Record<string, unknown>,
      summary: `Flow run ${runId} (${subject}) projection v${projection.schema_version}.`,
    },
  };
}

/**
 * The `POST /ingest/flow` stub: validate -> wrap -> 202 { recordId }, or
 * 400 { error } on a bad contractVersion/shape. Pure (no I/O) so it is trivially
 * unit-testable; the caller is responsible for reading the JSON body, applying
 * auth, and writing the response.
 *
 * Optional `onRecord` lets a caller persist the wrapped record (e.g. hand it to
 * the hub's `appendEvent`); the stub itself stays storage-agnostic.
 */
export async function handleFlowIngest(
  body: unknown,
  onRecord?: (record: ConsoleEventRecord) => void | Promise<void>,
): Promise<FlowIngestResult> {
  const validation = validateFlowIngestRequest(body);
  if (!validation.ok) {
    return { status: 400, body: { error: validation.error } };
  }
  const record = wrapFlowIngestRecord(validation.request);
  if (onRecord) {
    await onRecord(record);
  }
  return { status: 202, body: { recordId: record.id } };
}

// TODO(console-infra): mount this stub on the production HTTP server.
//   1. Add `POST /ingest/flow` to console-hub-server's router (next to
//      `POST /records`), reading the JSON body via the existing `readJsonBody`.
//   2. Add REAL auth middleware: require `Authorization: Bearer <per-product
//      token>` and reject (401) when absent/invalid. The token is per-product
//      and env-configured (the Flow side disables its HostedConsoleSink when no
//      token is set, so an authenticated request is always expected here).
//   3. Wire `onRecord` to the hub (`hub.appendEvent(record)`) and broadcast
//      `record.accepted` over the SSE stream, mirroring `handleRecords`.
//   4. Honor idempotency: dedup re-POSTs on `idempotencyKey` (the wrapped record
//      id is derived from it; hub projections already dedup by id).

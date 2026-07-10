import type {
  ConsoleRecord,
  ConsoleSqlClient,
  DeliveryResult
} from "./types";
import { isLivenessRecord, livenessOrderTuple } from "./liveness";

export type CoreRecordsLoadResult =
  | { ok: true; records: ConsoleRecord[] }
  | { ok: false; records: []; error: unknown };

/**
 * Repository for persisting and replaying core (console event / projection)
 * records in Postgres.
 *
 * Used exclusively in hosted mode. Local mode continues to use LocalFileSink
 * via LocalConsoleHub — no changes there.
 *
 * Design notes:
 *   - Primary key (tenant_id, record_id) makes duplicate POSTs idempotent.
 *     Same-schema non-liveness conflicts replace unconditionally. Cross-schema
 *     collisions never replace the existing row. Same-schema liveness
 *     conflicts use the ordering watermark to admit only strictly newer events.
 *   - `sequence` is a bigserial with stable ascending order for replay.
 *   - `payload` stores the full record as jsonb.
 *   - `type` stores the record type field (for events) or empty string
 *     (for projections) to support future filtering.
 *   - Errors on insert or select are caught and returned as failed delivery
 *     results so callers can surface them without crashing.
 */
export class CoreRecordsRepository {
  constructor(private readonly sqlClient: ConsoleSqlClient) {}

  /**
   * Persist an accepted console record for a given tenant.
   *
   * Returns a DeliveryResult with outcome "accepted" on success, "failed" on
   * any SQL error.
   */
  async persist(
    record: ConsoleRecord,
    tenantId: string,
    observedAt: string
  ): Promise<DeliveryResult> {
    const recordId = resolveRecordId(record);
    const schema = typeof record.schema === "string" ? record.schema : "";
    const type = typeof (record as any).type === "string" ? (record as any).type : "";
    const occurredAt = typeof (record as any).occurredAt === "string" ? (record as any).occurredAt : null;
    const livenessOrder = isLivenessRecord(record) ? livenessOrderTuple(record.at, record.type) : undefined;
    const livenessOrderMs = livenessOrder?.atMs ?? null;
    const livenessOrderRank = livenessOrder?.rank ?? null;

    try {
      const result = await this.sqlClient.query(
        `insert into console_core_records
           (tenant_id, record_id, schema, type, occurred_at, observed_at, payload, liveness_order_ms, liveness_order_rank)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (tenant_id, record_id) do update set
           schema = excluded.schema,
           type = excluded.type,
           occurred_at = excluded.occurred_at,
           observed_at = excluded.observed_at,
           payload = excluded.payload,
           liveness_order_ms = excluded.liveness_order_ms,
           liveness_order_rank = excluded.liveness_order_rank
         where console_core_records.schema = excluded.schema
           and (excluded.schema <> 'kontour.console.liveness'
                or (excluded.liveness_order_ms is not null
                    and (console_core_records.liveness_order_ms is null
                         or excluded.liveness_order_ms > console_core_records.liveness_order_ms
                         or (excluded.liveness_order_ms = console_core_records.liveness_order_ms
                             and excluded.liveness_order_rank > coalesce(console_core_records.liveness_order_rank, 0)))))
         returning record_id`,
        [tenantId, recordId, schema, type, occurredAt, observedAt, record, livenessOrderMs, livenessOrderRank]
      );
      const advanced = typeof result.rowCount === "number"
        ? result.rowCount > 0
        : result.rows.length > 0;
      return {
        sinkId: "postgres-core-records",
        sinkRole: "CoreRecordsStore",
        outcome: "accepted",
        status: advanced ? "persisted" : (isLivenessRecord(record) ? "stale_liveness_ignored" : "record_id_collision_ignored"),
        recordId,
        recordKind: resolveRecordKind(record),
        observedAt
      };
    } catch {
      return {
        sinkId: "postgres-core-records",
        sinkRole: "CoreRecordsStore",
        outcome: "failed",
        status: "persistence_failed",
        recordId,
        recordKind: resolveRecordKind(record),
        observedAt,
        retryable: true,
        errorCode: "CORE_RECORD_PERSISTENCE_FAILED",
        safeMessage: "core record could not be persisted to postgres"
      };
    }
  }

  /**
   * Load all core records for a tenant, ordered by sequence ascending.
   *
   * Preserves the distinction between an empty tenant and a failed load.
   */
  async loadRecords(tenantId: string): Promise<CoreRecordsLoadResult> {
    try {
      const result = await this.sqlClient.query<{ payload: ConsoleRecord }>(
        `select payload from console_core_records
         where tenant_id = $1
         order by sequence asc`,
        [tenantId]
      );
      return { ok: true, records: result.rows
        .map((row) => row.payload)
        .filter((payload): payload is ConsoleRecord => isRecord(payload)) };
    } catch (error) {
      return { ok: false, records: [], error };
    }
  }
}

function resolveRecordId(record: ConsoleRecord): string {
  if (typeof (record as any).id === "string" && (record as any).id) return (record as any).id;
  return "";
}

function resolveRecordKind(record: ConsoleRecord): "event" | "projection" {
  return record.schema === "kontour.console.projection" ? "projection" : "event";
}

function isRecord(value: unknown): value is ConsoleRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

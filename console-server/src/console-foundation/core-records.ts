import type {
  ConsoleRecord,
  ConsoleSqlClient,
  DeliveryResult
} from "./types";

/**
 * Repository for persisting and replaying core (console event / projection)
 * records in Postgres.
 *
 * Used exclusively in hosted mode. Local mode continues to use LocalFileSink
 * via LocalConsoleHub — no changes there.
 *
 * Design notes:
 *   - Primary key (tenant_id, record_id) makes duplicate POSTs idempotent.
 *     The on-conflict clause silently replaces, preserving the original
 *     sequence value and returning the same accepted outcome — matching the
 *     existing dedup semantics of the JSONL sink.
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

    try {
      await this.sqlClient.query(
        `insert into console_core_records
           (tenant_id, record_id, schema, type, occurred_at, observed_at, payload)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (tenant_id, record_id) do update set
           schema = excluded.schema,
           type = excluded.type,
           occurred_at = excluded.occurred_at,
           observed_at = excluded.observed_at,
           payload = excluded.payload`,
        [tenantId, recordId, schema, type, occurredAt, observedAt, record]
      );
      return {
        sinkId: "postgres-core-records",
        sinkRole: "CoreRecordsStore",
        outcome: "accepted",
        status: "persisted",
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
   * Returns an empty array on any SQL error (safe degradation for reads).
   */
  async loadRecords(tenantId: string): Promise<ConsoleRecord[]> {
    try {
      const result = await this.sqlClient.query<{ payload: ConsoleRecord }>(
        `select payload from console_core_records
         where tenant_id = $1
         order by sequence asc`,
        [tenantId]
      );
      return result.rows
        .map((row) => row.payload)
        .filter((payload): payload is ConsoleRecord => isRecord(payload));
    } catch {
      return [];
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

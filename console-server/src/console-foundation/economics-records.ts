// Durable per-tenant economics record store (console #155).
//
// Hosted mode persists every accepted `kontour.console.economics` record to
// Postgres so the Economics read-models survive redeploys, mirroring
// CoreRecordsRepository (#149). Local mode never constructs this class — the
// in-memory v1 store keeps its exact behaviour.
//
// Design notes:
//   - Primary key (tenant_id, record_id) with ON CONFLICT DO NOTHING: economics
//     records are immutable facts of a run, so a duplicate POST (e.g. a
//     re-relay) is a NO-OP — never an overwrite, never a double-count.
//   - record_id is the record's `run_id` (a stable per-run id, required by
//     ingest validation). When it is absent/empty the id is synthesized as a
//     deterministic hash of the payload so a malformed record can neither
//     collide with a real run nor throw. A caller-supplied `id` is never
//     trusted over `run_id`.
//   - `sequence` is a bigserial with stable ascending order for replay.
//   - loadRecords preserves the #149 fail-closed distinction between an empty
//     tenant ({ ok: true, records: [] }) and a failed load ({ ok: false, ... }).

const crypto = require("node:crypto");
import type {
  ConsoleEconomicsRecord,
  ConsoleSqlClient,
  DeliveryResult
} from "./types";

export type EconomicsRecordsLoadResult =
  | { ok: true; records: ConsoleEconomicsRecord[] }
  | { ok: false; records: []; error: unknown };

export class EconomicsRecordsRepository {
  constructor(private readonly sqlClient: ConsoleSqlClient) {}

  /**
   * Persist an accepted economics record for a given tenant.
   *
   * Returns a DeliveryResult with outcome "accepted" and status "persisted"
   * (newly stored) or "duplicate_ignored" (same (tenant_id, record_id) already
   * present — the existing row is untouched). Any SQL error returns outcome
   * "failed" with errorCode ECONOMICS_RECORD_PERSISTENCE_FAILED.
   */
  async persist(
    tenantId: string,
    record: ConsoleEconomicsRecord,
    observedAt: string
  ): Promise<DeliveryResult> {
    const recordId = resolveEconomicsRecordId(record);
    try {
      const result = await this.sqlClient.query(
        `insert into console_economics_records
           (tenant_id, record_id, observed_at, payload)
         values ($1, $2, $3, $4)
         on conflict (tenant_id, record_id) do nothing
         returning record_id`,
        [tenantId, recordId, observedAt, record]
      );
      const inserted = typeof result.rowCount === "number"
        ? result.rowCount > 0
        : result.rows.length > 0;
      return {
        sinkId: "postgres-economics-records",
        sinkRole: "EconomicsRecordsStore",
        outcome: "accepted",
        status: inserted ? "persisted" : "duplicate_ignored",
        recordId,
        recordKind: "economics",
        observedAt
      };
    } catch {
      return {
        sinkId: "postgres-economics-records",
        sinkRole: "EconomicsRecordsStore",
        outcome: "failed",
        status: "persistence_failed",
        recordId,
        recordKind: "economics",
        observedAt,
        retryable: true,
        errorCode: "ECONOMICS_RECORD_PERSISTENCE_FAILED",
        safeMessage: "economics record could not be persisted to postgres"
      };
    }
  }

  /**
   * Load all economics records for a tenant, ordered by sequence ascending.
   *
   * Preserves the distinction between an empty tenant and a failed load.
   */
  async loadRecords(tenantId: string): Promise<EconomicsRecordsLoadResult> {
    try {
      const result = await this.sqlClient.query<{ payload: ConsoleEconomicsRecord }>(
        `select payload from console_economics_records
         where tenant_id = $1
         order by sequence asc`,
        [tenantId]
      );
      return {
        ok: true,
        records: result.rows
          .map((row) => row.payload)
          .filter((payload): payload is ConsoleEconomicsRecord => isRecord(payload))
      };
    } catch (error) {
      return { ok: false, records: [], error };
    }
  }
}

/**
 * The durable identity of an economics record: its `run_id` when present, else
 * a deterministic hash of the payload (`sha256:<hex>` — a namespace no real
 * run_id can collide with accidentally, and the same payload always maps to
 * the same id so a duplicate POST still dedups).
 */
export function resolveEconomicsRecordId(record: ConsoleEconomicsRecord): string {
  if (typeof record.run_id === "string" && record.run_id) return record.run_id;
  return `sha256:${crypto.createHash("sha256").update(stableStringify(record)).digest("hex")}`;
}

/** JSON.stringify with object keys sorted at every depth — a stable hash input. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function isRecord(value: unknown): value is ConsoleEconomicsRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

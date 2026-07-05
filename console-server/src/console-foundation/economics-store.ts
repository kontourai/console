// Per-tenant economics append store (console #117, ADR 0003 calls 1 + 3).
//
// Economics is a first-class KIND on the one `/records` ingress, routed to the
// TELEMETRY plane (operational) — NOT `hub.append` (the control plane). The
// immutable, tenant-stamped record stream is the source of truth; the rollups
// and value comparison are REBUILDABLE projections over it (call 3). This v1 is
// an in-memory append log mirroring `LocalJsonlTelemetryRepository.accepted[]`;
// per-tenant persistence (JSONL / SQLite / Postgres adapters, like telemetry.ts)
// is a documented follow-up. Isolation is by construction: each tenant gets its
// own store instance, keyed by the authoritative `context.tenantId` (call 2).

import type { ConsoleEconomicsRecord } from "./types";

/** Bounds the in-memory log so a long-lived server does not grow unbounded. */
const MAX_ECONOMICS_RECORDS = 50000;

export interface EconomicsStore {
  /** Append a tenant-stamped economics record (already validated + stamped upstream). */
  append(record: ConsoleEconomicsRecord): void;
  /** All records for this tenant, in append order. */
  all(): ConsoleEconomicsRecord[];
  count(): number;
}

export function createEconomicsStore(): EconomicsStore {
  const accepted: ConsoleEconomicsRecord[] = [];
  return {
    append(record: ConsoleEconomicsRecord): void {
      accepted.push(record);
      if (accepted.length > MAX_ECONOMICS_RECORDS) {
        accepted.splice(0, accepted.length - MAX_ECONOMICS_RECORDS);
      }
    },
    all(): ConsoleEconomicsRecord[] {
      return accepted.slice();
    },
    count(): number {
      return accepted.length;
    }
  };
}

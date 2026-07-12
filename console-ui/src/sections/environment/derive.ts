/**
 * Pure derivation functions for the Environment dashboard.
 * No React, no side effects — these are unit-testable read-model projections
 * over OperatingState and ConsoleTelemetryResponse.
 */

import type { ConsoleClaim, ConsoleGate, ConsoleProcess, OperatingState } from "@kontourai/console-core";
import type { ConsoleTelemetryResponse, ConsoleTelemetrySourceSummary } from "../../serverApiTypes";

// ── Health band ──────────────────────────────────────────────────────────────

export interface HealthCounts {
  activeProcesses: number;
  gatesPassed: number;
  gatesBlocked: number;
  claimsOk: number;
  claimsAtRisk: number;
  claimsStale: number;
  openInquiries: number;
}

const STALE_CLAIM_STATUSES = new Set(["stale", "expired", "at-risk", "unverified"]);
const OK_CLAIM_STATUSES = new Set(["ok", "verified", "confirmed", "current", "fresh"]);
const BLOCKED_GATE_STATUSES = new Set(["blocked", "failed", "route-back", "rejected"]);
const PASSED_GATE_STATUSES = new Set(["passed", "approved", "accepted", "complete"]);
const OPEN_INQUIRY_OUTCOMES = new Set(["unsupported", "derived", "matched"]);

export function deriveHealthCounts(input: OperatingState | null | undefined): HealthCounts {
  const state: OperatingState = input ?? ({} as OperatingState);
  const processes = state.processes || [];
  const gates = state.gates || [];
  const claims = state.claims || [];
  const inquiries = state.inquiries || [];

  const activeProcesses = processes.filter((p) => {
    const status = (p.status || "").toLowerCase();
    return status !== "complete" && status !== "done" && status !== "closed" && status !== "cancelled";
  }).length;

  const gatesPassed = gates.filter((g) => PASSED_GATE_STATUSES.has((g.status || "").toLowerCase())).length;
  const gatesBlocked = gates.filter((g) => BLOCKED_GATE_STATUSES.has((g.status || "").toLowerCase())).length;

  const claimsStale = claims.filter((c) => {
    const freshnessStatus = (c.freshness?.status || "").toLowerCase();
    const claimStatus = (c.status || "").toLowerCase();
    return STALE_CLAIM_STATUSES.has(freshnessStatus) || STALE_CLAIM_STATUSES.has(claimStatus);
  }).length;

  const claimsOk = claims.filter((c) => {
    const freshnessStatus = (c.freshness?.status || "").toLowerCase();
    const claimStatus = (c.status || "").toLowerCase();
    return OK_CLAIM_STATUSES.has(freshnessStatus) || OK_CLAIM_STATUSES.has(claimStatus);
  }).length;

  const claimsAtRisk = claims.length - claimsOk - claimsStale;

  const openInquiries = inquiries.filter((i) => {
    const outcome = (i.outcome || "").toLowerCase();
    return !i.resolvedAt && OPEN_INQUIRY_OUTCOMES.has(outcome);
  }).length;

  return {
    activeProcesses,
    gatesPassed,
    gatesBlocked,
    claimsOk,
    claimsAtRisk: Math.max(0, claimsAtRisk),
    claimsStale,
    openInquiries,
  };
}

// ── Needs-attention items ────────────────────────────────────────────────────

export type AttentionKind =
  | "blocked-gate"
  | "stale-claim"
  | "long-running-process"
  | "quiet-source";

export interface AttentionItem {
  kind: AttentionKind;
  id: string;
  label: string;
  detail: string;
}

/** Processes running beyond this many ms are flagged as long-running. */
export const LONG_RUNNING_PROCESS_MS = 30 * 60 * 1000; // 30 minutes

/** Sources not updated within this many ms are flagged as gone quiet. */
export const QUIET_SOURCE_MS = 60 * 60 * 1000; // 60 minutes

export function deriveAttentionItems(
  input: OperatingState | null | undefined,
  telemetry: ConsoleTelemetryResponse | null,
  now = Date.now(),
): AttentionItem[] {
  const state: OperatingState = input ?? ({} as OperatingState);
  const items: AttentionItem[] = [];

  // Blocked gates
  for (const gate of state.gates || []) {
    if (BLOCKED_GATE_STATUSES.has((gate.status || "").toLowerCase())) {
      items.push({
        kind: "blocked-gate",
        id: gate.id,
        label: gate.label || gate.id,
        detail: blockedGateDetail(gate),
      });
    }
  }

  // Stale claims
  for (const claim of state.claims || []) {
    const freshnessStatus = (claim.freshness?.status || "").toLowerCase();
    const claimStatus = (claim.status || "").toLowerCase();
    if (STALE_CLAIM_STATUSES.has(freshnessStatus) || STALE_CLAIM_STATUSES.has(claimStatus)) {
      items.push({
        kind: "stale-claim",
        id: claim.id,
        label: claim.label || claim.id,
        detail: staleClaimDetail(claim),
      });
    }
  }

  // Long-running processes
  for (const process of state.processes || []) {
    const status = (process.status || "").toLowerCase();
    if (status === "complete" || status === "done" || status === "closed" || status === "cancelled") continue;
    if (process.updatedAt) {
      const age = now - new Date(process.updatedAt).getTime();
      if (!Number.isNaN(age) && age > LONG_RUNNING_PROCESS_MS) {
        items.push({
          kind: "long-running-process",
          id: process.id,
          label: process.label || process.id,
          detail: `last update ${formatAge(age)} ago`,
        });
      }
    }
  }

  // Quiet telemetry sources (no recent data)
  for (const source of telemetry?.sources || []) {
    if (isSourceQuiet(source, now)) {
      items.push({
        kind: "quiet-source",
        id: source.id,
        label: source.id,
        detail: quietSourceDetail(source, now),
      });
    }
  }

  return items;
}

function blockedGateDetail(gate: ConsoleGate): string {
  if (gate.routeBack?.reason) return gate.routeBack.reason;
  if (gate.missingEvidence?.length) return `missing evidence: ${gate.missingEvidence.slice(0, 2).join(", ")}`;
  return gate.processRef?.label || gate.processRef?.id || `status: ${gate.status || "blocked"}`;
}

function staleClaimDetail(claim: ConsoleClaim): string {
  const freshnessStatus = claim.freshness?.status;
  if (claim.freshness?.expiresAt) {
    const expired = new Date(claim.freshness.expiresAt).getTime();
    if (!Number.isNaN(expired)) {
      return `expired ${formatAge(Date.now() - expired)} ago`;
    }
  }
  if (claim.lastVerifiedAt) return `last verified ${formatAge(Date.now() - new Date(claim.lastVerifiedAt).getTime())} ago`;
  return freshnessStatus ? `freshness: ${freshnessStatus}` : "no freshness data";
}

function quietSourceDetail(source: ConsoleTelemetrySourceSummary, now: number): string {
  if (source.lastObservedAt) {
    const age = now - new Date(source.lastObservedAt).getTime();
    if (!Number.isNaN(age)) return `last seen ${formatAge(age)} ago`;
  }
  return `${source.recordCount} records, no recent update timestamp`;
}

export function isSourceQuiet(source: ConsoleTelemetrySourceSummary, now = Date.now()): boolean {
  if (!source.lastObservedAt) return false;
  const age = now - new Date(source.lastObservedAt).getTime();
  return !Number.isNaN(age) && age > QUIET_SOURCE_MS;
}

export function formatAge(ms: number): string {
  if (ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ── Activity sparkline ───────────────────────────────────────────────────────

export interface ActivityBucket {
  /** ISO label for the bucket start. */
  label: string;
  count: number;
}

/**
 * Builds a series of fixed-width time buckets over the last `windowMs`,
 * binning records by their `observedAt` timestamp.
 *
 * Degrades gracefully: if no records have timestamps the buckets come back
 * with count=0 rather than crashing.
 */
export function deriveActivityBuckets(
  records: ConsoleTelemetryResponse["records"],
  bucketCount = 12,
  windowMs = 60 * 60 * 1000, // 1 hour
  now = Date.now(),
): ActivityBucket[] {
  const bucketMs = windowMs / bucketCount;
  const windowStart = now - windowMs;

  const buckets: ActivityBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    label: new Date(windowStart + i * bucketMs).toISOString(),
    count: 0,
  }));

  for (const record of records) {
    if (!record.observedAt) continue;
    const ts = new Date(record.observedAt).getTime();
    if (Number.isNaN(ts) || ts < windowStart || ts > now) continue;
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((ts - windowStart) / bucketMs),
    );
    buckets[bucketIndex].count++;
  }

  return buckets;
}

// ── Top workloads ────────────────────────────────────────────────────────────

export interface WorkloadEntry {
  name: string;
  count: number;
}

export interface TopWorkloads {
  projects: WorkloadEntry[];
  tools: WorkloadEntry[];
  agents: WorkloadEntry[];
}

/**
 * Derives top workloads from facet summaries (preferred) or by counting
 * fields in the recent records (fallback).
 */
export function deriveTopWorkloads(
  telemetry: ConsoleTelemetryResponse | null,
  limit = 5,
): TopWorkloads {
  if (!telemetry) return { projects: [], tools: [], agents: [] };

  return {
    projects: topFromFacetOrRecords(telemetry, "projects", "project", limit),
    tools: topFromFacetOrRecords(telemetry, "tools", "toolName", limit),
    agents: topFromFacetOrRecords(telemetry, "agents", "agentName", limit),
  };
}

function topFromFacetOrRecords(
  telemetry: ConsoleTelemetryResponse,
  facetId: string,
  recordField: keyof ConsoleTelemetryResponse["records"][number],
  limit: number,
): WorkloadEntry[] {
  const facet = telemetry.analytics.facets.find((f) => f.id === facetId);
  if (facet && facet.counts.length) {
    return facet.counts
      .slice(0, limit)
      .map(({ name, count }) => ({ name, count }));
  }

  // Fallback: count the field from recent records
  const counts: Record<string, number> = {};
  for (const record of telemetry.records) {
    const value = record[recordField];
    if (typeof value === "string" && value) {
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

// ── Process staleness helpers ────────────────────────────────────────────────

export function deriveProcessList(input: OperatingState | null | undefined): ConsoleProcess[] {
  const state: OperatingState = input ?? ({} as OperatingState);
  return (state.processes || []).filter((p) => {
    const status = (p.status || "").toLowerCase();
    return status !== "complete" && status !== "done" && status !== "closed" && status !== "cancelled";
  });
}

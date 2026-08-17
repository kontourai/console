import type { OperatingState } from "@kontourai/console-core";

/**
 * Structural narrowing of the opaque Surface trust report (console#254 folds
 * `@kontourai/surface`'s `buildTrustReport` output VERBATIM onto
 * `ConsoleProcess.trustReport` / `ConsoleGate.trustReport`; console-core types
 * it `unknown` so the UI boundary owns the narrowing — see the rationale on
 * those fields in console-core/src/operating-state.ts).
 *
 * RELAY ONLY (product-boundaries.md, the console#255 verbatim-relay pattern):
 * these readers surface producer-side fields exactly as written — gap
 * `message` text, evidence `excerptOrSummary`, verification event `status` —
 * and never recompute, reword, or summarize them. A field that is absent
 * stays absent; callers render that absence explicitly rather than receiving
 * a synthesized value from here.
 */

export interface TrustReportEvidenceRecord {
  id: string;
  claimId?: string;
  /** Raw Surface `EvidenceType` enum — display text stays the raw enum until kontourai/surface#224's display-name table ships; no synonyms minted here. */
  evidenceType?: string;
  /** Raw Surface `EvidenceMethod` enum — same surface#224 rule as `evidenceType`. */
  method?: string;
  sourceRef?: string;
  sourceLocator?: string;
  excerptOrSummary?: string;
  observedAt?: string;
  collectedBy?: string;
}

export interface TrustReportVerificationEvent {
  id: string;
  claimId?: string;
  status?: string;
  method?: string;
  evidenceIds?: string[];
  verifiedAt?: string;
  createdAt?: string;
}

export interface TrustReportGap {
  id?: string;
  claimId?: string;
  type?: string;
  severity?: string;
  /** Producer-authored gap text, verbatim. */
  message?: string;
  createdAt?: string;
  blocking?: boolean;
  evidenceIds?: string[];
}

export interface TrustReportLike {
  id?: string;
  generatedAt?: string;
  evidence: TrustReportEvidenceRecord[];
  events: TrustReportVerificationEvent[];
  transparencyGaps: TrustReportGap[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function narrowEvidence(value: unknown): TrustReportEvidenceRecord[] {
  if (!Array.isArray(value)) return [];
  const records: TrustReportEvidenceRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = optionalString(item.id);
    if (!id) continue;
    records.push({
      id,
      claimId: optionalString(item.claimId),
      evidenceType: optionalString(item.evidenceType),
      method: optionalString(item.method),
      sourceRef: optionalString(item.sourceRef),
      sourceLocator: optionalString(item.sourceLocator),
      excerptOrSummary: optionalString(item.excerptOrSummary),
      observedAt: optionalString(item.observedAt),
      collectedBy: optionalString(item.collectedBy),
    });
  }
  return records;
}

function narrowEvents(value: unknown): TrustReportVerificationEvent[] {
  if (!Array.isArray(value)) return [];
  const events: TrustReportVerificationEvent[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = optionalString(item.id);
    if (!id) continue;
    events.push({
      id,
      claimId: optionalString(item.claimId),
      status: optionalString(item.status),
      method: optionalString(item.method),
      evidenceIds: stringArray(item.evidenceIds),
      verifiedAt: optionalString(item.verifiedAt),
      createdAt: optionalString(item.createdAt),
    });
  }
  return events;
}

function narrowGaps(value: unknown): TrustReportGap[] {
  if (!Array.isArray(value)) return [];
  const gaps: TrustReportGap[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    gaps.push({
      id: optionalString(item.id),
      claimId: optionalString(item.claimId),
      type: optionalString(item.type),
      severity: optionalString(item.severity),
      message: optionalString(item.message),
      createdAt: optionalString(item.createdAt),
      blocking: typeof item.blocking === "boolean" ? item.blocking : undefined,
      evidenceIds: stringArray(item.evidenceIds),
    });
  }
  return gaps;
}

/** Narrows one opaque `trustReport` value, or null when it is not report-shaped. */
export function narrowTrustReport(raw: unknown): TrustReportLike | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.claims) && !Array.isArray(raw.evidence) && !Array.isArray(raw.transparencyGaps)) return null;
  return {
    id: optionalString(raw.id),
    generatedAt: optionalString(raw.generatedAt),
    evidence: narrowEvidence(raw.evidence),
    events: narrowEvents(raw.events),
    transparencyGaps: narrowGaps(raw.transparencyGaps),
  };
}

function narrowAndDedupe(raws: unknown[]): TrustReportLike[] {
  const reports: TrustReportLike[] = [];
  const seenIds = new Set<string>();
  const seenRaw = new Set<unknown>();
  for (const raw of raws) {
    if (raw === undefined || raw === null) continue;
    if (seenRaw.has(raw)) continue;
    seenRaw.add(raw);
    const report = narrowTrustReport(raw);
    if (!report) continue;
    if (report.id) {
      if (seenIds.has(report.id)) continue;
      seenIds.add(report.id);
    }
    reports.push(report);
  }
  return reports;
}

/**
 * Every distinct trust report attached anywhere in the operating state.
 * console#254 attaches the SAME report to a process AND to each of its gate
 * associations, so reports are deduped by `id` (falling back to reference
 * identity of the raw value for id-less reports) — never double-counting one
 * workflow's gaps because its report was relayed onto three gates.
 */
export function collectTrustReports(state: OperatingState | null | undefined): TrustReportLike[] {
  return narrowAndDedupe([
    ...((state?.processes || []).map((process) => process.trustReport)),
    ...((state?.gates || []).map((gate) => gate.trustReport)),
  ]);
}

/**
 * Owning workflow scope of a bridge-qualified subject id
 * (`<workflow>:<marker>:<rawId>`, workflow-trust-bridge.ts), or `null` for an
 * unqualified id from a producer with a flat id space.
 */
export function workflowScopeOf(qualifiedId: string, marker: string): string | null {
  const at = qualifiedId.lastIndexOf(marker);
  return at > 0 ? qualifiedId.slice(0, at) : null;
}

/**
 * The trust reports OWNED by one workflow scope (console#274 review MED
 * finding 2): raw report ids (`ev-1`, `claim-tests`, ...) are BUNDLE-LOCAL,
 * so joining them against every folded report first-match-wins lets two
 * workflows collide and relays the WRONG workflow's producer text. The
 * console#254 bridge attaches each report to the process whose id IS the
 * workflow scope and to gates qualified `<scope>:gate:<raw>`, so a scoped
 * subject joins only its own workflow's report(s). An unqualified subject
 * (`scope === null`) keeps the every-report fallback — a flat id space has
 * nothing to collide with across scopes.
 */
export function collectTrustReportsForScope(
  state: OperatingState | null | undefined,
  scope: string | null,
): TrustReportLike[] {
  if (scope === null) return collectTrustReports(state);
  return narrowAndDedupe([
    ...((state?.processes || []).filter((process) => process.id === scope).map((process) => process.trustReport)),
    ...((state?.gates || []).filter((gate) => gate.id.startsWith(`${scope}:gate:`)).map((gate) => gate.trustReport)),
  ]);
}

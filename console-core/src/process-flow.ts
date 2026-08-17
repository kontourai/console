import type { ConsoleAction, ConsoleClaim, ConsoleEvidence, ConsoleGate, ConsoleProcess, ConsoleRef, OperatingState, TimelineItem } from "./operating-state";
import { formatStep, selectActiveProcess } from "./process-utils";

export type FlowNodeKind = "stage" | "process" | "step" | "gate" | "claim" | "evidence" | "action" | "timeline";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  meta: string;
  status: string;
  lane: number;
  order: number;
  active: boolean;
  /**
   * Raw producer-side provenance enum for an evidence node — Surface's own
   * `evidenceType` (falling back to `method`) relayed VERBATIM from the trust
   * report the workflow-trust bridge folded onto the owning gate/process
   * (console#254, console#274). Display text stays the raw enum for now:
   * the shared display-name table is being built in kontourai/surface#224 and
   * renderers must not mint display synonyms here in the meantime.
   */
  provenanceKind?: string;
  /**
   * A dead node (console#274): a gate/claim clause that names or implies
   * evidence which does NOT exist in the operating state. Rendered first-class
   * (dashed) rather than omitted — a blind spot is part of the graph, not an
   * absence to hide.
   */
  dead?: boolean;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  active: boolean;
}

export interface ProcessFlow {
  nodes: FlowNode[];
  edges: FlowEdge[];
  activeProcess: ConsoleProcess | null;
}

const ACTIVE_STATUSES = new Set(["running", "waiting", "open", "in-progress", "in_progress"]);

function nodeStatus(status?: string) {
  return (status || "unknown").toLowerCase().replace(/\s+/g, "-");
}

function isActiveStatus(status?: string) {
  return ACTIVE_STATUSES.has(nodeStatus(status));
}

function processLabel(process: ConsoleProcess) {
  return process.label || process.id;
}

function gateMeta(gate: ConsoleGate) {
  return gate.routeBack?.reason || gate.missingEvidence?.slice(0, 2).join(", ") || gate.processRef?.label || gate.processRef?.id || "gate";
}

function claimMeta(claim: ConsoleClaim) {
  return `freshness: ${claim.freshness?.status || "n/a"}`;
}

function actionMeta(action: ConsoleAction) {
  return `${action.authority?.product || "local"} ${action.authority?.command || action.kind || "action"}`;
}

function timelineMeta(item: TimelineItem) {
  return item.summary || item.subjectRef?.label || item.subjectRef?.id || item.id;
}

function refMatches(ref: ConsoleRef | undefined, kind: string, id: string) {
  return ref?.kind === kind && ref.id === id;
}

// ── Evidence provenance (console#274) ────────────────────────────────────────

interface EvidenceProvenance {
  evidenceType?: string;
  method?: string;
}

/**
 * The workflow-trust bridge qualifies subject ids as
 * `<workflow>:<marker>:<rawId>` (workflow-trust-bridge.ts's
 * `qualifiedEvidenceId`/`qualifiedClaimId`); the trust report's own records
 * carry the raw, BUNDLE-LOCAL id. This splits a qualified id into its owning
 * workflow scope and the raw id; a non-bridge producer's unqualified id has
 * no scope (`null`) and passes through as the raw id.
 */
function splitQualifiedId(id: string, marker: string): { scope: string | null; raw: string } {
  const at = id.lastIndexOf(marker);
  return at > 0 ? { scope: id.slice(0, at), raw: id.slice(at + marker.length) } : { scope: null, raw: id };
}

interface ReportEvidenceEntry {
  id: string;
  claimId?: string;
  evidenceType?: string;
  method?: string;
}

/**
 * Structurally narrows one opaque `trustReport`'s evidence array (Surface's
 * own `buildTrustReport` output, folded verbatim by console#254) — RELAY, not
 * derivation: no verdict, status, or freshness is read or recomputed here,
 * and console-core still takes no dependency on `@kontourai/surface` (same
 * opaque-typing rationale as `ConsoleProcess.trustReport`).
 */
function reportEvidenceEntries(report: unknown): ReportEvidenceEntry[] {
  if (!report || typeof report !== "object") return [];
  const evidence = (report as { evidence?: unknown }).evidence;
  if (!Array.isArray(evidence)) return [];
  const entries: ReportEvidenceEntry[] = [];
  for (const item of evidence) {
    if (!item || typeof item !== "object") continue;
    const record = item as { id?: unknown; claimId?: unknown; evidenceType?: unknown; method?: unknown };
    if (typeof record.id !== "string" || !record.id) continue;
    entries.push({
      id: record.id,
      claimId: typeof record.claimId === "string" ? record.claimId : undefined,
      evidenceType: typeof record.evidenceType === "string" ? record.evidenceType : undefined,
      method: typeof record.method === "string" ? record.method : undefined,
    });
  }
  return entries;
}

/**
 * The trust reports OWNED by one workflow scope (console#274 review MED
 * finding 2): raw report ids are bundle-local, so a global first-report-wins
 * join lets two folded workflows collide and relays the WRONG workflow's
 * producer fields. The bridge attaches each report to the process whose id
 * IS the workflow scope and to gates qualified `<scope>:gate:<raw>` — so a
 * scoped subject only ever joins its own workflow's report(s). An
 * unqualified subject (`scope === null`, a non-bridge producer's flat id
 * space) keeps the every-report fallback.
 */
function trustReportsOwning(state: OperatingState, scope: string | null): unknown[] {
  const raws: unknown[] =
    scope === null
      ? [
          ...(state.processes || []).map((process) => process.trustReport),
          ...(state.gates || []).map((gate) => gate.trustReport),
        ]
      : [
          ...(state.processes || []).filter((process) => process.id === scope).map((process) => process.trustReport),
          ...(state.gates || []).filter((gate) => gate.id.startsWith(`${scope}:gate:`)).map((gate) => gate.trustReport),
        ];
  const seen = new Set<unknown>();
  const reports: unknown[] = [];
  for (const raw of raws) {
    if (raw === undefined || raw === null || seen.has(raw)) continue;
    seen.add(raw);
    reports.push(raw);
  }
  return reports;
}

/** Provenance enums for one folded evidence id, joined ONLY against the owning workflow's own trust report(s). */
function provenanceForEvidence(state: OperatingState, foldedEvidenceId: string): EvidenceProvenance | undefined {
  const { scope, raw } = splitQualifiedId(foldedEvidenceId, ":evidence:");
  for (const report of trustReportsOwning(state, scope)) {
    const entry = reportEvidenceEntries(report).find((item) => item.id === raw);
    if (entry && (entry.evidenceType || entry.method)) {
      return { evidenceType: entry.evidenceType, method: entry.method };
    }
  }
  return undefined;
}

/**
 * STATE-derived (console#274 review HIGH finding 1): whether any evidence in
 * the operating state backs this claim — the claim's own evidenceRefs, ANY
 * folded evidence record's claimRefs (the FULL list, never the capped render
 * set: deriving absence from a truncated edge list fabricates a false "no
 * evidence recorded" for a claim whose only evidence fell past the cap), or
 * the owning workflow's own trust report carrying an evidence entry for it.
 */
function claimHasEvidenceInState(state: OperatingState, claim: ConsoleClaim): boolean {
  if ((claim.evidenceRefs || []).some((ref) => ref.kind === "evidence" && Boolean(ref.id))) return true;
  if ((state.evidence || []).some((item) => (item.claimRefs || []).some((ref) => ref.kind === "claim" && ref.id === claim.id))) {
    return true;
  }
  const { scope, raw } = splitQualifiedId(claim.id, ":claim:");
  for (const report of trustReportsOwning(state, scope)) {
    if (reportEvidenceEntries(report).some((entry) => entry.claimId === raw)) return true;
  }
  return false;
}

function evidenceMeta(item: ConsoleEvidence, provenance: EvidenceProvenance | undefined) {
  // Display text is the RAW Surface enum (kontourai/surface#224 owns the
  // upcoming display-name table; no display synonyms minted here).
  const enums = [provenance?.evidenceType, provenance?.method].filter(Boolean).join(" · ");
  return enums || item.summary || item.sourceRef?.label || "evidence";
}

function refsInclude(refs: ConsoleRef[] | undefined, kind: string, id: string) {
  return (refs || []).some((ref) => refMatches(ref, kind, id));
}

function addEdge(edges: FlowEdge[], edge: FlowEdge) {
  if (edges.some((item) => item.id === edge.id)) return;
  edges.push(edge);
}

export function buildProcessFlow(input: OperatingState | null | undefined): ProcessFlow {
  // Read-model projection: tolerate a missing/partial operating state (e.g. before the
  // hub stream has delivered flow data) instead of throwing on `state.processes`.
  const state: OperatingState = input ?? ({} as OperatingState);
  const activeProcess = selectActiveProcess(state.processes || []);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const processNodeId = activeProcess ? `process:${activeProcess.id}` : null;
  const stepNodeId = activeProcess ? `step:${activeProcess.id}` : null;
  const processStatus = nodeStatus(activeProcess?.status);
  const processIsActive = isActiveStatus(processStatus);

  nodes.push({
    id: "stage",
    kind: "stage",
    label: state.currentStage || "No stage reported",
    meta: `${state.source?.acceptedEventCount ?? 0} accepted events`,
    status: "current",
    lane: 0,
    order: 0,
    active: false,
  });

  if (activeProcess) {
    nodes.push({
      id: processNodeId as string,
      kind: "process",
      label: processLabel(activeProcess),
      meta: `${activeProcess.percentComplete ?? "n/a"}% complete`,
      status: processStatus,
      lane: 1,
      order: 0,
      active: processIsActive,
    });
    nodes.push({
      id: stepNodeId as string,
      kind: "step",
      label: formatStep(activeProcess.currentStep),
      meta: "current step",
      status: processStatus,
      lane: 2,
      order: 0,
      active: processIsActive,
    });
    addEdge(edges, { id: "stage-process", from: "stage", to: processNodeId as string, active: processIsActive });
    addEdge(edges, { id: "process-step", from: processNodeId as string, to: stepNodeId as string, active: processIsActive });
  }

  // Edges are intentionally conservative: draw only intrinsic stage/process/step
  // flow plus relationships backed by explicit refs in the operating state.
  const nodesByRef = new Map<string, string>([
    ...(activeProcess && processNodeId ? [[`run:${activeProcess.id}`, processNodeId]] as Array<[string, string]> : []),
  ]);

  (state.gates || []).slice(0, 4).forEach((gate, index) => {
    const id = `gate:${gate.id}`;
    const status = nodeStatus(gate.status);
    nodes.push({ id, kind: "gate", label: gate.label || gate.id, meta: gateMeta(gate), status, lane: 3, order: index, active: isActiveStatus(status) });
    nodesByRef.set(`gate:${gate.id}`, id);
    if (activeProcess && processNodeId && refMatches(gate.processRef, "run", activeProcess.id)) {
      addEdge(edges, { id: `${processNodeId}-${id}`, from: processNodeId, to: id, active: isActiveStatus(status) });
    }
  });

  (state.claims || []).slice(0, 4).forEach((claim, index) => {
    const id = `claim:${claim.id}`;
    const status = nodeStatus(claim.status);
    nodes.push({ id, kind: "claim", label: claim.label || claim.id, meta: claimMeta(claim), status, lane: 4, order: index, active: isActiveStatus(status) });
    nodesByRef.set(`claim:${claim.id}`, id);
    if (activeProcess && processNodeId && (
      refsInclude(activeProcess.claimRefs, "claim", claim.id) || refsInclude(claim.processRefs, "run", activeProcess.id)
    )) {
      addEdge(edges, { id: `${processNodeId}-${id}`, from: processNodeId, to: id, active: isActiveStatus(status) || processIsActive });
    }
  });

  // ── Evidence nodes (console#274): the trust projection's evidence records,
  // folded into `state.evidence` by console#254's bridge (`evidence.attached`),
  // rendered as their own lane between the claims they support and the
  // actions/timeline forensics. Provenance kind is relayed verbatim from the
  // trust report's `evidenceType`/`method` enums where the report carries the
  // record; never derived.
  const renderedEvidence = (state.evidence || []).slice(0, 6);
  let evidenceOrder = 0;
  renderedEvidence.forEach((item) => {
    const id = `evidence:${item.id}`;
    const status = nodeStatus(item.status);
    // Scoped join (console#274 review MED finding 2): only the OWNING
    // workflow's report is consulted — raw report ids are bundle-local.
    const provenance = provenanceForEvidence(state, item.id);
    nodes.push({
      id,
      kind: "evidence",
      label: item.label || item.id,
      meta: evidenceMeta(item, provenance),
      status,
      lane: 5,
      order: evidenceOrder++,
      active: false,
      ...(provenance?.evidenceType || provenance?.method
        ? { provenanceKind: provenance.evidenceType || provenance.method }
        : {}),
    });
    nodesByRef.set(`evidence:${item.id}`, id);
  });

  // Gate → evidence edges via the gate's explicit evidenceRefs (folded from
  // the producer's gateAssociations by console#254 — no invented links).
  (state.gates || []).slice(0, 4).forEach((gate) => {
    const from = nodesByRef.get(`gate:${gate.id}`);
    if (!from) return;
    (gate.evidenceRefs || []).forEach((ref) => {
      const to = ref.kind === "evidence" && ref.id ? nodesByRef.get(`evidence:${ref.id}`) : null;
      if (to) addEdge(edges, { id: `${from}-${to}`, from, to, active: isActiveStatus(gate.status) });
    });
  });

  // Claim → evidence edges via explicit refs in either direction: the evidence
  // record's claimRefs (evidence.attached fold) or the claim's evidenceRefs.
  renderedEvidence.forEach((item) => {
    const to = nodesByRef.get(`evidence:${item.id}`);
    if (!to) return;
    (item.claimRefs || []).forEach((ref) => {
      const from = ref.kind === "claim" && ref.id ? nodesByRef.get(`claim:${ref.id}`) : null;
      if (from) addEdge(edges, { id: `${from}-${to}`, from, to, active: false });
    });
  });
  (state.claims || []).slice(0, 4).forEach((claim) => {
    const from = nodesByRef.get(`claim:${claim.id}`);
    if (!from) return;
    (claim.evidenceRefs || []).forEach((ref) => {
      const to = ref.kind === "evidence" && ref.id ? nodesByRef.get(`evidence:${ref.id}`) : null;
      if (to) addEdge(edges, { id: `${from}-${to}`, from, to, active: false });
    });
  });

  // ── Dead nodes (console#274): clauses with NO evidence render first-class,
  // never omitted. Two producer-backed sources:
  // 1. a gate's own `missingEvidence` clause names — evidence the gate says it
  //    still needs (producer text, relayed as the node label);
  // 2. a rendered claim with zero evidence attached — the claim clause is
  //    dangling, and the graph must show belief bottoming out on nothing.
  // Status "missing" is a structural statement of absence (the mandate is to
  // render the absence), not a fabricated producer verdict.
  (state.gates || []).slice(0, 4).forEach((gate) => {
    const from = nodesByRef.get(`gate:${gate.id}`);
    if (!from) return;
    const missing = gate.missingEvidence || [];
    missing.slice(0, 3).forEach((clause) => {
      const id = `evidence:missing:${gate.id}:${clause}`;
      nodes.push({
        id,
        kind: "evidence",
        label: clause,
        meta: "no evidence recorded",
        status: "missing",
        lane: 5,
        order: evidenceOrder++,
        active: false,
        dead: true,
      });
      addEdge(edges, { id: `${from}-${id}`, from, to: id, active: false });
    });
    // console#274 review MED finding 3: a render cap must never SILENTLY drop
    // dead-class content ("never omitted") — clauses past the cap render as a
    // dead truncation indicator carrying the exact dropped count.
    if (missing.length > 3) {
      const id = `evidence:missing-more:${gate.id}`;
      nodes.push({
        id,
        kind: "evidence",
        label: `+${missing.length - 3} more missing`,
        meta: "truncated by the render cap — the gate record carries the full list",
        status: "missing",
        lane: 5,
        order: evidenceOrder++,
        active: false,
        dead: true,
      });
      addEdge(edges, { id: `${from}-${id}`, from, to: id, active: false });
    }
  });
  const renderedClaims = (state.claims || []).slice(0, 4);
  renderedClaims.forEach((claim) => {
    const from = nodesByRef.get(`claim:${claim.id}`);
    if (!from) return;
    // console#274 review HIGH finding 1: absence is derived from the STATE
    // (full evidence list + the owning workflow's own trust report), NEVER
    // from the capped render set's edge list — a claim whose only evidence
    // fell past the evidence-lane cap is evidenced, not dead.
    if (claimHasEvidenceInState(state, claim)) return;
    const id = `evidence:absent:${claim.id}`;
    nodes.push({
      id,
      kind: "evidence",
      label: "No evidence recorded",
      meta: `for ${claim.label || claim.id}`,
      status: "missing",
      lane: 5,
      order: evidenceOrder++,
      active: false,
      dead: true,
    });
    addEdge(edges, { id: `${from}-${id}`, from, to: id, active: false });
  });
  // console#274 review MED finding 3, claims side: evidence-less claims past
  // the claims-lane cap would silently lose their dead nodes — surface them
  // as one dead truncation indicator with the exact count.
  const droppedDeadClaims = (state.claims || []).slice(4).filter((claim) => !claimHasEvidenceInState(state, claim)).length;
  if (droppedDeadClaims > 0) {
    nodes.push({
      id: "evidence:absent-more",
      kind: "evidence",
      label: `+${droppedDeadClaims} more missing`,
      meta: "claims beyond the render cap with no evidence recorded",
      status: "missing",
      lane: 5,
      order: evidenceOrder++,
      active: false,
      dead: true,
    });
  }

  (state.actions || []).slice(0, 3).forEach((action, index) => {
    const id = `action:${action.id}`;
    const status = nodeStatus(action.readOnly ? "read-only" : action.status);
    nodes.push({ id, kind: "action", label: action.label || action.id, meta: actionMeta(action), status, lane: 6, order: index, active: isActiveStatus(action.status) });
    nodesByRef.set(`action:${action.id}`, id);
    if (activeProcess && processNodeId && (
      refsInclude(activeProcess.nextActionRefs, "action", action.id) || refsInclude(action.subjectRefs, "run", activeProcess.id)
    )) {
      addEdge(edges, { id: `${processNodeId}-${id}`, from: processNodeId, to: id, active: isActiveStatus(action.status) || processIsActive });
    }
  });

  (state.gates || []).slice(0, 4).forEach((gate) => {
    const from = nodesByRef.get(`gate:${gate.id}`);
    if (!from) return;
    (gate.expectationRefs || []).forEach((ref) => {
      const to = ref.id ? nodesByRef.get(`${ref.kind}:${ref.id}`) : null;
      if (to) addEdge(edges, { id: `${from}-${to}`, from, to, active: isActiveStatus(gate.status) });
    });
  });

  const recentTimeline = (state.timeline || []).slice(-3);
  const freshestTimelineIndex = recentTimeline.length - 1;
  recentTimeline.forEach((item, index) => {
    const id = `timeline:${item.id}`;
    const active = index === freshestTimelineIndex;
    nodes.push({ id, kind: "timeline", label: item.type || "event", meta: timelineMeta(item), status: "recent", lane: 7, order: index, active });
  });

  return { nodes, edges, activeProcess };
}

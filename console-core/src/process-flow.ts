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
 * Structurally narrows the opaque `trustReport` (Surface's own
 * `buildTrustReport` output, folded verbatim onto gates/processes by
 * console#254's workflow-trust bridge) far enough to read each evidence
 * record's `evidenceType`/`method` enums — RELAY, not derivation: no verdict,
 * status, or freshness is read or recomputed here, and console-core still
 * takes no dependency on `@kontourai/surface` (same opaque-typing rationale
 * as `ConsoleProcess.trustReport` in operating-state.ts).
 */
function trustReportProvenanceIndex(state: OperatingState): Map<string, EvidenceProvenance> {
  const index = new Map<string, EvidenceProvenance>();
  const reports: unknown[] = [
    ...(state.processes || []).map((process) => process.trustReport),
    ...(state.gates || []).map((gate) => gate.trustReport),
  ];
  for (const report of reports) {
    if (!report || typeof report !== "object") continue;
    const evidence = (report as { evidence?: unknown }).evidence;
    if (!Array.isArray(evidence)) continue;
    for (const item of evidence) {
      if (!item || typeof item !== "object") continue;
      const record = item as { id?: unknown; evidenceType?: unknown; method?: unknown };
      if (typeof record.id !== "string" || !record.id || index.has(record.id)) continue;
      index.set(record.id, {
        evidenceType: typeof record.evidenceType === "string" ? record.evidenceType : undefined,
        method: typeof record.method === "string" ? record.method : undefined,
      });
    }
  }
  return index;
}

/**
 * The workflow-trust bridge qualifies evidence subject ids as
 * `<workflow>:evidence:<rawId>` (workflow-trust-bridge.ts's
 * `qualifiedEvidenceId`); the trust report's own records carry the raw id.
 * This recovers the raw id for the provenance join; a non-bridge producer's
 * unqualified id passes through unchanged.
 */
function rawEvidenceId(id: string): string {
  const marker = ":evidence:";
  const at = id.lastIndexOf(marker);
  return at >= 0 ? id.slice(at + marker.length) : id;
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
  const provenanceIndex = trustReportProvenanceIndex(state);
  const renderedEvidence = (state.evidence || []).slice(0, 6);
  let evidenceOrder = 0;
  renderedEvidence.forEach((item) => {
    const id = `evidence:${item.id}`;
    const status = nodeStatus(item.status);
    const provenance = provenanceIndex.get(rawEvidenceId(item.id));
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
    (gate.missingEvidence || []).slice(0, 3).forEach((clause) => {
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
  });
  (state.claims || []).slice(0, 4).forEach((claim) => {
    const from = nodesByRef.get(`claim:${claim.id}`);
    if (!from) return;
    const hasEvidence = edges.some((edge) => edge.from === from && edge.to.startsWith("evidence:"));
    if (hasEvidence) return;
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

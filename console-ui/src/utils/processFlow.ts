import type { ConsoleAction, ConsoleClaim, ConsoleGate, ConsoleProcess, ConsoleRef, OperatingState, TimelineItem } from "../types";
import { formatStep } from "./format";
import { selectActiveProcess } from "./selectActiveProcess";

export type FlowNodeKind = "stage" | "process" | "step" | "gate" | "claim" | "action" | "timeline";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  meta: string;
  status: string;
  lane: number;
  order: number;
  active: boolean;
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

function refsInclude(refs: ConsoleRef[] | undefined, kind: string, id: string) {
  return (refs || []).some((ref) => refMatches(ref, kind, id));
}

function addEdge(edges: FlowEdge[], edge: FlowEdge) {
  if (edges.some((item) => item.id === edge.id)) return;
  edges.push(edge);
}

export function buildProcessFlow(state: OperatingState): ProcessFlow {
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

  (state.actions || []).slice(0, 3).forEach((action, index) => {
    const id = `action:${action.id}`;
    const status = nodeStatus(action.readOnly ? "read-only" : action.status);
    nodes.push({ id, kind: "action", label: action.label || action.id, meta: actionMeta(action), status, lane: 5, order: index, active: isActiveStatus(action.status) });
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
    nodes.push({ id, kind: "timeline", label: item.type || "event", meta: timelineMeta(item), status: "recent", lane: 6, order: index, active });
  });

  return { nodes, edges, activeProcess };
}

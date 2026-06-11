import { useEffect } from "react";
import type { FlowNode } from "@kontourai/console-core";
import type { OperatingState } from "@kontourai/console-core";
import { Badge } from "@kontourai/console-kit/react";
import { formatTime } from "../utils/format";

interface NodeDetailDrawerProps {
  nodeId: string | null;
  nodes: FlowNode[];
  state: OperatingState;
  onClose(): void;
}

export function NodeDetailDrawer({ nodeId, nodes, state, onClose }: NodeDetailDrawerProps) {
  const node = nodes.find((n) => n.id === nodeId);

  // Close on Escape
  useEffect(() => {
    if (!node) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [node, onClose]);

  if (!node) return null;

  const record = findRecord(node, state);

  return (
    <aside className="node-detail-drawer" aria-label={`Details: ${node.label}`}>
      <div className="node-detail-header">
        <div>
          <span className="eyebrow">{node.kind}</span>
          <h2>{node.label}</h2>
        </div>
        <button
          type="button"
          className="node-detail-close"
          aria-label="Close detail panel"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="node-detail-body">
        <div className="node-detail-status">
          <Badge value={node.status} />
          {node.active ? <Badge value="active" /> : null}
        </div>

        {node.meta ? <p className="node-detail-meta">{node.meta}</p> : null}

        {record ? <RecordDetail node={node} record={record} state={state} /> : null}

        <details className="node-detail-raw">
          <summary>Raw JSON</summary>
          <pre>{JSON.stringify(record ?? node, null, 2)}</pre>
        </details>
      </div>
    </aside>
  );
}

// ── Record-specific detail sections ──────────────────────────────────────────

function RecordDetail({
  node,
  record,
  state,
}: {
  node: FlowNode;
  record: unknown;
  state: OperatingState;
}) {
  if (node.kind === "gate") return <GateDetail gate={record as ReturnType<typeof findGate>} />;
  if (node.kind === "claim") return <ClaimDetail claim={record as ReturnType<typeof findClaim>} state={state} />;
  if (node.kind === "action") return <ActionDetail action={record as ReturnType<typeof findAction>} />;
  if (node.kind === "process" || node.kind === "step") {
    return <ProcessDetail process={record as ReturnType<typeof findProcess>} />;
  }
  if (node.kind === "timeline") return <TimelineDetail item={record as ReturnType<typeof findTimeline>} />;
  return null;
}

function GateDetail({ gate }: { gate: ReturnType<typeof findGate> }) {
  if (!gate) return null;
  return (
    <dl className="node-detail-fields">
      {gate.routeBack?.reason ? (
        <div><dt>Route back reason</dt><dd>{gate.routeBack.reason}</dd></div>
      ) : null}
      {gate.routeBack?.targetStep ? (
        <div><dt>Target step</dt><dd>{gate.routeBack.targetStep}</dd></div>
      ) : null}
      {gate.missingEvidence?.length ? (
        <div><dt>Missing evidence</dt><dd>{gate.missingEvidence.join(", ")}</dd></div>
      ) : null}
      {gate.processRef?.label || gate.processRef?.id ? (
        <div><dt>Process</dt><dd>{gate.processRef.label || gate.processRef.id}</dd></div>
      ) : null}
      {gate.updatedAt ? (
        <div><dt>Updated</dt><dd>{formatTime(gate.updatedAt)}</dd></div>
      ) : null}
    </dl>
  );
}

function ClaimDetail({ claim, state }: { claim: ReturnType<typeof findClaim>; state: OperatingState }) {
  if (!claim) return null;
  const learnings = (state.learnings || []).filter((l) => {
    const ref = l.subjectRef || l.sourceRef;
    return ref?.kind === "claim" && ref.id === claim.id;
  });
  return (
    <>
      <dl className="node-detail-fields">
        <div><dt>Freshness</dt><dd>{claim.freshness?.status || "n/a"}</dd></div>
        <div><dt>Materiality</dt><dd>{claim.materiality || "n/a"}</dd></div>
        {claim.lastVerifiedAt ? (
          <div><dt>Last verified</dt><dd>{formatTime(claim.lastVerifiedAt)}</dd></div>
        ) : null}
        {claim.freshness?.expiresAt ? (
          <div><dt>Expires at</dt><dd>{formatTime(claim.freshness.expiresAt)}</dd></div>
        ) : null}
      </dl>
      {learnings.length > 0 ? (
        <div className="node-detail-learnings">
          <p className="eyebrow">Advisory learnings</p>
          <div className="stack">
            {learnings.map((l) => (
              <div key={l.id} className="node-detail-learning">
                <Badge value="advisory" />
                <span>{l.summary || l.id}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ActionDetail({ action }: { action: ReturnType<typeof findAction> }) {
  if (!action) return null;
  return (
    <dl className="node-detail-fields">
      <div><dt>Product</dt><dd>{action.authority?.product || "unknown"}</dd></div>
      <div><dt>Command</dt><dd>{action.authority?.command || action.kind || "n/a"}</dd></div>
      <div><dt>Read-only</dt><dd>{action.readOnly ? "yes" : "no"}</dd></div>
    </dl>
  );
}

function ProcessDetail({ process }: { process: ReturnType<typeof findProcess> }) {
  if (!process) return null;
  const step =
    typeof process.currentStep === "object"
      ? process.currentStep?.label || process.currentStep?.id || "n/a"
      : process.currentStep || "n/a";
  return (
    <dl className="node-detail-fields">
      <div><dt>Step</dt><dd>{step}</dd></div>
      <div><dt>Progress</dt><dd>{typeof process.percentComplete === "number" ? `${process.percentComplete}%` : "n/a"}</dd></div>
      {process.updatedAt ? (
        <div><dt>Updated</dt><dd>{formatTime(process.updatedAt)}</dd></div>
      ) : null}
    </dl>
  );
}

function TimelineDetail({ item }: { item: ReturnType<typeof findTimeline> }) {
  if (!item) return null;
  return (
    <dl className="node-detail-fields">
      {item.occurredAt ? <div><dt>Occurred at</dt><dd>{formatTime(item.occurredAt)}</dd></div> : null}
      {item.producer?.product ? <div><dt>Producer</dt><dd>{item.producer.product}</dd></div> : null}
      {item.streamId ? <div><dt>Stream</dt><dd>{item.streamId}</dd></div> : null}
      {item.subjectRef?.label || item.subjectRef?.id ? (
        <div><dt>Subject</dt><dd>{item.subjectRef.label || item.subjectRef.id}</dd></div>
      ) : null}
    </dl>
  );
}

// ── Record finders ────────────────────────────────────────────────────────────
function findRecord(node: FlowNode, state: OperatingState): unknown {
  if (node.kind === "gate") return findGate(node, state);
  if (node.kind === "claim") return findClaim(node, state);
  if (node.kind === "action") return findAction(node, state);
  if (node.kind === "process" || node.kind === "step") return findProcess(node, state);
  if (node.kind === "timeline") return findTimeline(node, state);
  return null;
}

function findGate(node: FlowNode, state: OperatingState) {
  const id = node.id.replace(/^gate:/, "");
  return (state.gates || []).find((g) => g.id === id) ?? null;
}

function findClaim(node: FlowNode, state: OperatingState) {
  const id = node.id.replace(/^claim:/, "");
  return (state.claims || []).find((c) => c.id === id) ?? null;
}

function findAction(node: FlowNode, state: OperatingState) {
  const id = node.id.replace(/^action:/, "");
  return (state.actions || []).find((a) => a.id === id) ?? null;
}

function findProcess(node: FlowNode, state: OperatingState) {
  const id = node.id.replace(/^(?:process|step):/, "");
  return (state.processes || []).find((p) => p.id === id) ?? null;
}

function findTimeline(node: FlowNode, state: OperatingState) {
  const id = node.id.replace(/^timeline:/, "");
  return (state.timeline || []).find((t) => t.id === id) ?? null;
}

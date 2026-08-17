import React, { useEffect } from "react";
import type { ConsoleEvidence, FlowNode } from "@kontourai/console-core";
import type { OperatingState } from "@kontourai/console-core";
import { Badge } from "@kontourai/ui/react";
import { formatTime } from "../utils/format";
import { isSafeExternalUrl } from "../utils/safeUrl";
import { SourceRefLinks } from "./SourceRefLinks";
import type { SourceRef } from "../utils/sourceRefs";
import { collectTrustReportsForScope, workflowScopeOf } from "../utils/trustReport";

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

        {node.kind === "evidence" ? (
          // console#274: the layered evidence panel renders for EVERY evidence
          // node — including a dead node with no backing record, whose panel
          // is the explicit rendering of that absence.
          <EvidenceDetail node={node} evidence={record as ConsoleEvidence | null} state={state} />
        ) : record ? (
          <RecordDetail node={node} record={record} state={state} />
        ) : null}

        {/* ▸ verify · the raw — collapsed by default (console#274 keeps this
            drawer's existing pattern; a test asserts no raw block is open on
            initial render). */}
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

// ── Evidence panel (console#274) ─────────────────────────────────────────────
//
// Layer order is the finding from the design iteration: (1) what was gleaned,
// (2) how it moved the answer, (3) how it was determined (deeplinked via the
// existing source-ref machinery), (4) the raw, collapsed (rendered by the
// drawer's existing <details>, below this component).
//
// LOAD-BEARING BOUNDARY (product-boundaries.md; the console#255 verbatim-relay
// pattern): the gleaned/impact layers render ONLY producer-side text — the
// Surface trust report's evidence `excerptOrSummary`, verification-event
// fields, and transparency-gap `message` text, all relayed verbatim (plus the
// console#207 narrative envelope once that ships — same panel-order principle,
// do not fork the pattern). Console never authors interpretation: a node with
// no producer-side interpretation renders that absence explicitly, it never
// gets one synthesized here.

/** Mirrors console-core process-flow.ts's `splitQualifiedId`: recovers the raw report id from a bridge-qualified `<workflow>:evidence:<rawId>` subject id. */
function rawEvidenceIdOf(qualifiedId: string): string {
  const marker = ":evidence:";
  const at = qualifiedId.lastIndexOf(marker);
  return at > 0 ? qualifiedId.slice(at + marker.length) : qualifiedId;
}

function AbsenceLine({ children }: { children: string }) {
  return <p className="node-detail-absence">{children}</p>;
}

function EvidenceDetail({
  node,
  evidence,
  state,
}: {
  node: FlowNode;
  evidence: ConsoleEvidence | null;
  state: OperatingState;
}) {
  if (node.dead) return <DeadEvidenceDetail />;

  const foldedId = node.id.replace(/^evidence:/, "");
  const rawId = rawEvidenceIdOf(foldedId);
  // console#274 review MED finding 2: raw report ids are bundle-local, so
  // every join below (provenance record, gleaned text, verification events,
  // gap mentions) is scoped to the OWNING workflow's own trust report(s) —
  // never a first-match-wins scan over every folded report, which would let
  // two workflows' same-named records collide and relay the wrong producer
  // text.
  const reports = collectTrustReportsForScope(state, workflowScopeOf(foldedId, ":evidence:"));
  const reportRecord = reports.flatMap((report) => report.evidence).find((item) => item.id === rawId) ?? null;
  const verificationEvents = reports
    .flatMap((report) => report.events)
    .filter((event) => event.evidenceIds?.includes(rawId));
  const gapMentions = reports
    .flatMap((report) => report.transparencyGaps)
    .filter((gap) => gap.evidenceIds?.includes(rawId));

  // Producer-side interpretation text, verbatim: the report's excerptOrSummary
  // (the folded ConsoleEvidence.summary is the SAME relayed value).
  const gleaned = reportRecord?.excerptOrSummary || (typeof evidence?.summary === "string" ? evidence.summary : undefined);

  return (
    <div className="node-detail-evidence">
      <div className="node-detail-layer">
        <p className="eyebrow">What was gleaned</p>
        {gleaned ? <p className="node-detail-gleaned">{gleaned}</p> : <AbsenceLine>No producer interpretation recorded.</AbsenceLine>}
      </div>

      <div className="node-detail-layer">
        <p className="eyebrow">How it moved the answer</p>
        {verificationEvents.length === 0 && gapMentions.length === 0 ? (
          <AbsenceLine>No producer interpretation recorded.</AbsenceLine>
        ) : (
          <div className="stack">
            {verificationEvents.map((event) => (
              // Surface's own verification event, field-by-field verbatim —
              // never composed into a Console-authored sentence.
              <dl key={event.id} className="node-detail-fields">
                {event.claimId ? <div><dt>Claim</dt><dd><code>{event.claimId}</code></dd></div> : null}
                {event.status ? <div><dt>Surface status</dt><dd>{event.status}</dd></div> : null}
                {event.method ? <div><dt>Method</dt><dd>{event.method}</dd></div> : null}
                {event.verifiedAt ? <div><dt>Verified at</dt><dd>{formatTime(event.verifiedAt)}</dd></div> : null}
              </dl>
            ))}
            {gapMentions.map((gap, index) => (
              <p key={gap.id ?? index} className="node-detail-gap-text">{gap.message || "Gap recorded without message text."}</p>
            ))}
          </div>
        )}
      </div>

      <div className="node-detail-layer">
        <p className="eyebrow">How it was determined</p>
        <DeterminationRefs evidence={evidence} reportRecord={reportRecord} />
        {/* This graph's rawest layer: nothing deeper backs this record. */}
        <p className="node-detail-bottom">Belief bottoms out here.</p>
        <p className="node-detail-source-line">
          {reportRecord?.sourceRef
            ? <>Evidence lives at <code>{reportRecord.sourceRef}</code></>
            : "No source location recorded for this evidence."}
        </p>
      </div>
    </div>
  );
}

/**
 * Deeplinks via the existing source-ref machinery (`SourceRefLinks`,
 * console#256): a producer ref becomes a live anchor ONLY when it carries a
 * safe http(s) URL; every other ref renders as an honest labeled chip whose
 * label is an id resolvable against the rendered OperatingState (the claim
 * refs the fold attached) — never a dead or fabricated anchor.
 */
function DeterminationRefs({
  evidence,
  reportRecord,
}: {
  evidence: ConsoleEvidence | null;
  reportRecord: { claimId?: string; sourceRef?: string; sourceLocator?: string; collectedBy?: string } | null;
}) {
  const refs: SourceRef[] = [];
  for (const claimRef of evidence?.claimRefs || []) {
    if (claimRef.id) refs.push({ kind: "claim", label: claimRef.id });
  }
  if (refs.length === 0 && reportRecord?.claimId) {
    refs.push({ kind: "claim", label: reportRecord.claimId });
  }
  for (const candidate of [reportRecord?.sourceRef, reportRecord?.sourceLocator]) {
    if (candidate && isSafeExternalUrl(candidate)) {
      refs.push({ kind: "evidence-source", label: candidate, url: candidate });
    }
  }
  if (reportRecord?.collectedBy) {
    refs.push({ kind: "collected-by", label: reportRecord.collectedBy });
  }
  if (refs.length === 0) {
    return <AbsenceLine>No determination references recorded.</AbsenceLine>;
  }
  return <SourceRefLinks refs={refs} ariaLabel="How it was determined" />;
}

/**
 * A dead node (console#274): a gate/claim clause with no evidence behind it.
 * First-class, never omitted — and its panel renders the absence in the same
 * layer order, never a synthesized interpretation.
 */
function DeadEvidenceDetail() {
  return (
    <div className="node-detail-evidence node-detail-evidence-dead">
      <div className="node-detail-layer">
        <p className="eyebrow">What was gleaned</p>
        <AbsenceLine>No producer interpretation recorded — no evidence exists for this clause.</AbsenceLine>
      </div>
      <div className="node-detail-layer">
        <p className="eyebrow">How it moved the answer</p>
        <AbsenceLine>Nothing recorded. This clause stands on no evidence.</AbsenceLine>
      </div>
      <div className="node-detail-layer">
        <p className="eyebrow">How it was determined</p>
        <AbsenceLine>No determination references recorded.</AbsenceLine>
        <p className="node-detail-bottom">Belief bottoms out here — on nothing.</p>
      </div>
    </div>
  );
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
      {/* console#229: why a blocked/needs_input/review_pending process is stalled. */}
      {process.blockedReason ? (
        <div><dt>Blocked reason</dt><dd>{process.blockedReason}</dd></div>
      ) : null}
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
  if (node.kind === "evidence") return findEvidence(node, state);
  if (node.kind === "gate") return findGate(node, state);
  if (node.kind === "claim") return findClaim(node, state);
  if (node.kind === "action") return findAction(node, state);
  if (node.kind === "process" || node.kind === "step") return findProcess(node, state);
  if (node.kind === "timeline") return findTimeline(node, state);
  return null;
}

function findEvidence(node: FlowNode, state: OperatingState): ConsoleEvidence | null {
  // Dead nodes (`evidence:missing:<gate>:<clause>` / `evidence:absent:<claim>`)
  // have no backing record by definition — the panel renders that absence.
  const id = node.id.replace(/^evidence:/, "");
  return (state?.evidence || []).find((item) => item.id === id) ?? null;
}

function findGate(node: FlowNode, state: OperatingState) {
  const id = node.id.replace(/^gate:/, "");
  return (state?.gates || []).find((g) => g.id === id) ?? null;
}

function findClaim(node: FlowNode, state: OperatingState) {
  const id = node.id.replace(/^claim:/, "");
  return (state?.claims || []).find((c) => c.id === id) ?? null;
}

function findAction(node: FlowNode, state: OperatingState) {
  const id = node.id.replace(/^action:/, "");
  return (state?.actions || []).find((a) => a.id === id) ?? null;
}

function findProcess(node: FlowNode, state: OperatingState) {
  const id = node.id.replace(/^(?:process|step):/, "");
  return (state?.processes || []).find((p) => p.id === id) ?? null;
}

function findTimeline(node: FlowNode, state: OperatingState) {
  const id = node.id.replace(/^timeline:/, "");
  return (state?.timeline || []).find((t) => t.id === id) ?? null;
}

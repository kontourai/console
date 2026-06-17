// FlowRunPanel — embeds Flow's dependency-free <flow-run-panel> custom element
// in the React tree, fed an ALREADY-DERIVED FlowConsoleProjection. This is the
// capstone that makes the trust/process recursion visible: the panel renders a
// run's process graph, gates, evidence, and route-backs, and nests a
// <surface-trust-panel> per evidence bundle (handled inside the element). The
// console is read-only — it owns no authoritative trust/process state and never
// derives in the browser; it passes the projection through as-is.
//
// Property dance (mirrors <surface-trust-panel> in PipelineStepper): custom
// element properties are not plain attributes, so `.projection` is assigned
// imperatively via a ref once the element has mounted.
//
// Recursion / drill-down: a parent run whose evidence references a child run is
// drillable to the child's own <flow-run-panel>. Child references are read from
// the projection's external_links (read-through — NOT re-derivation). When a
// pre-fetched child projection is available it renders inline; otherwise we
// leave a clear TODO for the live child-projection fetch and do NOT fabricate a
// projection.
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  FlowConsoleProjection,
  FlowConsoleExternalLinkRef,
} from "@kontourai/flow/console-contract";
import { ensureFlowRunPanel } from "../flow-run-panel-loader";

type ProjectionEl = HTMLElement & { projection?: FlowConsoleProjection | null };

/** A reference from this run out to a child Flow run, extracted read-only. */
interface ChildRunRef {
  /** The referenced child run id (link target_id, or id/href as a fallback). */
  childRunId: string;
  /** Human label for the drill-in control. */
  label: string;
  /** Where in the parent projection the reference came from (for the eyebrow). */
  via: string;
}

// External-link kinds that can carry a reference to another Flow run. Flow's
// contract does not (yet) mint a dedicated "flow-run" link kind, so we treat a
// link as a child-run reference when its target_id matches a known child run id.
// We keep ALL evidence/run links as candidates and resolve against the child
// projection map — never inventing a child that wasn't handed to us.
function collectChildRunRefs(projection: FlowConsoleProjection): ChildRunRef[] {
  const refs: ChildRunRef[] = [];
  const seen = new Set<string>();

  const pushLink = (link: FlowConsoleExternalLinkRef, via: string) => {
    const childRunId = link.target_id ?? link.id;
    if (!childRunId || childRunId === projection.run?.run_id) return;
    if (seen.has(childRunId)) return;
    seen.add(childRunId);
    refs.push({ childRunId, label: link.label ?? childRunId, via });
  };

  for (const link of projection.external_links ?? []) {
    pushLink(link, "run reference");
  }
  // Evidence external links carry most child-run references. Walk both the
  // top-level evidence list and each gate's evidence (the projector nests
  // evidence under its gate as well as flattening it).
  const evidence = [
    ...(projection.evidence ?? []),
    ...(projection.gates ?? []).flatMap((gate) => gate.evidence ?? []),
  ];
  for (const ev of evidence) {
    for (const link of ev.external_links ?? []) {
      pushLink(link, `evidence ${ev.id}`);
    }
  }
  return refs;
}

interface FlowRunPanelMountProps {
  projection: FlowConsoleProjection;
  heading?: string;
}

/** Mounts a single <flow-run-panel> and sets its `.projection` via a ref. */
function FlowRunPanelMount({ projection, heading }: FlowRunPanelMountProps) {
  const panelRef = useRef<ProjectionEl>(null);

  // Register the custom element when this panel mounts.
  useEffect(() => {
    ensureFlowRunPanel();
  }, []);

  // Set .projection imperatively when the element mounts or the projection
  // changes — custom-element properties are not plain attributes.
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.projection = projection;
    }
  }, [projection]);

  return <flow-run-panel ref={panelRef} heading={heading} />;
}

interface FlowRunPanelProps {
  /** The active run's pre-derived projection (passed through, never derived). */
  projection: FlowConsoleProjection;
  /**
   * Optional pre-fetched child-run projections keyed by child run_id. Absent
   * children fall back to a TODO placeholder for the live fetch.
   */
  childProjections?: Record<string, FlowConsoleProjection>;
}

export function FlowRunPanel({ projection, childProjections }: FlowRunPanelProps) {
  const [openChildId, setOpenChildId] = useState<string | null>(null);

  const childRefs = useMemo(() => collectChildRunRefs(projection), [projection]);

  const openChild = openChildId ? childProjections?.[openChildId] : undefined;
  const openChildRef = childRefs.find((r) => r.childRunId === openChildId) ?? null;

  return (
    <div className="flow-run-panel-embed" aria-label="Flow run panel">
      <FlowRunPanelMount projection={projection} />

      {childRefs.length > 0 && (
        <div className="flow-run-children" aria-label="Referenced child runs">
          <p className="section-label">Referenced runs</p>
          <div className="flow-run-children-list">
            {childRefs.map((ref) => {
              const isOpen = openChildId === ref.childRunId;
              return (
                <button
                  key={ref.childRunId}
                  type="button"
                  className={`flow-run-child-toggle${isOpen ? " flow-run-child-toggle--open" : ""}`}
                  aria-expanded={isOpen}
                  data-child-run-id={ref.childRunId}
                  onClick={() => setOpenChildId((prev) => (prev === ref.childRunId ? null : ref.childRunId))}
                >
                  <span className="flow-run-child-toggle-icon" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                  <span className="flow-run-child-toggle-label">{ref.label}</span>
                  <code className="eyebrow flow-run-child-toggle-via">{ref.via}</code>
                </button>
              );
            })}
          </div>

          {openChildId && (
            <div className="flow-run-child-detail" data-child-detail-for={openChildId}>
              {openChild ? (
                // Read-through: the child's own pre-derived projection, rendered
                // by a nested <flow-run-panel>. A child going stale surfaces here
                // (its projection carries the stale status) — no re-derivation.
                <FlowRunPanelMount
                  projection={openChild}
                  heading={openChildRef?.label ?? openChildId}
                />
              ) : (
                // TODO(live-child-fetch): wire a live fetch of the child run's
                // FlowConsoleProjection (hosted ingest endpoint
                // `GET <console-base>/ingest/flow/<runId>` per
                // docs/design/hosted-console-ingest-contract.md, or the local
                // bridge for file mode) keyed by `openChildId`, then feed it to
                // FlowRunPanelMount. Until that seam is stood up we render the
                // reference honestly rather than fabricating a projection.
                <p className="flow-run-child-pending" role="note">
                  Child run <code>{openChildId}</code> is referenced but its
                  projection has not been fetched yet. The drill-in renders once
                  the child projection is available (read-through, not
                  re-derivation).
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

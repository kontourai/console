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
// pre-fetched child projection is available it renders inline; otherwise the
// panel LIVE-FETCHES the child's FlowConsoleProjection from the hosted-ingest
// read endpoint (GET /ingest/flow/:runId, surfaced via `fetchChildProjection`)
// and renders it once available. We never fabricate a projection — loading,
// empty (not recorded yet), and error states are surfaced honestly.
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

/** Live-fetch outcome for a referenced child run's projection. */
type ChildFetchState =
  | { status: "loading" }
  /** Fetch resolved but no projection is recorded for the run (404 / null). */
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "loaded"; projection: FlowConsoleProjection };

/**
 * Minimal shape guard for a fetched child projection. The fetch returns
 * `unknown` (the read endpoint is Flow-payload-owned, the console validates
 * before mounting). We require the fields <flow-run-panel> reads.
 */
export function asChildProjection(raw: unknown): FlowConsoleProjection | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as FlowConsoleProjection;
  if (!candidate.run || typeof candidate.run.run_id !== "string") return null;
  if (!Array.isArray(candidate.steps) || !Array.isArray(candidate.gates)) return null;
  return candidate;
}

interface FlowRunPanelProps {
  /** The active run's pre-derived projection (passed through, never derived). */
  projection: FlowConsoleProjection;
  /**
   * Optional pre-fetched child-run projections keyed by child run_id. Absent
   * children are live-fetched via `fetchChildProjection`.
   */
  childProjections?: Record<string, FlowConsoleProjection>;
  /**
   * Live read-through fetch for a referenced child run's projection (the hosted
   * GET /ingest/flow/:runId endpoint). Returns the raw projection, or null when
   * none is recorded for the run. Omit to disable live fetch (the reference then
   * renders as "not fetched yet"). The console never derives — it only reads.
   */
  fetchChildProjection?: (runId: string) => Promise<unknown | null>;
}

export function FlowRunPanel({ projection, childProjections, fetchChildProjection }: FlowRunPanelProps) {
  const [openChildId, setOpenChildId] = useState<string | null>(null);
  // Live-fetched child projections keyed by child run_id (populated on drill-in
  // when no pre-fetched projection is available).
  const [fetched, setFetched] = useState<Record<string, ChildFetchState>>({});

  const childRefs = useMemo(() => collectChildRunRefs(projection), [projection]);

  const preFetchedChild = openChildId ? childProjections?.[openChildId] : undefined;
  const openChildRef = childRefs.find((r) => r.childRunId === openChildId) ?? null;
  const liveChild = openChildId ? fetched[openChildId] : undefined;

  // When a child is opened that has no pre-fetched projection, live-fetch it
  // once via the read endpoint. Guarded so we don't refetch on every render.
  useEffect(() => {
    if (!openChildId) return;
    if (childProjections?.[openChildId]) return; // pre-fetched — no fetch needed
    if (!fetchChildProjection) return; // live fetch disabled
    if (fetched[openChildId]) return; // already fetched (or in flight)

    let cancelled = false;
    setFetched((prev) => ({ ...prev, [openChildId]: { status: "loading" } }));
    fetchChildProjection(openChildId)
      .then((raw) => {
        if (cancelled) return;
        const childProjection = asChildProjection(raw);
        setFetched((prev) => ({
          ...prev,
          [openChildId]: childProjection
            ? { status: "loaded", projection: childProjection }
            : { status: "empty" }
        }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFetched((prev) => ({
          ...prev,
          [openChildId]: { status: "error", message: err instanceof Error ? err.message : "fetch failed" }
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [openChildId, childProjections, fetchChildProjection, fetched]);

  // The child projection to render: pre-fetched takes precedence, else live-fetched.
  const openChild = preFetchedChild ?? (liveChild?.status === "loaded" ? liveChild.projection : undefined);

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
              ) : liveChild?.status === "loading" ? (
                <p className="flow-run-child-loading" role="status" aria-live="polite">
                  Loading projection for child run <code>{openChildId}</code>…
                </p>
              ) : liveChild?.status === "error" ? (
                <p className="flow-run-child-error" role="alert">
                  Could not load child run <code>{openChildId}</code>: {liveChild.message}.
                </p>
              ) : liveChild?.status === "empty" || !fetchChildProjection ? (
                // Either the read endpoint has no projection recorded for this run
                // yet, or live fetch is disabled. Render the reference honestly —
                // never fabricate a projection.
                <p className="flow-run-child-pending" role="note">
                  Child run <code>{openChildId}</code> is referenced but its
                  projection has not been fetched yet. The drill-in renders once
                  the child projection is available (read-through, not
                  re-derivation).
                </p>
              ) : (
                // Brief gap before the fetch effect sets "loading".
                <p className="flow-run-child-loading" role="status" aria-live="polite">
                  Loading projection for child run <code>{openChildId}</code>…
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

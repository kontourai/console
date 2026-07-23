// GateTrustPanel (console#255) — the finale of the trust arc: mounts Surface's
// own <surface-trust-panel> custom element for whichever gate an operator has
// selected/deep-linked (`/gate/:id`, console#252), fed by console#254's
// workflow-trust bridge fold.
//
// Surface stays the sole authority for trust verdicts — this component never
// transforms, recomputes, or filters the report. It only SELECTS which
// already-derived report to show (gate's own trustReport, else the owning
// process's, in that precedence order) and passes it through to the element
// verbatim via the `report` property. `<surface-trust-panel>` has no notion of
// "scope to one gate" (it renders every claim in whatever report it is given —
// see node_modules/@kontourai/surface's trust-panel element, which only reads
// `report.claims`/`report.evidence`/`report.transparencyGaps`), so a
// process-level fallback report is honestly labeled as the workflow's full
// report, not silently presented as gate-specific.
//
// Property dance mirrors PipelineStepper.tsx's TrustPanelRow / FlowRunPanel.tsx:
// custom-element properties are not plain attributes, so `.report` is set
// imperatively via a ref in a `useEffect`, re-run on every report change so SSE
// state updates (console#252's live stream) flow straight through — no local
// caching. Client-only: effects never run under `renderToStaticMarkup` (this
// repo's SSR-only component-test convention — see
// console-ui/test/BoardSection.test.ts's module doc comment), so this
// component is safe to render there without crashing or double-registering.
import React, { useEffect, useRef, useState } from "react";
import type { ConsoleGate, ConsoleProcess, ConsoleRef } from "@kontourai/console-core";
import { refJoinsProcess } from "../sections/board/deriveRunDetail";
import { ensureSurfaceTrustPanel } from "../surface-trust-panel-loader";

export type GateTrustReportSource = "gate" | "process" | "none";

export interface GateTrustReportSelection {
  /** The Surface `buildTrustReport` output to render, verbatim, or undefined when neither the gate nor its owning process carries one yet. */
  report: unknown;
  /** Where the report came from — drives the UI's "workflow report, not gate-specific" note. */
  source: GateTrustReportSource;
}

/**
 * Finds the process a gate belongs to. Joins via the SAME hardened
 * `refJoinsProcess` helper deriveRunDetail.ts's gate-history/timeline joins
 * use (console#255 review MED finding 1) — a bare `gate.processRef.id ===
 * process.id` match alone would let a gate from one product silently pick up
 * a DIFFERENT product's same-id process's trust report (the exact
 * cross-product collision class console#253 review finding 5 already closed
 * for gate history). When `processRef` carries `product`/`kind`, they must
 * agree with the process's own `sourceRef`; an id-only ref keeps the looser
 * id-only join (unchanged behavior for every producer that emits unqualified
 * refs today).
 */
export function findOwningProcess(gate: ConsoleGate, processes: ConsoleProcess[]): ConsoleProcess | undefined {
  if (!gate.processRef?.id) return undefined;
  return processes.find((process) => refJoinsProcess(gate.processRef, process));
}

/**
 * Precedence: the gate's OWN trustReport first (console#254 attaches it to
 * every gate association), else the owning process's trustReport (console#254
 * attaches the full report to the process even with zero gate associations —
 * "no data loss"), else no report at all. Never fabricates a report from
 * status/refs alone.
 */
export function selectGateTrustReport(gate: ConsoleGate, processes: ConsoleProcess[]): GateTrustReportSelection {
  if (gate.trustReport !== undefined) {
    return { report: gate.trustReport, source: "gate" };
  }
  const owningProcess = findOwningProcess(gate, processes);
  if (owningProcess?.trustReport !== undefined) {
    return { report: owningProcess.trustReport, source: "process" };
  }
  return { report: undefined, source: "none" };
}

type TrustPanelElement = HTMLElement & { report?: unknown };

function RefsFallbackList({ label, refs }: { label: string; refs: ConsoleRef[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="gate-trust-panel-refs">
      <p className="eyebrow">{label}</p>
      <ul>
        {refs.map((ref, index) => (
          <li key={`${ref.product ?? ""}:${ref.kind ?? ""}:${ref.id ?? index}`}>
            {ref.label || ref.id || "unlabeled reference"}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyOrFallback({
  gate,
  headline,
}: {
  gate: ConsoleGate;
  headline: string;
}) {
  const evidenceRefs = gate.evidenceRefs ?? [];
  const expectationRefs = gate.expectationRefs ?? [];
  const hasRefs = evidenceRefs.length > 0 || expectationRefs.length > 0;
  return (
    <div className="gate-trust-panel gate-trust-panel--empty" aria-label={`Trust panel for gate ${gate.id}`}>
      <p className="trust-panel-no-data">{headline}</p>
      {hasRefs ? (
        <>
          <RefsFallbackList label="Evidence references" refs={evidenceRefs} />
          <RefsFallbackList label="Expectation references" refs={expectationRefs} />
        </>
      ) : null}
    </div>
  );
}

export interface GateTrustPanelProps {
  gate: ConsoleGate;
  /** `state.processes` — used to resolve the gate's owning process for the fallback report. */
  processes: ConsoleProcess[];
}

export function GateTrustPanel({ gate, processes }: GateTrustPanelProps) {
  const panelRef = useRef<TrustPanelElement>(null);
  const { report, source } = selectGateTrustReport(gate, processes);
  // console#255 review MED finding 2: tracks whether the <surface-trust-panel>
  // element actually finished loading — a failed dynamic import (offline, a
  // CDN hiccup) must render an honest fallback, never a blank/unupgraded tag.
  // Starts optimistic (assume it will load); the loader's promise flips this
  // to true only on an actual failure.
  const [elementUnavailable, setElementUnavailable] = useState(false);

  // Register the custom element once this panel mounts. Each mount gets a
  // fresh call, so a PRIOR failure (which resets the loader's internal state
  // on rejection) is retried the next time a gate is selected/reselected.
  useEffect(() => {
    let cancelled = false;
    ensureSurfaceTrustPanel().then((loadedOk) => {
      if (!cancelled) setElementUnavailable(!loadedOk);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-set `.report` imperatively on every mount/change so a live SSE state
  // update (console#252) flows straight to the element — no local caching.
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.report = report;
    }
  }, [report, elementUnavailable]);

  if (report === undefined) {
    return <EmptyOrFallback gate={gate} headline="No trust data yet for this gate." />;
  }

  if (elementUnavailable) {
    // A report EXISTS but the element never registered — an honest fallback
    // (never a blank, unupgraded <surface-trust-panel> tag) that still
    // surfaces whatever references the gate itself carries.
    return (
      <EmptyOrFallback
        gate={gate}
        headline="The trust panel couldn't load — showing the underlying references instead."
      />
    );
  }

  return (
    <div className="gate-trust-panel" aria-label={`Trust panel for gate ${gate.id}`}>
      {source === "process" ? (
        <p className="gate-trust-panel-note">
          No report attached to this gate yet — showing the workflow's full trust report instead.
        </p>
      ) : null}
      <surface-trust-panel ref={panelRef} heading={`Gate ${gate.label || gate.id} trust`} />
    </div>
  );
}

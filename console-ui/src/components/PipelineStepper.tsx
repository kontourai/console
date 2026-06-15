// PipelineStepper — honest CI-style stage stepper for the operate view.
// Renders spec.steps in order with per-stage status, gate chips, route-back
// arcs, and drill-in via PipelineStageDrawer.
// When pipeline.isDag is true, renders a layered DAG with fan-in connectors.
import { useState, useCallback, useMemo } from "react";
import type { Pipeline, PipelineStage, PipelineGate } from "@kontourai/console-core";

// ── Status icon helpers ──────────────────────────────────────────────────────

function stageStatusIcon(status: PipelineStage["status"]): string {
  if (status === "passed") return "✓";
  if (status === "current") return "→";
  if (status === "blocked") return "!";
  if (status === "failed") return "✗";
  if (status === "ready") return "◎";
  return "·";
}

function gateStatusIcon(status: string): string {
  if (status === "passed") return "✓";
  if (status === "waiting") return "⏳";
  if (status === "failed") return "✗";
  return "·";
}

// ── Gate chip ────────────────────────────────────────────────────────────────

function GateChip({ gate }: { gate: PipelineGate }) {
  return (
    <span
      className={`pipeline-gate-chip pipeline-gate-chip--${gate.status}`}
      title={`${gate.id}: ${gate.status}`}
    >
      {gateStatusIcon(gate.status)}
    </span>
  );
}

// ── Gate pill (drawer — auto-width, labeled) ────────────────────────────────

function GatePill({ gate }: { gate: PipelineGate }) {
  return (
    <span
      className={`pipeline-gate-pill pipeline-gate-pill--${gate.status}`}
      aria-label={`Gate ${gate.id}: ${gate.status}`}
    >
      <span className="pipeline-gate-pill-icon" aria-hidden="true">{gateStatusIcon(gate.status)}</span>
      <span className="pipeline-gate-pill-text">{gate.id}</span>
      <span className="pipeline-gate-pill-status">{gate.status}</span>
    </span>
  );
}

// ── Stage card ───────────────────────────────────────────────────────────────

interface StageCardProps {
  stage: PipelineStage;
  isSelected: boolean;
  onSelect(id: string): void;
}

function StageCard({ stage, isSelected, onSelect }: StageCardProps) {
  return (
    <button
      type="button"
      className={[
        "pipeline-stage",
        `pipeline-stage--${stage.status}`,
        isSelected ? "pipeline-stage--selected" : "",
        stage.configWarning ? "pipeline-stage--has-warning" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => onSelect(stage.id)}
      aria-pressed={isSelected}
      aria-label={`Stage ${stage.label}, status: ${stage.status}${stage.configWarning ? " (config warning)" : ""}`}
    >
      <span className="pipeline-stage-icon-row">
        <span className="pipeline-stage-icon">{stageStatusIcon(stage.status)}</span>
        {stage.configWarning && (
          <span className="pipeline-stage-warn-dot" title={stage.configWarning} aria-label="Configuration warning">⚠</span>
        )}
      </span>
      <span className="pipeline-stage-label">{stage.label}</span>
      {stage.gates.length > 0 && (
        <span className="pipeline-stage-gates">
          {stage.gates.map((g) => <GateChip key={g.id} gate={g} />)}
        </span>
      )}
      <code className="pipeline-stage-status">{stage.status}</code>
    </button>
  );
}

// ── Route-back arc ───────────────────────────────────────────────────────────

function RouteBackArc({ from, to }: { from: string; to: string }) {
  return (
    <span className="pipeline-route-back" title={`Route-back: ${from} → ${to}`}>
      <span className="pipeline-route-back-label">↺ {from} → {to}</span>
    </span>
  );
}

// ── Stage drill-in drawer ────────────────────────────────────────────────────

interface PipelineStageDrawerProps {
  stage: PipelineStage | null;
  onClose(): void;
}

function PipelineStageDrawer({ stage, onClose }: PipelineStageDrawerProps) {
  if (!stage) return null;

  // Determine what "what's needed" section should show
  const isBlocked = stage.status === "blocked";
  const isCurrent = stage.status === "current";
  const isFailed = stage.status === "failed";
  const needsSomeAction = isBlocked || isCurrent || isFailed;

  // For blocked: unmet predecessor stages listed in reason (parsed from "Waiting on: ...")
  const unmetPredecessors: string[] = [];
  if (isBlocked && stage.reason) {
    const match = stage.reason.match(/^Waiting on: (.+)$/);
    if (match) {
      unmetPredecessors.push(...match[1].split(", ").map((s) => s.trim()));
    }
  }

  // For current: gates waiting for evidence
  const waitingGates = stage.gates.filter((g) => g.status === "waiting" || g.status === "pending");

  // For failed: find failed gates
  const failedGates = stage.gates.filter((g) => g.status === "failed");

  return (
    <>
      <div className="node-detail-backdrop" aria-hidden="true" onClick={onClose} />
    <aside className="node-detail-drawer" aria-label={`Stage details: ${stage.label}`}>
      <div className="node-detail-header">
        <div>
          <span className="eyebrow">pipeline stage</span>
          <h2>{stage.label}</h2>
        </div>
        <button
          type="button"
          className="node-detail-close"
          aria-label="Close stage detail panel"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="node-detail-body">

        {/* ── Status pill + reason ───────────────────────────── */}
        <div className="pipeline-drawer-status-row">
          <span className={`pipeline-status-badge pipeline-status-badge--${stage.status}`}>
            {stage.status}
          </span>
          {stage.reason && (
            <p className="pipeline-drawer-reason">{stage.reason}</p>
          )}
        </div>

        <code className="eyebrow" style={{ display: "block", marginBottom: 12 }}>{stage.id}</code>

        {/* ── Config warning callout ─────────────────────────── */}
        {stage.configWarning && (
          <div className="pipeline-config-warning" role="alert">
            <span className="pipeline-config-warning-icon" aria-hidden="true">⚠</span>
            <span className="pipeline-config-warning-text">{stage.configWarning}</span>
          </div>
        )}

        {/* ── What's needed to proceed ───────────────────────── */}
        {needsSomeAction && (
          <div className="pipeline-drawer-needs">
            <span className="eyebrow" style={{ display: "block", marginBottom: 8 }}>What's needed to proceed</span>
            {isBlocked && unmetPredecessors.length > 0 && (
              <ul className="pipeline-needs-list">
                {unmetPredecessors.map((pred) => (
                  <li key={pred} className="pipeline-needs-item pipeline-needs-item--predecessor">
                    <span className="pipeline-needs-item-icon" aria-hidden="true">⊙</span>
                    <span className="pipeline-needs-item-label">{pred}</span>
                    <span className="pipeline-needs-item-tag">waiting on</span>
                  </li>
                ))}
              </ul>
            )}
            {isCurrent && waitingGates.map((gate) => (
              <div key={gate.id} className="pipeline-needs-gate-section">
                {gate.expects.length > 0 ? (
                  <ul className="pipeline-expects-list">
                    {gate.expects.map((expect) => (
                      /* data-claim-id preserved for future trust-panel embed per claim */
                      <li key={expect.id} className="pipeline-expect-item" data-claim-id={expect.id} data-claim-kind={expect.kind}>
                        <code className="eyebrow">{expect.kind}</code>
                        <span className="pipeline-expect-label">{expect.label}</span>
                        <span className={`pipeline-expect-required ${expect.required ? "pipeline-expect-required--yes" : ""}`}>
                          {expect.required ? "required" : "optional"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pipeline-needs-no-expects">Gate {gate.id} has no declared evidence requirements.</p>
                )}
              </div>
            ))}
            {isFailed && failedGates.length > 0 && (
              <div className="pipeline-needs-failed">
                <p className="pipeline-needs-failed-text">
                  {stage.reason ?? `Gate failed — new evidence or a route-back is needed.`}
                </p>
                <p className="pipeline-needs-failed-hint">
                  Attach superseding evidence or trigger a route-back to an earlier stage.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Gate detail(s) ─────────────────────────────────── */}
        {stage.gates.length === 0 && !stage.configWarning && (
          <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>No gates defined for this stage.</p>
        )}

        {stage.gates.map((gate) => (
          <div key={gate.id} className="pipeline-gate-detail">
            <div className="pipeline-gate-detail-header">
              <code className="eyebrow">{gate.id}</code>
              {/* Use GatePill (auto-width labeled) in the drawer — not the fixed-size chip */}
              <GatePill gate={gate} />
            </div>

            {gate.expects.length > 0 && (
              <ul className="pipeline-expects-list">
                {gate.expects.map((expect) => (
                  /* data-claim-id preserved for future trust-panel embed per claim */
                  <li key={expect.id} className="pipeline-expect-item" data-claim-id={expect.id} data-claim-kind={expect.kind}>
                    <code className="eyebrow">{expect.kind}</code>
                    <span className="pipeline-expect-label">{expect.label}</span>
                    <span className={`pipeline-expect-required ${expect.required ? "pipeline-expect-required--yes" : ""}`}>
                      {expect.required ? "required" : "optional"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        <details className="node-detail-raw">
          <summary>Raw JSON</summary>
          <pre>{JSON.stringify(stage, null, 2)}</pre>
        </details>
      </div>
    </aside>
    </>
  );
}

// ── DAG layout helpers ───────────────────────────────────────────────────────

/**
 * Compute topological layer (column) for each stage.
 * Layer = longest path from any root (BFS/Kahn's with max-depth tracking).
 * Returns a map of stageId → layerIndex (0-based).
 */
function computeLayerMap(
  stages: PipelineStage[],
  edges: Pipeline["edges"],
): Map<string, number> {
  // Build adjacency: successors of each node
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const s of stages) {
    successors.set(s.id, []);
    predecessors.set(s.id, []);
  }
  for (const e of edges) {
    if (e.kind === "next") {
      successors.get(e.from)?.push(e.to);
      predecessors.get(e.to)?.push(e.from);
    }
  }

  // Layer = longest path from a root (no predecessors)
  const layer = new Map<string, number>();
  for (const s of stages) layer.set(s.id, 0);

  // Topological order via Kahn's (in-degree based)
  const inDegree = new Map<string, number>();
  for (const s of stages) inDegree.set(s.id, predecessors.get(s.id)?.length ?? 0);

  const queue: string[] = [];
  for (const s of stages) {
    if ((inDegree.get(s.id) ?? 0) === 0) queue.push(s.id);
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    const nodeLayer = layer.get(node) ?? 0;
    for (const succ of (successors.get(node) ?? [])) {
      const newLayer = nodeLayer + 1;
      if (newLayer > (layer.get(succ) ?? 0)) {
        layer.set(succ, newLayer);
      }
      const newDeg = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, newDeg);
      if (newDeg === 0) queue.push(succ);
    }
  }

  return layer;
}

// ── SVG DAG connectors ───────────────────────────────────────────────────────

interface DagConnectorsProps {
  stages: PipelineStage[];
  edges: Pipeline["edges"];
  layerMap: Map<string, number>;
  /** px card width (approximate, for layout) */
  cardW: number;
  /** px card height (approximate) */
  cardH: number;
  /** px gap between columns */
  colGap: number;
  /** px gap between rows in same column */
  rowGap: number;
  /** row index within layer for each stage */
  rowInLayer: Map<string, number>;
  /** how many nodes in each layer */
  layerSize: Map<number, number>;
}

function DagConnectors({
  stages,
  edges,
  layerMap,
  cardW,
  cardH,
  colGap,
  rowGap,
  rowInLayer,
  layerSize,
}: DagConnectorsProps) {
  const nextEdges = edges.filter((e) => e.kind === "next");

  // Compute center x,y for each stage card
  const centerOf = (id: string): { x: number; y: number } => {
    const col = layerMap.get(id) ?? 0;
    const row = rowInLayer.get(id) ?? 0;
    const layerCount = layerSize.get(col) ?? 1;
    const colX = col * (cardW + colGap) + cardW / 2;
    // Center the column vertically within max layer height
    const maxRows = Math.max(...Array.from(layerSize.values()));
    const totalH = maxRows * cardH + (maxRows - 1) * rowGap;
    const layerH = layerCount * cardH + (layerCount - 1) * rowGap;
    const offsetY = (totalH - layerH) / 2;
    const colY = offsetY + row * (cardH + rowGap) + cardH / 2;
    return { x: colX, y: colY };
  };

  const stageIds = new Set(stages.map((s) => s.id));
  const svgEdges = nextEdges.filter((e) => stageIds.has(e.from) && stageIds.has(e.to));

  // Compute SVG canvas size
  const maxCol = Math.max(...Array.from(layerMap.values()), 0);
  const maxRows = Math.max(...Array.from(layerSize.values()), 1);
  const svgW = (maxCol + 1) * (cardW + colGap) - colGap + 20;
  const svgH = maxRows * cardH + (maxRows - 1) * rowGap + 20;

  return (
    <svg
      className="pipeline-dag-svg"
      width={svgW}
      height={svgH}
      aria-hidden="true"
      style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
    >
      <defs>
        <marker id="dag-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="var(--dim)" />
        </marker>
        <marker id="dag-arrow-active" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="var(--accent)" />
        </marker>
      </defs>
      {svgEdges.map((edge, i) => {
        const from = centerOf(edge.from);
        const to = centerOf(edge.to);
        // Right edge of from card → left edge of to card
        const x1 = from.x + cardW / 2;
        const y1 = from.y;
        const x2 = to.x - cardW / 2;
        const y2 = to.y;
        // Bezier control points
        const cx1 = x1 + (x2 - x1) * 0.5;
        const cy1 = y1;
        const cx2 = x1 + (x2 - x1) * 0.5;
        const cy2 = y2;
        // Is the edge "active" (connecting to/from a current stage)?
        const fromStage = stages.find((s) => s.id === edge.from);
        const toStage = stages.find((s) => s.id === edge.to);
        const isActive =
          fromStage?.status === "current" ||
          toStage?.status === "current" ||
          fromStage?.status === "passed";
        return (
          <path
            key={i}
            d={`M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`}
            fill="none"
            stroke={isActive ? "var(--accent)" : "var(--dim)"}
            strokeWidth={isActive ? 1.5 : 1}
            strokeOpacity={isActive ? 0.7 : 0.4}
            markerEnd={isActive ? "url(#dag-arrow-active)" : "url(#dag-arrow)"}
          />
        );
      })}
    </svg>
  );
}

// ── DAG renderer ─────────────────────────────────────────────────────────────

interface PipelineDagProps {
  pipeline: Pipeline;
  selectedStageId: string | null;
  onSelect(id: string): void;
}

function PipelineDag({ pipeline, selectedStageId, onSelect }: PipelineDagProps) {
  const { stages, edges } = pipeline;

  // Card dimensions (approximate — CSS sets actual; these are for layout math)
  const CARD_W = 148;
  const CARD_H = 100;
  const COL_GAP = 56;
  const ROW_GAP = 14;

  // Compute layer (column) for each stage
  const layerMap = useMemo(() => computeLayerMap(stages, edges), [stages, edges]);

  // Group stages by layer
  const layerGroups = useMemo(() => {
    const groups = new Map<number, PipelineStage[]>();
    for (const stage of stages) {
      const col = layerMap.get(stage.id) ?? 0;
      if (!groups.has(col)) groups.set(col, []);
      groups.get(col)!.push(stage);
    }
    return groups;
  }, [stages, layerMap]);

  const layerSize = useMemo(() => {
    const sz = new Map<number, number>();
    for (const [col, group] of layerGroups) sz.set(col, group.length);
    return sz;
  }, [layerGroups]);

  // Row index within each layer for each stage
  const rowInLayer = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of layerGroups.values()) {
      group.forEach((stage, i) => map.set(stage.id, i));
    }
    return map;
  }, [layerGroups]);

  const maxCol = Math.max(...Array.from(layerMap.values()), 0);
  const maxRows = Math.max(...Array.from(layerSize.values()), 1);

  // Canvas size
  const canvasW = (maxCol + 1) * (CARD_W + COL_GAP) - COL_GAP + 24;
  const canvasH = maxRows * CARD_H + (maxRows - 1) * ROW_GAP + 24;

  return (
    <div
      className="pipeline-dag"
      style={{ position: "relative", width: canvasW, minWidth: canvasW, height: canvasH, minHeight: canvasH }}
    >
      {/* SVG connector layer (drawn behind cards) */}
      <DagConnectors
        stages={stages}
        edges={edges}
        layerMap={layerMap}
        cardW={CARD_W}
        cardH={CARD_H}
        colGap={COL_GAP}
        rowGap={ROW_GAP}
        rowInLayer={rowInLayer}
        layerSize={layerSize}
      />

      {/* Stage cards positioned absolutely */}
      {stages.map((stage) => {
        const col = layerMap.get(stage.id) ?? 0;
        const row = rowInLayer.get(stage.id) ?? 0;
        const layerCount = layerSize.get(col) ?? 1;

        // Center the column vertically
        const totalH = maxRows * CARD_H + (maxRows - 1) * ROW_GAP;
        const layerH = layerCount * CARD_H + (layerCount - 1) * ROW_GAP;
        const offsetY = (totalH - layerH) / 2;

        const left = col * (CARD_W + COL_GAP) + 12;
        const top = offsetY + row * (CARD_H + ROW_GAP) + 12;

        return (
          <div
            key={stage.id}
            className="pipeline-dag-node"
            style={{ position: "absolute", left, top, width: CARD_W }}
          >
            <StageCard
              stage={stage}
              isSelected={selectedStageId === stage.id}
              onSelect={onSelect}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Main PipelineStepper ─────────────────────────────────────────────────────

interface PipelineStepperProps {
  pipeline: Pipeline;
}

export function PipelineStepper({ pipeline }: PipelineStepperProps) {
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const handleSelect = useCallback((id: string) => {
    setSelectedStageId((prev) => (prev === id ? null : id));
  }, []);

  const handleClose = useCallback(() => {
    setSelectedStageId(null);
  }, []);

  const selectedStage = pipeline.stages.find((s) => s.id === selectedStageId) ?? null;

  const routeBackEdges = pipeline.edges.filter((e) => e.kind === "route-back");

  return (
    <div className="pipeline-stepper-wrap" aria-label="Flow pipeline">
      {/* Accessible ordered list for screen readers */}
      <ol className="flow-node-list" aria-label="Pipeline stages in order">
        {pipeline.stages.map((stage) => (
          <li key={stage.id}>
            {stage.label} — {stage.status}
            {stage.gates.map((g) => ` | gate ${g.id}: ${g.status}`).join("")}
          </li>
        ))}
      </ol>

      {/* Visual: DAG or linear stepper */}
      {pipeline.isDag ? (
        <div className="pipeline-dag-wrap" aria-hidden="true">
          <PipelineDag
            pipeline={pipeline}
            selectedStageId={selectedStageId}
            onSelect={handleSelect}
          />
        </div>
      ) : (
        <div className="pipeline-stepper" aria-hidden="true">
          {pipeline.stages.map((stage, index) => (
            <div key={stage.id} className="pipeline-stage-wrap">
              <StageCard
                stage={stage}
                isSelected={selectedStageId === stage.id}
                onSelect={handleSelect}
              />
              {index < pipeline.stages.length - 1 && (
                <span className="pipeline-connector" aria-hidden="true">→</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Route-back arcs */}
      {routeBackEdges.length > 0 && (
        <div className="pipeline-route-backs" aria-label="Route-back transitions">
          {routeBackEdges.map((e, i) => (
            <RouteBackArc key={i} from={e.from} to={e.to} />
          ))}
        </div>
      )}

      {/* Meta row */}
      <div className="pipeline-meta">
        <code className="eyebrow">{pipeline.runId}</code>
        <span className="pipeline-meta-status">{pipeline.runStatus}</span>
        {pipeline.isDag && (
          <span className="pipeline-dag-badge">DAG</span>
        )}
      </div>

      {/* Drill-in drawer */}
      <PipelineStageDrawer stage={selectedStage} onClose={handleClose} />
    </div>
  );
}

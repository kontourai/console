// PipelineStepper — honest CI-style stage stepper for the operate view.
// Renders spec.steps in order with per-stage status, gate chips, route-back
// arcs, and drill-in via PipelineStageDrawer.
import { useState, useCallback } from "react";
import type { Pipeline, PipelineStage, PipelineGate } from "@kontourai/console-core";

// ── Status icon helpers ──────────────────────────────────────────────────────

function stageStatusIcon(status: PipelineStage["status"]): string {
  if (status === "passed") return "✓";
  if (status === "current") return "→";
  if (status === "blocked") return "!";
  if (status === "failed") return "✗";
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
      ].filter(Boolean).join(" ")}
      onClick={() => onSelect(stage.id)}
      aria-pressed={isSelected}
      aria-label={`Stage ${stage.label}, status: ${stage.status}`}
    >
      <span className="pipeline-stage-icon">{stageStatusIcon(stage.status)}</span>
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

  return (
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
        <div className="node-detail-status">
          <span className={`pipeline-status-badge pipeline-status-badge--${stage.status}`}>
            {stage.status}
          </span>
        </div>
        <code className="eyebrow" style={{ display: "block", marginBottom: 12 }}>{stage.id}</code>

        {stage.gates.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>No gates defined for this stage.</p>
        )}

        {stage.gates.map((gate) => (
          <div key={gate.id} className="pipeline-gate-detail">
            <div className="pipeline-gate-detail-header">
              <code className="eyebrow">{gate.id}</code>
              <span className={`pipeline-gate-chip pipeline-gate-chip--${gate.status}`}>
                {gateStatusIcon(gate.status)} {gate.status}
              </span>
            </div>

            {gate.expects.length > 0 && (
              <ul className="pipeline-expects-list">
                {gate.expects.map((expect) => (
                  <li key={expect.id} className="pipeline-expect-item">
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

      {/* Visual stepper */}
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
      </div>

      {/* Drill-in drawer */}
      <PipelineStageDrawer stage={selectedStage} onClose={handleClose} />
    </div>
  );
}

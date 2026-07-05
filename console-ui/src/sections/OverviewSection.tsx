import { useMemo } from "react";
import type { OperatingState } from "@kontourai/console-core";
import type { ConsoleTelemetryResponse } from "../serverApiTypes";
import {
  deriveAttentionItems,
  deriveHealthCounts,
  type AttentionItem,
  type AttentionKind,
} from "./environment/derive";

// The unified operator home ("Overview"). This is the front door of the redesign: it answers
// "what needs me right now?" FIRST (triage), backed by an at-a-glance health strip, and links out
// to the detailed views for the full picture. It reuses environment/derive.ts's attention logic
// verbatim — the same items the Environment view computes, promoted from a buried tab to the hero.
//
// Slice 1 scope (this file): the "Needs you" triage + the at-a-glance strip. Subsequent slices fold
// "Happening now", "The fleet", and "What it's costing" into this same surface and retire the tabs.

export type OverviewTarget = "operate" | "telemetry" | "environment";

interface OverviewSectionProps {
  state: OperatingState;
  telemetry: ConsoleTelemetryResponse | null;
  liveStatus: string;
  onOpen: (target: OverviewTarget) => void;
}

// Present-tense, operator-facing framing for each attention kind: a severity tone (drives the
// accent stripe + kind label color), a plain-language headline, the primary action's verb, and
// which detail view that action opens. The system term stays available as the kind's own id.
const KIND_PRESENTATION: Record<
  AttentionKind,
  { tone: "negative" | "caution" | "active"; kind: string; action: string; target: OverviewTarget }
> = {
  "blocked-gate": { tone: "negative", kind: "gate blocked", action: "Inspect gate", target: "operate" },
  "stale-claim": { tone: "caution", kind: "claim going stale", action: "Review claim", target: "operate" },
  "long-running-process": { tone: "active", kind: "long-running", action: "Open process", target: "operate" },
  "quiet-source": { tone: "caution", kind: "source quiet", action: "Check source", target: "telemetry" },
};

export function OverviewSection({ state, telemetry, liveStatus, onOpen }: OverviewSectionProps) {
  const health = useMemo(() => deriveHealthCounts(state), [state]);
  const attention = useMemo(() => deriveAttentionItems(state, telemetry), [state, telemetry]);

  return (
    <div className="overview">
      {/* ── ① Needs you — triage leads ─────────────────────────────────────────── */}
      <section className="ov-section">
        <header className="ov-head">
          <h2 className="ov-title">Needs you</h2>
          <span className="ov-sub">
            {attention.length > 0
              ? `${attention.length} item${attention.length === 1 ? "" : "s"} · triage first`
              : "all clear"}
          </span>
          <span className="ov-grow" />
          <span className="ov-live" aria-live="polite">{liveStatus}</span>
        </header>

        {attention.length > 0 ? (
          <div className="triage">
            {attention.map((item) => (
              <TriageCard key={`${item.kind}:${item.id}`} item={item} onOpen={onOpen} />
            ))}
          </div>
        ) : (
          <div className="ov-allclear">
            <span className="ov-allclear-mark" aria-hidden="true">✓</span>
            <div>
              <h3 className="ov-allclear-title">Nothing needs your attention</h3>
              <p className="ov-allclear-body">No blocked gates, stale claims, long-running work, or quiet sources right now. New issues surface here the moment they appear.</p>
            </div>
          </div>
        )}
      </section>

      {/* ── At a glance — the health strip that used to head the Environment tab ──── */}
      <section className="ov-section">
        <header className="ov-head">
          <h2 className="ov-title">At a glance</h2>
          <span className="ov-sub">operating state</span>
          <span className="ov-grow" />
          <button type="button" className="ov-link" onClick={() => onOpen("operate")}>open the board →</button>
        </header>
        <div className="glance">
          <GlanceStat label="Active work" value={health.activeProcesses} onClick={() => onOpen("operate")} />
          <GlanceStat label="Gates passed" value={health.gatesPassed} tone="positive" />
          <GlanceStat label="Gates blocked" value={health.gatesBlocked} tone={health.gatesBlocked > 0 ? "negative" : undefined} onClick={() => onOpen("operate")} />
          <GlanceStat label="Claims verified" value={health.claimsOk} tone="positive" />
          <GlanceStat label="Claims at risk" value={health.claimsAtRisk + health.claimsStale} tone={health.claimsAtRisk + health.claimsStale > 0 ? "caution" : undefined} />
          <GlanceStat label="Open inquiries" value={health.openInquiries} onClick={() => onOpen("environment")} />
        </div>
      </section>

      {/* ── Where the rest is going (migration signposts, retired as slices land) ─── */}
      <section className="ov-section">
        <div className="ov-signposts">
          <SignpostCard
            title="Happening now"
            body="The live flow, current stage, and activity stream."
            cta="Open Operate"
            onClick={() => onOpen("operate")}
          />
          <SignpostCard
            title="The fleet"
            body="Who's working what — sessions, claims, and coordination state."
            cta="Coming next"
            disabled
          />
          <SignpostCard
            title="What it's costing"
            body="Spend, tokens, and usage by model, project, and agent."
            cta="Open usage"
            onClick={() => onOpen("telemetry")}
          />
        </div>
      </section>
    </div>
  );
}

function TriageCard({ item, onOpen }: { item: AttentionItem; onOpen: (t: OverviewTarget) => void }) {
  const p = KIND_PRESENTATION[item.kind];
  return (
    <article className={`tcard tone-${p.tone}`}>
      <div className="tcard-kind">{p.kind}</div>
      <h3 className="tcard-title">{item.label}</h3>
      <p className="tcard-detail">{item.detail}</p>
      <div className="tcard-actions">
        <button type="button" className="tcard-btn primary" onClick={() => onOpen(p.target)}>{p.action}</button>
      </div>
    </article>
  );
}

function GlanceStat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative" | "caution";
  onClick?: () => void;
}) {
  const className = `glance-stat${tone ? ` tone-${tone}` : ""}${onClick ? " is-link" : ""}`;
  const content = (
    <>
      <span className="glance-value">{value}</span>
      <span className="glance-label">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick}>{content}</button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function SignpostCard({
  title,
  body,
  cta,
  onClick,
  disabled,
}: {
  title: string;
  body: string;
  cta: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`signpost${disabled ? " is-disabled" : ""}`}>
      <h3 className="signpost-title">{title}</h3>
      <p className="signpost-body">{body}</p>
      <button type="button" className="signpost-cta" onClick={onClick} disabled={disabled}>{cta}</button>
    </div>
  );
}

import { useMemo } from "react";
import type { OperatingState } from "@kontourai/console-core";
import type { ConsoleTelemetryResponse } from "../serverApiTypes";
import {
  deriveAttentionItems,
  deriveHealthCounts,
  type AttentionItem,
  type AttentionKind,
} from "./environment/derive";
import { WorkerFleetSection } from "./WorkerFleetSection";
import { HappeningNowSection } from "./HappeningNowSection";
import { FleetSection } from "./FleetSection";
import { CostSection } from "./CostSection";

// The unified operator home ("Overview"). This is the front door of the redesign: it answers
// "what is the fleet of flow-agent workers doing right now?" FIRST (console#251's fleet grid),
// backed by a gate/claim/source triage and an at-a-glance health strip, and links out to the
// detailed views for the full picture.
//
// console#251: the fleet grid (WorkerFleetSection) is the one place every operating-state
// process renders as a card — with its stage, a relative last-activity timestamp, and a
// freshness tier — so "Needs you" below only carries triage items that are NOT a process
// (blocked gates, stale claims, quiet telemetry sources). Paused-run and long-running-process
// attention kinds used to double as a second, less-informative wall of process cards here; they
// are still computed by deriveAttentionItems (environment/derive.ts, also used by the retired
// Environment tab) but filtered out of this list so a given worker is represented exactly once.

export type OverviewTarget = "board" | "operate" | "telemetry";

interface OverviewSectionProps {
  state: OperatingState;
  telemetry: ConsoleTelemetryResponse | null;
  liveStatus: string;
  // `anchor` is an optional Operate WorkGrid node id ("<kind>:<id>") to scroll to
  // and highlight after switching views — so a "Needs you" card deep-links to the
  // exact item it names instead of the generic board (#135).
  onOpen: (target: OverviewTarget, anchor?: string) => void;
  /**
   * Fixed reference clock (epoch ms), threaded through to the fleet grid's
   * relative-time + freshness classification for deterministic rendering
   * (e.g. a test). Defaults to the real wall clock when omitted.
   */
  now?: number;
}

// Present-tense, operator-facing framing for each attention kind: a severity tone (drives the
// accent stripe + kind label color), a plain-language headline, the primary action's verb, and
// which detail view that action opens. The system term stays available as the kind's own id.
const KIND_PRESENTATION: Record<
  AttentionKind,
  { tone: "negative" | "caution" | "active"; kind: string; action: string; target: OverviewTarget }
> = {
  "paused-run": { tone: "caution", kind: "run paused", action: "Open the run", target: "operate" },
  "blocked-gate": { tone: "negative", kind: "gate blocked", action: "Inspect gate", target: "operate" },
  "stale-claim": { tone: "caution", kind: "claim going stale", action: "Review claim", target: "operate" },
  "long-running-process": { tone: "active", kind: "long-running", action: "Open process", target: "operate" },
  "quiet-source": { tone: "caution", kind: "source quiet", action: "Check source", target: "telemetry" },
};

// Attention kinds that describe a *process* — console#251's fleet grid already renders every
// process as its own card with a real timestamp and freshness tier, so these two kinds are
// dropped from "Needs you" to avoid rendering the same worker twice, once richly (the fleet
// grid) and once thinly (a triage card with no freshness signal and, for paused-run, no
// timestamp at all — see workers/derive.ts for the root cause).
const PROCESS_ATTENTION_KINDS = new Set<AttentionKind>(["paused-run", "long-running-process"]);

export function OverviewSection({ state, telemetry, liveStatus, onOpen, now }: OverviewSectionProps) {
  const health = useMemo(() => deriveHealthCounts(state), [state]);
  const attention = useMemo(
    () => deriveAttentionItems(state, telemetry).filter((item) => !PROCESS_ATTENTION_KINDS.has(item.kind)),
    [state, telemetry],
  );

  return (
    <div className="overview">
      {/* ── ① The fleet — every worker, at a glance (console#251) ─────────────────── */}
      <WorkerFleetSection state={state} now={now} />

      {/* ── ② Needs you — non-process triage (blocked gates, stale claims, quiet sources) ─ */}
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
              <p className="ov-allclear-body">No blocked gates, stale claims, or quiet sources right now. New issues surface here the moment they appear.</p>
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
          <button type="button" className="ov-link" onClick={() => onOpen("board")}>open the board →</button>
        </header>
        <div className="glance">
          <GlanceStat label="Active work" value={health.activeProcesses} onClick={() => onOpen("operate")} />
          <GlanceStat label="Gates passed" value={health.gatesPassed} tone="positive" />
          <GlanceStat label="Gates blocked" value={health.gatesBlocked} tone={health.gatesBlocked > 0 ? "negative" : undefined} onClick={() => onOpen("operate")} />
          <GlanceStat label="Claims verified" value={health.claimsOk} tone="positive" />
          <GlanceStat label="Claims at risk" value={health.claimsAtRisk + health.claimsStale} tone={health.claimsAtRisk + health.claimsStale > 0 ? "caution" : undefined} />
          <GlanceStat label="Open inquiries" value={health.openInquiries} onClick={() => onOpen("operate")} />
        </div>
      </section>

      {/* ── ③ Happening now — the live flow + activity ───────────────────────────── */}
      <HappeningNowSection state={state} onOpen={() => onOpen("board")} />

      {/* ── ④ Sessions — who's active (coordination state arrives with #295) ─────── */}
      <FleetSection
        telemetry={telemetry}
        liveSessions={state.actors}
        reclaimableSessions={state.reclaimableActors}
        onOpen={() => onOpen("telemetry")}
      />

      {/* ── ⑤ What it's costing — usage & economics ──────────────────────────────── */}
      <CostSection telemetry={telemetry} onOpen={() => onOpen("telemetry")} />
    </div>
  );
}

function TriageCard({ item, onOpen }: { item: AttentionItem; onOpen: (t: OverviewTarget, anchor?: string) => void }) {
  const p = KIND_PRESENTATION[item.kind];
  return (
    <article className={`tcard tone-${p.tone}`}>
      <div className="tcard-kind">{p.kind}</div>
      <h3 className="tcard-title">{item.label}</h3>
      <p className="tcard-detail">{item.detail}</p>
      <div className="tcard-actions">
        <button type="button" className="tcard-btn primary" onClick={() => onOpen(p.target, item.anchor)}>{p.action}</button>
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

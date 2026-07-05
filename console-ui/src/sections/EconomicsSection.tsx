import { useState } from "react";
import { Badge, Empty, Metric } from "@kontourai/ui/react";
import { formatTime } from "../utils/format";
import type {
  ConsoleEconomicsRollup,
  ConsoleEconomicsDelegationRollup,
  ConsoleValueCell,
  ConsoleValueComparison
} from "../serverApiTypes";
import {
  cellLabel,
  costIsProxy,
  formatPct,
  formatUsd,
  hasHeadline,
  hasTaggedRuns,
  isEmptyDelegations,
  isEmptyEconomics,
  outcomeCoverageRate,
  outcomeNotMeasurable,
  outcomeSummary,
  roleModelRows,
  sharedModels,
  taskTotals,
  taskTrend,
  tasksInRollup,
  verdictLabel
} from "./economics/derive";

type EconomicsView = "value" | "cost" | "defects" | "funnel" | "delegation";

export interface EconomicsSectionProps {
  rollup: ConsoleEconomicsRollup | null;
  value: ConsoleValueComparison | null;
  delegations: ConsoleEconomicsDelegationRollup | null;
  error: string | null;
  liveStatus: string;
  lastLiveAt: string | null;
}

// Empty-state honesty (ADR 0003): before any economics record lands, say plainly
// that the value proof depends on the harness runs — do not imply a zero.
const EMPTY_COPY =
  "No economics recorded yet. Runs emit these once the kit-economics relay is configured; " +
  "the value comparison needs harness runs (flow-agents #350) against the independent oracle.";

export function EconomicsSection({ rollup, value, delegations, error, liveStatus, lastLiveAt }: EconomicsSectionProps) {
  const [view, setView] = useState<EconomicsView>("value");
  const empty = isEmptyEconomics(rollup);

  return (
    <section className="economics-section" aria-label="Economics">
      <div className="section-head">
        <div>
          <p className="section-label">Economics</p>
          <h2>The ROI surface: does the scaffolding pay for itself?</h2>
        </div>
        <p className="receipt">
          {liveStatus} / {lastLiveAt ? `live ${formatTime(lastLiveAt)}` : rollup?.generatedAt ? `refreshed ${formatTime(rollup.generatedAt)}` : "waiting"}
        </p>
      </div>

      {error ? <div className="notice economics-notice">{error}</div> : null}

      <nav className="economics-tabs" aria-label="Economics views">
        <button type="button" className={view === "value" ? "active" : ""} onClick={() => setView("value")}>Value</button>
        <button type="button" className={view === "cost" ? "active" : ""} onClick={() => setView("cost")}>Cost</button>
        <button type="button" className={view === "defects" ? "active" : ""} onClick={() => setView("defects")}>Caught defects</button>
        <button type="button" className={view === "funnel" ? "active" : ""} onClick={() => setView("funnel")}>Funnel</button>
        <button type="button" className={view === "delegation" ? "active" : ""} onClick={() => setView("delegation")}>Delegation efficiency</button>
      </nav>

      {empty ? (
        <Empty label={EMPTY_COPY} className="economics-empty" />
      ) : view === "value" ? (
        <ValueView value={value} />
      ) : view === "cost" ? (
        <CostView rollup={rollup} />
      ) : view === "defects" ? (
        <DefectsView rollup={rollup} />
      ) : view === "delegation" ? (
        <DelegationEfficiencyView delegations={delegations} />
      ) : (
        <FunnelView rollup={rollup} />
      )}
    </section>
  );
}

// ── Value card: small+kit vs large-bare — the headline claim (ADR 0003 call 4). ─
function ValueView({ value }: { value: ConsoleValueComparison | null }) {
  // The value matrix needs the OPTIONAL #350 harness tags. Base #349 records may
  // be flowing (visible in Cost/Defects/Funnel) while no tagged runs exist yet —
  // say so honestly rather than showing an empty grid.
  if (!hasTaggedRuns(value)) {
    return <Empty label="No tagged harness runs yet — the value comparison needs the baseline harness (flow-agents #350) to emit records tagged with {model_tier}×{kit_condition}. Base economics still appear under Cost, Caught defects, and Funnel." />;
  }
  if (!value || value.cells.length === 0) {
    return <Empty label="No matched runs yet — the value comparison needs harness runs across {small,large}×{bare,+kit}." />;
  }
  const { smallPlusKit, largeBare, ratio } = value.headline;

  return (
    <div className="economics-value">
      <div className="economics-headline" aria-label="Value headline">
        <p className="section-label">Headline</p>
        <p className="economics-verdict">
          {verdictLabel(value)}
          {hasHeadline(value) && ratio ? <Badge value={`${ratio.toFixed(2)}× cost per acceptable`} tone={verdictTone(value.headline.verdict)} /> : null}
        </p>
        <div className="economics-headline-cells">
          <HeadlineCell title="small + kit" cell={smallPlusKit} highlight />
          <HeadlineCell title="large — bare" cell={largeBare} />
        </div>
        <p className="economics-oracle-note">
          Acceptance is the independent kontourai/evals oracle&rsquo;s verdict, rendered verbatim — never re-derived from kit gates.
        </p>
      </div>

      <div className="economics-usage-breakdown" aria-label="Value by (model tier, kit condition)">
        <h4>By model tier &amp; kit condition</h4>
        <div className="economics-table-scroll">
          <table>
            <thead>
              <tr>
                <th>tier · condition</th>
                <th>runs</th>
                <th>acceptance</th>
                <th>iters/accept</th>
                <th>defects</th>
                <th>$/acceptable</th>
              </tr>
            </thead>
            <tbody>
              {value.cells.map((cell) => (
                <tr key={cellLabel(cell)}>
                  <td>{cellLabel(cell)}</td>
                  <td>{cell.runs}</td>
                  <td>{formatPct(cell.acceptanceRate)}</td>
                  <td>{cell.iterationsToAccept.toFixed(2)}</td>
                  <td>{cell.defectsCaught}</td>
                  <td>{formatUsd(cell.dollarsPerAcceptable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HeadlineCell({ title, cell, highlight }: { title: string; cell: ConsoleValueCell | null; highlight?: boolean }) {
  return (
    <div className={`economics-headline-cell${highlight ? " highlight" : ""}`}>
      <p className="section-label">{title}</p>
      {cell ? (
        <div className="economics-metrics">
          <Metric label="$/acceptable" value={formatUsd(cell.dollarsPerAcceptable)} />
          <Metric label="acceptance" value={formatPct(cell.acceptanceRate)} />
          <Metric label="defects caught" value={cell.defectsCaught} />
        </div>
      ) : (
        <Empty label="no runs in this cell yet" />
      )}
    </div>
  );
}

function verdictTone(verdict: ConsoleValueComparison["headline"]["verdict"]): "positive" | "caution" | "negative" | "neutral" {
  if (verdict === "exceeds") return "positive";
  if (verdict === "meets") return "positive";
  if (verdict === "below") return "negative";
  return "neutral";
}

// ── Cost view: per-task cost trend, defect count on the SAME card (R5). ─────────
//    (#349 base records carry no `kit`; task_slug is the per-run join dimension.)
function CostView({ rollup }: { rollup: ConsoleEconomicsRollup | null }) {
  const tasks = tasksInRollup(rollup);
  if (!rollup || tasks.length === 0) return <Empty label="No cost recorded yet." />;
  return (
    <div className="economics-cost">
      <div className="economics-metrics" aria-label="Cost totals">
        {taskTotals(rollup).map((t) => (
          <Metric key={t.taskSlug} label={`${t.taskSlug} · ${t.runs} runs · ${t.defectsCaught} caught`} value={formatUsd(t.totalCostUsd)} />
        ))}
      </div>
      {tasks.map((task) => (
        <div key={task} className="economics-usage-breakdown" aria-label={`Cost trend: ${task}`}>
          <h4>{task} — cost per day (with defects caught)</h4>
          <TrendBars rollup={rollup} taskSlug={task} />
          <div className="economics-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>day</th>
                  <th>runs</th>
                  <th>cost</th>
                  <th>defects caught</th>
                  <th>false completions</th>
                  <th>phases</th>
                </tr>
              </thead>
              <tbody>
                {taskTrend(rollup, task).map((row) => (
                  <tr key={row.day}>
                    <td>{row.day}</td>
                    <td>{row.runs}</td>
                    <td>{formatUsd(row.totalCostUsd)}</td>
                    <td>{row.defectsCaught}</td>
                    <td>{row.caughtFalseCompletions}</td>
                    <td className="economics-phases">
                      {Object.entries(row.costByPhase).map(([phase, usd]) => (
                        <span key={phase} className={`economics-phase${phase === "unattributed" ? " unattributed" : ""}`}>{phase} {formatUsd(usd)}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Token-styled SVG bar chart (no chart dep). Cost per day for one task_slug. */
function TrendBars({ rollup, taskSlug }: { rollup: ConsoleEconomicsRollup; taskSlug: string }) {
  const rows = taskTrend(rollup, taskSlug);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.totalCostUsd), 0.0001);
  const barWidth = 40;
  const gap = 16;
  const height = 120;
  const width = rows.length * (barWidth + gap) + gap;
  return (
    <svg className="economics-chart" role="img" aria-label={`${taskSlug} cost per day`} viewBox={`0 0 ${width} ${height + 28}`} width="100%" preserveAspectRatio="xMinYMin meet">
      {rows.map((row, i) => {
        const barHeight = Math.round((row.totalCostUsd / max) * height);
        const x = gap + i * (barWidth + gap);
        const y = height - barHeight;
        return (
          <g key={row.day}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={3} fill="var(--k-accent, #5ce0c6)" />
            <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" fontSize="10" fill="currentColor">{formatUsd(row.totalCostUsd)}</text>
            <text x={x + barWidth / 2} y={height + 14} textAnchor="middle" fontSize="9" fill="currentColor">{row.day.slice(5)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Caught-defects view (R3: caught_false_completions surfaced distinctly). ─────
function DefectsView({ rollup }: { rollup: ConsoleEconomicsRollup | null }) {
  if (!rollup) return <Empty label="No defect data yet." />;
  const { defectsCaught, caughtFalseCompletions, gateFires, bySeverity } = rollup.caughtDefects;
  return (
    <div className="economics-defects">
      <div className="economics-metrics" aria-label="Caught defects">
        <Metric label="defects caught (pre-merge)" value={defectsCaught} />
        <Metric label="caught false completions" value={caughtFalseCompletions} />
        <Metric label="gate fires" value={gateFires} />
        <Metric label="runs" value={rollup.runCount} />
      </div>
      <div className="economics-metrics" aria-label="Findings by severity">
        <Metric label="critical" value={bySeverity.critical} />
        <Metric label="high" value={bySeverity.high} />
        <Metric label="medium" value={bySeverity.medium} />
        <Metric label="low" value={bySeverity.low} />
      </div>
      <p className="economics-oracle-note">
        Caught false completions are claimed passes contradicted by a trusted backstop — the strongest ROI evidence, counted distinctly.
      </p>
    </div>
  );
}

// ── Delegation efficiency (flow-agents #415, part 4). ──────────────────────────
//    THE HONESTY RULES ARE THE POINT:
//    • Cost is a MODEL-GRANULARITY PROXY (no runtime isolates per-sub-agent tokens)
//      — the cost column is explicitly labelled, never presented as exact spend.
//    • `unavailable` outcomes are NOT accepted and NOT failed — the projection
//      already excludes them from acceptance; we surface them as coverage.
//    • Signals-gated: when the harness can't measure outcomes we render
//      "outcome not measurable on this harness", never a misleading 0%.
function DelegationEfficiencyView({ delegations }: { delegations: ConsoleEconomicsDelegationRollup | null }) {
  if (isEmptyDelegations(delegations) || !delegations) {
    return <Empty label="No delegations recorded yet — runs that delegate to sub-agents (flow-agents #415) populate this once the harness emits the delegations block." />;
  }
  const notMeasurable = outcomeNotMeasurable(delegations);
  const proxy = costIsProxy(delegations);
  const coverageRate = outcomeCoverageRate(delegations);
  const shared = sharedModels(delegations);
  const rows = roleModelRows(delegations);

  return (
    <div className="economics-delegation">
      <div className="economics-metrics" aria-label="Delegation coverage">
        <Metric label="delegation runs" value={delegations.runCount} />
        <Metric label="measurable outcomes" value={delegations.coverage.measurable} />
        <Metric label="unavailable (not measurable)" value={delegations.coverage.unavailable} />
        <Metric label="outcome coverage" value={coverageRate === null ? "n/a" : formatPct(coverageRate)} />
      </div>

      {/* Signals-gated honesty banner (rule 3). */}
      {notMeasurable ? (
        <div className="notice economics-notice" role="status">
          Outcome not measurable on this harness (per_delegation_outcome = {delegations.signals.perDelegationOutcome}).
          Acceptance is shown as n/a rather than a misleading 0%.
        </div>
      ) : null}

      <div className="economics-usage-breakdown" aria-label="Delegation efficiency by (role, model)">
        <h4>
          By role &amp; model
          {proxy ? <Badge value="cost: model-granularity (proxy)" tone="caution" /> : null}
        </h4>
        <p className="economics-oracle-note">
          Cost is a MODEL-GRANULARITY PROXY joined from <code>cost.by_model</code> by resolved model — no runtime
          isolates per-sub-agent tokens (<code>per_delegation_tokens = {String(delegations.signals.perDelegationTokens)}</code>),
          so it is never exact per-delegation spend. <strong>unavailable</strong> outcomes are excluded from acceptance
          (neither accepted nor failed) and reported as coverage.
        </p>
        <div className="economics-table-scroll">
          <table>
            <thead>
              <tr>
                <th>role · model</th>
                <th>delegations</th>
                <th>outcomes</th>
                <th>acceptance</th>
                <th>unavailable</th>
                <th>cost (proxy)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.role}\t${row.model}`}>
                  <td>
                    {row.role} · {row.model}
                    {shared.includes(row.model) ? <span className="economics-phase unattributed"> shared model</span> : null}
                  </td>
                  <td>{row.delegations}</td>
                  <td>{outcomeSummary(row)}</td>
                  <td>{row.acceptanceRate === null ? "n/a" : formatPct(row.acceptanceRate)}</td>
                  <td>{row.unavailableCount}</td>
                  <td>{formatUsd(row.costUsd)}<span className="economics-proxy-tag"> proxy</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shared.length ? (
          <p className="economics-oracle-note">
            Groups sharing a model ({shared.join(", ")}) each carry that model&rsquo;s full cost — the proxy does not
            split a shared model across roles (inherent model-granularity imprecision).
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Funnel view (R4: iterations, route-backs, first-pass rate). ────────────────
function FunnelView({ rollup }: { rollup: ConsoleEconomicsRollup | null }) {
  if (!rollup) return <Empty label="No funnel data yet." />;
  const f = rollup.funnel;
  return (
    <div className="economics-funnel">
      <div className="economics-metrics" aria-label="Funnel">
        <Metric label="runs" value={f.runs} />
        <Metric label="total iterations" value={f.totalIterations} />
        <Metric label="route-backs" value={f.totalRouteBacks} />
        <Metric label="first-pass rate" value={formatPct(f.firstPassRate)} />
        <Metric label="human-wait" value={`${Math.round(f.humanWaitS)}s`} />
      </div>
    </div>
  );
}

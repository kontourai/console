import { formatTime } from "../../utils/format";
import type { FocusEntry } from "./focus";
import { isFilterActive } from "./queryModel";
import type { TelemetryFilter } from "./types";

interface TelemetryFocusProps {
  focus: FocusEntry[];
  filters: TelemetryFilter[];
  onToggleFilter(filter: TelemetryFilter): void;
}

function FocusCardBody({ entry }: { entry: FocusEntry }) {
  return (
    <>
      <span className="focus-project">{entry.project}</span>
      <span className="focus-metrics">
        <span><strong>{entry.eventCount}</strong> events</span>
        <span><strong>{entry.sessionCount}</strong> sessions</span>
        {entry.lastAt ? <span>last {formatTime(entry.lastAt)}</span> : null}
      </span>
      {entry.tools.length ? (
        <span className="focus-tools">
          {entry.tools.slice(0, 3).map((tool) => (
            <span className="focus-tool" key={tool.name}>{tool.name} &times;{tool.count}</span>
          ))}
        </span>
      ) : null}
    </>
  );
}

// "What you're working on" — leads the Telemetry page with meaning (per-project
// activity) before the raw dimension grid. Clicking a project scopes the whole view
// to it (the console#183 dimensional pivot, reusing the existing "projects" facet
// filter); a second click clears the scope. The "unattributed" bucket has no real
// project value to filter on, so it's shown as a non-interactive card.
export function TelemetryFocus({ focus, filters, onToggleFilter }: TelemetryFocusProps) {
  if (!focus.length) return null;
  return (
    <section className="telemetry-focus" aria-label="Focus">
      <p className="section-label">Focus</p>
      <h3 className="telemetry-focus-title">What you&rsquo;re working on</h3>
      <div className="focus-grid">
        {focus.map((entry) => {
          if (entry.unattributed) {
            return (
              <div key={entry.project} className="focus-card focus-card--static" aria-label="Unattributed activity (cannot scope)">
                <FocusCardBody entry={entry} />
              </div>
            );
          }
          const active = isFilterActive(filters, "projects", entry.project);
          return (
            <button
              key={entry.project}
              type="button"
              className={`focus-card${active ? " active" : ""}`}
              aria-pressed={active}
              onClick={() => onToggleFilter({ facetId: "projects", label: "Projects", value: entry.project })}
              aria-label={`${active ? "Clear scope" : "Scope telemetry to"} ${entry.project}`}
            >
              <FocusCardBody entry={entry} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

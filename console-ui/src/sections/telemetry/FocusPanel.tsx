import type { FocusEntry } from "./focus";
import type { TelemetryFilter } from "./types";

interface TelemetryFocusProps {
  focus: FocusEntry[];
  onToggleFilter(filter: TelemetryFilter): void;
}

// "What you're working on" — leads the Telemetry page with meaning (per-project
// activity: events, sessions, files touched, tools) before the raw dimension grid.
// Clicking a project scopes the whole view to it — the console#183 dimensional
// pivot, reusing the existing "projects" facet filter.
export function TelemetryFocus({ focus, onToggleFilter }: TelemetryFocusProps) {
  if (!focus.length) return null;
  return (
    <section className="telemetry-focus" aria-label="Focus">
      <p className="section-label">Focus</p>
      <h3 className="telemetry-focus-title">What you&rsquo;re working on</h3>
      <div className="focus-grid">
        {focus.map((entry) => (
          <button
            key={entry.project}
            type="button"
            className="focus-card"
            onClick={() => onToggleFilter({ facetId: "projects", label: "Projects", value: entry.project })}
            aria-label={`Scope telemetry to ${entry.project}`}
          >
            <span className="focus-project">{entry.project}</span>
            <span className="focus-metrics">
              <span><strong>{entry.eventCount}</strong> events</span>
              <span><strong>{entry.sessionCount}</strong> sessions</span>
              <span><strong>{entry.files.length}</strong> files</span>
            </span>
            {entry.tools.length ? (
              <span className="focus-tools">
                {entry.tools.slice(0, 3).map((tool) => (
                  <span className="focus-tool" key={tool.name}>{tool.name} &times;{tool.count}</span>
                ))}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}

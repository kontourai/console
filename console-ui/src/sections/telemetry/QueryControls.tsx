import type { FormEvent } from "react";
import type { TelemetryQueryInput, TelemetryQueryPreset } from "../../serverApiTypes";
import type { TelemetryQueryControlState } from "./types";

export function TelemetryQueryControls({
  query,
  controls
}: {
  query: TelemetryQueryInput;
  controls: TelemetryQueryControlState;
}) {
  return (
    <div className="telemetry-query-controls" aria-label="Telemetry query controls">
      <TelemetryPresetButtons query={query} controls={controls} />
      <TelemetryCustomRange controls={controls} />
      <TelemetrySearch controls={controls} />
    </div>
  );
}

function TelemetryPresetButtons({ query, controls }: { query: TelemetryQueryInput; controls: TelemetryQueryControlState }) {
  const presets: Array<{ id: TelemetryQueryPreset; label: string }> = [
    { id: "live", label: "Realtime" },
    { id: "15m", label: "Last 15m" },
    { id: "24h", label: "24h" },
    { id: "7d", label: "7d" },
  ];
  return (
    <div className="segmented-control" aria-label="Time window">
      {presets.map((preset) => (
        <button type="button" key={preset.id} className={query.preset === preset.id ? "active" : ""} aria-pressed={query.preset === preset.id} onClick={() => applyPreset(controls, preset.id)}>
          {preset.label}
        </button>
      ))}
    </div>
  );
}

function TelemetryCustomRange({ controls }: { controls: TelemetryQueryControlState }) {
  return (
    <form className="telemetry-custom-range" onSubmit={(event) => submitCustomRange(event, controls)}>
      <label>From<input type="datetime-local" value={controls.fromDraft} onChange={(event) => controls.setFromDraft(event.target.value)} /></label>
      <label>To<input type="datetime-local" value={controls.toDraft} onChange={(event) => controls.setToDraft(event.target.value)} /></label>
      <button type="submit" aria-pressed={controls.query.preset === "custom"}>Custom</button>
    </form>
  );
}

function TelemetrySearch({ controls }: { controls: TelemetryQueryControlState }) {
  return (
    <form className="telemetry-search" onSubmit={(event) => submitSearch(event, controls)}>
      <label htmlFor="telemetry-search">Search</label>
      <input id="telemetry-search" value={controls.searchDraft} onChange={(event) => controls.setSearchDraft(event.target.value)} />
      <button type="submit">Apply</button>
    </form>
  );
}

function applyPreset(controls: TelemetryQueryControlState, preset: TelemetryQueryPreset): void {
  const next: TelemetryQueryInput = { ...controls.query, preset, offset: 0 };
  if (preset !== "custom") {
    next.from = undefined;
    next.to = undefined;
    controls.setFromDraft("");
    controls.setToDraft("");
  }
  controls.onQueryChange(next);
}

function submitSearch(event: FormEvent<HTMLFormElement>, controls: TelemetryQueryControlState): void {
  event.preventDefault();
  controls.onQueryChange({ ...controls.query, q: controls.searchDraft.trim() || undefined, offset: 0 });
}

function submitCustomRange(event: FormEvent<HTMLFormElement>, controls: TelemetryQueryControlState): void {
  event.preventDefault();
  controls.onQueryChange({
    ...controls.query,
    preset: "custom",
    from: controls.fromDraft ? new Date(controls.fromDraft).toISOString() : undefined,
    to: controls.toDraft ? new Date(controls.toDraft).toISOString() : undefined,
    offset: 0
  });
}

import type { FormEvent } from "react";
import { useState } from "react";
import type { TelemetryQueryInput } from "../../serverApiTypes";
import { isTelemetryQueryInput, normalizeTelemetryQuery } from "../../utils/telemetryQuery";

interface SavedTelemetryPreset {
  version: 1;
  name: string;
  query: TelemetryQueryInput;
  createdAt: string;
  updatedAt: string;
}

const SAVED_PRESETS_KEY = "kontour.console.telemetry.presets.v1";
const MAX_SAVED_PRESETS = 12;
const MAX_PRESET_NAME_LENGTH = 48;

export function TelemetrySavedPresets({ query, onQueryChange }: { query: TelemetryQueryInput; onQueryChange(query: TelemetryQueryInput): void }) {
  const [presets, setPresets] = useState<SavedTelemetryPreset[]>(loadSavedPresets);
  const [name, setName] = useState("");
  function persist(nextPresets: SavedTelemetryPreset[]) {
    setPresets(nextPresets);
    try {
      window.localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(nextPresets));
    } catch {
      // Storage can be unavailable in private/browser-restricted contexts; keep the in-memory preset list usable.
    }
  }
  function saveCurrent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim().slice(0, MAX_PRESET_NAME_LENGTH);
    if (!trimmed) return;
    const now = new Date().toISOString();
    const existing = presets.find((preset) => preset.name.toLowerCase() === trimmed.toLowerCase());
    const nextPreset: SavedTelemetryPreset = {
      version: 1,
      name: trimmed,
      query: normalizeTelemetryQuery(query),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    persist([nextPreset, ...presets.filter((preset) => preset.name.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_SAVED_PRESETS));
    setName("");
  }
  return (
    <div className="telemetry-saved-presets" aria-label="Saved telemetry presets">
      <form onSubmit={saveCurrent}>
        <label htmlFor="telemetry-preset-name">Preset</label>
        <input id="telemetry-preset-name" value={name} maxLength={MAX_PRESET_NAME_LENGTH} onChange={(event) => setName(event.target.value)} />
        <button type="submit">Save</button>
      </form>
      <div className="telemetry-preset-list">
        {presets.map((preset) => (
          <span key={preset.name}>
            <button type="button" onClick={() => onQueryChange(normalizeTelemetryQuery(preset.query))}>{preset.name}</button>
            <button type="button" aria-label={`Delete preset ${preset.name}`} onClick={() => persist(presets.filter((item) => item.name !== preset.name))}>Delete</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function loadSavedPresets(): SavedTelemetryPreset[] {
  try {
    const raw = window.localStorage.getItem(SAVED_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedPreset).slice(0, MAX_SAVED_PRESETS);
  } catch {
    return [];
  }
}

function isSavedPreset(value: unknown): value is SavedTelemetryPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Partial<SavedTelemetryPreset>;
  return preset.version === 1
    && typeof preset.name === "string"
    && preset.name.length > 0
    && preset.name.length <= MAX_PRESET_NAME_LENGTH
    && typeof preset.createdAt === "string"
    && typeof preset.updatedAt === "string"
    && isTelemetryQueryInput(preset.query);
}

import type { ConsoleTelemetryResponse } from "../../serverApiTypes";

export function TelemetryWarnings({ telemetry }: { telemetry: ConsoleTelemetryResponse | null }) {
  if (!telemetry?.warnings.length) return null;
  return (
    <div className="telemetry-warnings">
      {telemetry.warnings.map((warning) => <p key={`${warning.path}:${warning.message}`}>{warning.message || warning.path}</p>)}
    </div>
  );
}

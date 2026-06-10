import type { TelemetryQueryInput } from "../../serverApiTypes";
import { parseTelemetryRoute } from "../../utils/telemetryQuery";
import { queryString, stripFilter } from "./queryModel";
import { startCase } from "./text";
import type { TelemetryRouteState } from "./types";

export function TelemetryDrilldownHeader({
  drilldown,
  query,
  onOpenRoute
}: {
  drilldown: NonNullable<TelemetryRouteState["drilldown"]>;
  query: TelemetryQueryInput;
  onOpenRoute(route: TelemetryRouteState): void;
}) {
  return (
    <div className="telemetry-drilldown" aria-label="Telemetry drilldown">
      <div>
        <span>{startCase(drilldown.dimension)}</span>
        <strong>{drilldown.value}</strong>
      </div>
      <button type="button" onClick={() => onOpenRoute(parseTelemetryRoute("/telemetry", queryString(stripFilter(query, drilldown.dimension, drilldown.value))))}>All telemetry</button>
    </div>
  );
}

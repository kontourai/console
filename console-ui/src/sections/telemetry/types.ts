import type { ConsoleTelemetryResponse, TelemetryQueryFilter, TelemetryQueryInput } from "../../serverApiTypes";
import type { TelemetryRouteState as RouteState } from "../../utils/telemetryQuery";

export interface TelemetrySectionProps {
  telemetry: ConsoleTelemetryResponse | null;
  error: string | null;
  query: TelemetryQueryInput;
  drilldown?: TelemetryRouteStateDrilldown;
  onQueryChange(query: TelemetryQueryInput): void;
  onOpenRoute(route: RouteState): void;
  liveStatus: string;
  lastLiveAt?: string | null;
}

export interface TelemetryFilter extends TelemetryQueryFilter {
  facetId: string;
  label: string;
  value: string;
}

export interface TelemetryQueryControlState {
  query: TelemetryQueryInput;
  searchDraft: string;
  fromDraft: string;
  toDraft: string;
  setSearchDraft(value: string): void;
  setFromDraft(value: string): void;
  setToDraft(value: string): void;
  onQueryChange(query: TelemetryQueryInput): void;
}

export type TelemetryRouteState = RouteState;
export type TelemetryRouteStateDrilldown = RouteState["drilldown"];

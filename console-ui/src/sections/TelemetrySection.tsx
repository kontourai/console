import { useMemo } from "react";
import { formatTime } from "../utils/format";
import { TelemetryDrilldownHeader } from "./telemetry/DrilldownHeader";
import { TelemetryFilterBar } from "./telemetry/FilterBar";
import { telemetryFacets } from "./telemetry/facets";
import { deriveFocusMap } from "./telemetry/focus";
import { TelemetryFocus } from "./telemetry/FocusPanel";
import { TelemetryGrid } from "./telemetry/Grid";
import { labelFilters } from "./telemetry/queryModel";
import { TelemetryQueryControls } from "./telemetry/QueryControls";
import { RecentTelemetryEvents } from "./telemetry/RecentEvents";
import { TelemetrySavedPresets } from "./telemetry/SavedPresets";
import { TelemetryTotals } from "./telemetry/Totals";
import type { TelemetrySectionProps } from "./telemetry/types";
import { useTelemetryQueryActions } from "./telemetry/useTelemetryQueryActions";
import { TelemetryWarnings } from "./telemetry/Warnings";

export function TelemetrySection({ telemetry, error, query, drilldown, onQueryChange, onOpenRoute, liveStatus, lastLiveAt }: TelemetrySectionProps) {
  const allEvents = telemetry?.records || [];
  const filters = useMemo(() => labelFilters(query.filters || [], telemetry), [query.filters, telemetry]);
  const facets = useMemo(() => telemetryFacets(telemetry, allEvents), [telemetry, allEvents]);
  const focus = useMemo(() => deriveFocusMap(allEvents), [allEvents]);
  const pagination = telemetry?.pagination;
  const matchedCount = pagination?.matchedCount ?? pagination?.totalMatchedCount ?? pagination?.totalCount ?? allEvents.length;
  const returnedCount = pagination?.returnedCount ?? allEvents.length;
  const actions = useTelemetryQueryActions(query, onQueryChange, pagination);

  const canPageForward = Boolean(pagination?.hasMore || typeof pagination?.nextOffset === "number");
  const canPageBack = (pagination?.offset ?? query.offset ?? 0) > 0;

  return (
    <section className="telemetry-section" aria-label="Telemetry">
      <div className="section-head">
        <div>
          <p className="section-label">Telemetry</p>
          <h2>Runtime and workflow usage</h2>
        </div>
        <p className="receipt">
          {liveStatus} / {lastLiveAt ? `live ${formatTime(lastLiveAt)}` : telemetry?.generatedAt ? `refreshed ${formatTime(telemetry.generatedAt)}` : "waiting"}
        </p>
      </div>

      {error ? <div className="notice telemetry-notice">{error}</div> : null}

      <TelemetryQueryControls
        query={query}
        controls={actions.controls}
      />
      <TelemetrySavedPresets query={query} onQueryChange={onQueryChange} />
      {drilldown ? <TelemetryDrilldownHeader drilldown={drilldown} onOpenRoute={onOpenRoute} query={query} /> : null}
      <TelemetryTotals telemetry={telemetry} />
      <TelemetryFocus focus={focus} onToggleFilter={actions.toggleFilter} />
      <TelemetryFilterBar
        filters={filters}
        shownCount={returnedCount}
        totalCount={matchedCount}
        query={query}
        onRemove={actions.removeFilter}
        onClear={actions.clearQuery}
        drilldown={drilldown}
        onOpenRoute={onOpenRoute}
      />
      <TelemetryGrid
        telemetry={telemetry}
        facets={facets}
        filters={filters}
        onToggleFilter={actions.toggleFilter}
        onOpenRoute={onOpenRoute}
        query={query}
      />
      <RecentTelemetryEvents
        events={allEvents}
        totalEvents={matchedCount}
        canPageBack={canPageBack}
        canPageForward={canPageForward}
        onPreviousPage={actions.previousPage}
        onNextPage={actions.nextPage}
      />
      <TelemetryWarnings telemetry={telemetry} />
    </section>
  );
}

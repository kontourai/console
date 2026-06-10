import { useEffect, useState } from "react";
import type { ConsoleTelemetryResponse, TelemetryQueryInput } from "../../serverApiTypes";
import { removeQueryFilter, toDatetimeLocalValue, toggleQueryFilter } from "./queryModel";
import type { TelemetryFilter } from "./types";

export function useTelemetryQueryActions(
  query: TelemetryQueryInput,
  onQueryChange: (query: TelemetryQueryInput) => void,
  pagination: ConsoleTelemetryResponse["pagination"] | undefined
) {
  const [searchDraft, setSearchDraft] = useState(query.q || "");
  const [fromDraft, setFromDraft] = useState(toDatetimeLocalValue(query.from));
  const [toDraft, setToDraft] = useState(toDatetimeLocalValue(query.to));
  useEffect(() => setSearchDraft(query.q || ""), [query.q]);
  useEffect(() => setFromDraft(toDatetimeLocalValue(query.from)), [query.from]);
  useEffect(() => setToDraft(toDatetimeLocalValue(query.to)), [query.to]);
  return {
    controls: { searchDraft, fromDraft, toDraft, setSearchDraft, setFromDraft, setToDraft, onQueryChange, query },
    toggleFilter: (filter: TelemetryFilter) => onQueryChange(toggleQueryFilter(query, filter)),
    removeFilter: (filter: TelemetryFilter) => onQueryChange(removeQueryFilter(query, filter)),
    clearQuery: () => {
      setSearchDraft("");
      setFromDraft("");
      setToDraft("");
      onQueryChange({ preset: "live", limit: query.limit || 24, sort: query.sort || "desc" });
    },
    nextPage: () => {
      if (typeof pagination?.nextOffset === "number") onQueryChange({ ...query, offset: pagination.nextOffset });
    },
    previousPage: () => {
      const limit = pagination?.limit || pagination?.pageSize || query.limit || 24;
      const currentOffset = pagination?.offset ?? query.offset ?? 0;
      onQueryChange({ ...query, offset: Math.max(0, currentOffset - limit) });
    }
  };
}

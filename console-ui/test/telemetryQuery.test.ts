import assert from "node:assert/strict";
import test from "node:test";
import { parseTelemetryRoute, serializeTelemetryRoute } from "../src/utils/telemetryQuery";

test("telemetry route parsing preserves explicit date ranges as custom queries", () => {
  const route = parseTelemetryRoute(
    "/telemetry",
    "?from=2026-06-08T14%3A00%3A00.000Z&to=2026-06-08T15%3A00%3A00.000Z"
  );

  assert.equal(route.query.preset, "custom");
  assert.equal(route.query.from, "2026-06-08T14:00:00.000Z");
  assert.equal(route.query.to, "2026-06-08T15:00:00.000Z");
  assert.equal(serializeTelemetryRoute(route.query), "/telemetry?preset=custom&from=2026-06-08T14%3A00%3A00.000Z&to=2026-06-08T15%3A00%3A00.000Z");
});

test("telemetry route parsing lets explicit date ranges override non-custom presets", () => {
  const route = parseTelemetryRoute(
    "/telemetry",
    "?preset=24h&from=2026-06-08T14%3A00%3A00.000Z"
  );

  assert.equal(route.query.preset, "custom");
  assert.equal(route.query.from, "2026-06-08T14:00:00.000Z");
});

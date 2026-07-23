import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAppRoute,
  serializeBoardPath,
  serializeEconomicsPath,
  serializeOperatePath,
  serializeOverviewPath,
} from "../src/utils/appRoute";

// console#252: deep-linkable routes. Round-trip coverage — parse(serialize(x))
// === x for every route shape, plus the direct parse cases a bookmarked/
// shared URL exercises.

test("parseAppRoute: '/' is the overview with no fleet filter and the archive collapsed", () => {
  const route = parseAppRoute("/", "");
  assert.equal(route.view, "overview");
  assert.deepEqual(route.fleet, { filter: null, archiveOpen: false });
  assert.equal(route.runId, null);
  assert.equal(route.gateId, null);
});

test("parseAppRoute: '/archive' is the overview with the archive expanded", () => {
  const route = parseAppRoute("/archive", "");
  assert.equal(route.view, "overview");
  assert.equal(route.fleet.archiveOpen, true);
});

test("parseAppRoute: an unrecognized path falls back to the overview, never a hard 404", () => {
  const route = parseAppRoute("/nonexistent/path", "");
  assert.equal(route.view, "overview");
});

test("parseAppRoute: '?filter=<bucket>' is recognized on '/' and '/archive', and ignored when invalid", () => {
  assert.equal(parseAppRoute("/", "?filter=stalled").fleet.filter, "stalled");
  assert.equal(parseAppRoute("/archive", "?filter=waiting-on-you").fleet.filter, "waiting-on-you");
  assert.equal(parseAppRoute("/", "?filter=not-a-bucket").fleet.filter, null);
});

test("parseAppRoute: '/board' is the board view with no focused run", () => {
  const route = parseAppRoute("/board", "");
  assert.equal(route.view, "board");
  assert.equal(route.runId, null);
});

test("parseAppRoute: '/run/:id' is the board view focused on that run", () => {
  const route = parseAppRoute("/run/process-survey-review", "");
  assert.equal(route.view, "board");
  assert.equal(route.runId, "process-survey-review");
  assert.equal(route.gateId, null);
});

test("parseAppRoute: '/run/:id' decodes a URL-encoded id", () => {
  const route = parseAppRoute(`/run/${encodeURIComponent("run with spaces")}`, "");
  assert.equal(route.runId, "run with spaces");
});

test("parseAppRoute: '/operate' is the operate view with no focused gate", () => {
  const route = parseAppRoute("/operate", "");
  assert.equal(route.view, "operate");
  assert.equal(route.gateId, null);
});

test("parseAppRoute: '/gate/:id' is the operate view focused on that gate", () => {
  const route = parseAppRoute("/gate/gate-authority", "");
  assert.equal(route.view, "operate");
  assert.equal(route.gateId, "gate-authority");
  assert.equal(route.runId, null);
});

test("parseAppRoute: '/economics' is the economics view", () => {
  assert.equal(parseAppRoute("/economics", "").view, "economics");
});

test("parseAppRoute: '/telemetry' and its drilldowns delegate to the telemetry route parser", () => {
  assert.equal(parseAppRoute("/telemetry", "").view, "telemetry");
  const drilldown = parseAppRoute("/telemetry/tools/read_file", "?preset=24h");
  assert.equal(drilldown.view, "telemetry");
  assert.deepEqual(drilldown.telemetry.drilldown, { dimension: "tools", value: "read_file" });
});

test("serializeOverviewPath / parseAppRoute round-trip for every fleet state combination", () => {
  const cases: Array<{ filter: "active" | "waiting-on-you" | "stalled" | "archived" | null; archiveOpen: boolean }> = [
    { filter: null, archiveOpen: false },
    { filter: null, archiveOpen: true },
    { filter: "stalled", archiveOpen: false },
    { filter: "waiting-on-you", archiveOpen: true },
  ];
  for (const fleet of cases) {
    const path = serializeOverviewPath(fleet);
    const [pathname, search] = path.split("?");
    const route = parseAppRoute(pathname, search ? `?${search}` : "");
    assert.equal(route.view, "overview");
    assert.deepEqual(route.fleet, fleet, `round-trip failed for ${JSON.stringify(fleet)} -> ${path}`);
  }
});

test("serializeBoardPath / parseAppRoute round-trip", () => {
  assert.equal(serializeBoardPath(null), "/board");
  assert.equal(parseAppRoute(serializeBoardPath(null), "").runId, null);

  const path = serializeBoardPath("run-42");
  assert.equal(path, "/run/run-42");
  assert.equal(parseAppRoute(path, "").runId, "run-42");
});

test("serializeBoardPath encodes ids that need it", () => {
  const path = serializeBoardPath("run with spaces");
  assert.equal(parseAppRoute(path, "").runId, "run with spaces");
});

test("serializeOperatePath / parseAppRoute round-trip", () => {
  assert.equal(serializeOperatePath(null), "/operate");
  assert.equal(parseAppRoute(serializeOperatePath(null), "").gateId, null);

  const path = serializeOperatePath("gate-authority");
  assert.equal(path, "/gate/gate-authority");
  assert.equal(parseAppRoute(path, "").gateId, "gate-authority");
});

test("serializeEconomicsPath / parseAppRoute round-trip", () => {
  assert.equal(serializeEconomicsPath(), "/economics");
  assert.equal(parseAppRoute(serializeEconomicsPath(), "").view, "economics");
});

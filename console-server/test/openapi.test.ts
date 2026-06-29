import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildOpenApiDocument } from "../src/console-foundation/openapi";
import { API_ROUTES, registryKnownRoutePaths, registryScopeFor } from "../src/console-foundation/api-registry";
import { KNOWN_ROUTES, requiredScopeForRoute } from "../src/console-foundation/console-hub-server";

test("buildOpenApiDocument is a valid 3.1 doc with a path per registry route", () => {
  const doc = buildOpenApiDocument({ serverUrl: "https://console.test" }) as any;
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.info.title, "Kontour Console API");
  assert.deepEqual(doc.servers, [{ url: "https://console.test" }]);
  for (const route of API_ROUTES) {
    const op = doc.paths[route.path]?.[route.method.toLowerCase()];
    assert.ok(op, `missing ${route.method} ${route.path}`);
    assert.equal(op.summary, route.summary);
  }
});

test("data schemas are generated from the TS types (refs rewritten to components)", () => {
  const doc = buildOpenApiDocument() as any;
  // generated type present as a component
  assert.ok(doc.components.schemas.TelemetrySummary, "TelemetrySummary component present");
  assert.ok(doc.components.schemas.TelemetryUsageTotals, "TelemetryUsageTotals component present");
  // GET /api/telemetry returns it by $ref
  const tel = doc.paths["/api/telemetry"].get.responses["200"].content["application/json"].schema;
  assert.equal(tel.$ref, "#/components/schemas/TelemetrySummary");
  // no leftover draft-07 #/definitions/ refs anywhere
  assert.ok(!JSON.stringify(doc).includes("#/definitions/"), "all $refs use #/components/schemas/");
});

test("security schemes cover oauth2 (with scopes), bearer, cookie, ingest", () => {
  const s = (buildOpenApiDocument() as any).components.securitySchemes;
  assert.equal(s.oauth2.type, "oauth2");
  assert.ok(s.oauth2.flows.authorizationCode.scopes["telemetry:read"]);
  assert.equal(s.bearerToken.scheme, "bearer");
  assert.equal(s.sessionCookie.in, "cookie");
  assert.ok(s.ingestToken);
});

test("DRIFT: registry exact paths == router KNOWN_ROUTES", () => {
  assert.deepEqual([...registryKnownRoutePaths()].sort(), [...KNOWN_ROUTES].sort());
});

test("DRIFT: registry scopes == requiredScopeForRoute() for every route", () => {
  for (const route of API_ROUTES) {
    if (route.path.includes("{")) continue; // templated paths aren't exact-matched by the router
    assert.equal(
      registryScopeFor(route.method, route.path) ?? undefined,
      requiredScopeForRoute(route.method, route.path) ?? undefined,
      `scope mismatch for ${route.method} ${route.path}`
    );
  }
});

test("DRIFT: committed schemas.generated.ts is up to date with the types", () => {
  const committed = path.join(__dirname, "../src/console-foundation/openapi/schemas.generated.ts");
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "openapi-drift-")), "schemas.generated.ts");
  execFileSync("node", ["scripts/generate-openapi-schemas.mjs"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, OPENAPI_SCHEMAS_OUT: tmp }
  });
  assert.equal(
    fs.readFileSync(tmp, "utf8"),
    fs.readFileSync(committed, "utf8"),
    "schemas.generated.ts is stale — run `npm run generate:openapi`"
  );
});

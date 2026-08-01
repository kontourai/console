import assert = require("node:assert/strict");
import test = require("node:test");
import fs = require("node:fs");
import http = require("node:http");
import os = require("node:os");
import path = require("node:path");
import {
  KitObservabilityHost,
  loadKitObservabilityContractAdapter,
  renderKitStandardViewText,
} from "../src/console-foundation/kit-observability-host";
import { createConsoleHubServer } from "../src/console-foundation/console-hub-server";
import type { KitObservabilityContribution } from "@kontourai/flow-agents/kit-observability-contract" with { "resolution-mode": "import" };

function descriptor(name: string): KitObservabilityContribution {
  return {
    apiVersion: "flowagents.kontourai.io/v1alpha1",
    kind: "KitObservabilityContribution",
    metadata: { name },
    spec: {
      contract_version: "1.0",
      package_ref: `npm:@fixture/${name}@1.0.0`,
      projections: {
        run_summary: { schema_ref: `https://fixtures.example/${name}/run-summary/1.0.json` },
        metric_series: { schema_ref: `https://fixtures.example/${name}/metric-series/1.0.json` },
      },
      authority_refs: {
        flow: "flowagents.kontourai.io/v1alpha1/WorkflowRun",
        surface: "surface.kontourai.io/v1alpha1/TrustBundle",
        runtime: "flowagents.kontourai.io/v1alpha1/RunCorrelationEnvelope",
      },
      host: {
        required_capabilities: ["standard_views"],
        optional_capabilities: ["mcp_apps_resource_bridge"],
        presentation: {
          preferred: {
            kind: "mcp_apps_resource_bridge",
            resource: { uri: `ui://fixtures.example/kits/${name}/observability`, mime_type: "text/html;profile=mcp-app" },
            bridge: { tool_name: name, visibility: ["model", "app"] },
          },
          fallback: { kind: "standard_views", source: "declared_projections" },
        },
      },
      data_policy: { redaction: "declared", retention: "kit_owned", raw_source: "available" },
      operator_intents: [],
      compatibility: { unsupported_version: "diagnostic" },
    },
  };
}

async function fixture() {
  const adapter = await loadKitObservabilityContractAdapter();
  const host = new KitObservabilityHost("tenant-a", adapter);
  return { adapter, host };
}

function record(contribution: KitObservabilityContribution, digest: string, name: string, data: Record<string, unknown> = { verdict: "CONFIRMED" }) {
  return {
    apiVersion: "flowagents.kontourai.io/v1alpha1",
    kind: "KitObservabilityRecord",
    metadata: { name },
    spec: {
      binding: { contribution_ref: contribution.metadata.name, descriptor_digest: digest, package_ref: contribution.spec.package_ref },
      projection: { kind: "run_summary" },
      authority_refs: {
        flow: `flow://workflow-runs/${name}`,
        surface: `surface://trust-bundles/${name}`,
        runtime: `runtime://correlations/${name}`,
      },
      data,
    },
  };
}

function provenance(mode: "observational" | "controlled", runId: string, tenantId = "tenant-a") {
  return {
    mode,
    run_id: runId,
    source_refs: [
      { tenant_id: tenantId, authority: "flow" as const, ref: `flow://workflow-runs/${runId}` },
      { tenant_id: tenantId, authority: "surface" as const, ref: `surface://trust-bundles/${runId}` },
    ],
  };
}

test("public Flow Agents conformance vectors pass through the Console adapter", async () => {
  const adapter = await loadKitObservabilityContractAdapter();
  const conformance = await import("@kontourai/flow-agents/kit-observability-conformance");
  const report = conformance.runKitObservabilityConformance(adapter);
  assert.equal(report.passed, true, JSON.stringify(report.results));
});

test("Builder, Knowledge, and synthetic third-party descriptors use one registry path", async () => {
  const { host } = await fixture();
  for (const name of ["builder-observability", "knowledge-observability", "partner-review"]) {
    const result = host.register({ contribution: descriptor(name) });
    assert.equal("reason" in result, false);
    assert.equal((result as any).contribution_ref, name);
    assert.equal((result as any).presentation, "standard_views");
  }
  assert.deepEqual(host.readWorkspace().contributions.map((entry) => entry.contribution_ref), [
    "builder-observability",
    "knowledge-observability",
    "partner-review",
  ]);
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "console-foundation", "kit-observability-host.ts"), "utf8");
  assert.doesNotMatch(source, /builder-observability|knowledge-observability|partner-review/);
});

test("controlled and observational records remain separate and traceable without causal lift", async () => {
  const { adapter, host } = await fixture();
  const contribution = descriptor("portable-kit");
  host.register({ contribution });
  const digest = adapter.descriptorDigest(contribution);
  host.ingest({ record: record(contribution, digest, "observed"), provenance: provenance("observational", "run-observed") });
  host.ingest({ record: record(contribution, digest, "controlled"), provenance: provenance("controlled", "run-controlled") });

  const workspace = host.readWorkspace();
  assert.deepEqual(workspace.aggregates.map((entry) => entry.evidence_mode), ["controlled", "observational"]);
  assert.deepEqual(workspace.aggregates.map((entry) => entry.run_count), [1, 1]);
  assert.deepEqual(host.readRun("run-observed")[0].source_refs, provenance("observational", "run-observed").source_refs);
  assert.equal(JSON.stringify(workspace).includes('"causal_lift":'), false);
  assert.ok(workspace.limitations.includes("causal_lift_not_computed"));
});

test("descriptor revisions remain historical cohorts instead of rewriting old runs", async () => {
  const { adapter, host } = await fixture();
  const first = descriptor("revisioned-kit");
  const second = structuredClone(first);
  second.spec.package_ref = "npm:@fixture/revisioned-kit@2.0.0";
  host.register({ contribution: first });
  host.ingest({ record: record(first, adapter.descriptorDigest(first), "revision-one"), provenance: provenance("controlled", "revision-one") });
  host.register({ contribution: first, lifecycle: { enabled: false } });
  host.register({ contribution: second });
  host.ingest({ record: record(second, adapter.descriptorDigest(second), "revision-two"), provenance: provenance("controlled", "revision-two") });

  const workspace = host.readWorkspace();
  assert.equal(workspace.contributions.length, 2);
  assert.equal(workspace.aggregates.length, 2);
  assert.notEqual(workspace.aggregates[0].descriptor_digest, workspace.aggregates[1].descriptor_digest);
  assert.equal(host.readRun("revision-one")[0].contribution_lifecycle_at_ingest, "degraded");
  assert.deepEqual(workspace.aggregates.map((entry) => entry.package_ref).sort(), [
    "npm:@fixture/revisioned-kit@1.0.0",
    "npm:@fixture/revisioned-kit@2.0.0",
  ]);
});

test("future, invalid-binding, cross-tenant, control-byte, and redaction inputs quarantine while valid records continue", async () => {
  const { adapter, host } = await fixture();
  const future = structuredClone(descriptor("future-kit")) as any;
  future.spec.contract_version = "2.0";
  assert.equal((host.register({ contribution: future }) as any).reason, "unsupported_version");

  const contribution = descriptor("safe-kit");
  host.register({ contribution });
  const digest = adapter.descriptorDigest(contribution);
  const badBinding = record(contribution, digest, "bad-binding") as any;
  badBinding.spec.binding.descriptor_digest = `sha256:${"0".repeat(64)}`;
  assert.equal((host.ingest({ record: badBinding, provenance: provenance("observational", "bad-binding") }) as any).reason, "invalid_record");
  assert.equal((host.ingest({ record: record(contribution, digest, "cross"), provenance: provenance("observational", "cross", "tenant-b") }) as any).reason, "cross_tenant_reference");
  const mismatchedAuthority = provenance("observational", "mismatched-authority");
  mismatchedAuthority.source_refs[0].ref = "surface://trust-bundles/not-flow";
  assert.equal((host.ingest({ record: record(contribution, digest, "mismatched-authority"), provenance: mismatchedAuthority }) as any).reason, "invalid_source_reference");
  assert.equal((host.ingest({ record: record(contribution, digest, "control", { value: "bad\u0000value" }), provenance: provenance("observational", "control") }) as any).reason, "unsafe_content");
  assert.equal((host.ingest({ record: record(contribution, digest, "secret", { value: "api_key=abcdefghijklmnop" }), provenance: provenance("observational", "secret") }) as any).reason, "unsafe_content");
  assert.equal((host.ingest({ record: record(contribution, digest, "control-key", { "bad\u0000key": "safe" }), provenance: provenance("observational", "control-key") }) as any).reason, "unsafe_content");
  assert.equal((host.ingest({ record: record(contribution, digest, "secret-key", { api_key: "safe" }), provenance: provenance("observational", "secret-key") }) as any).reason, "unsafe_content");

  const valid = host.ingest({
    record: record(contribution, digest, "html-is-text", { value: '<img src=x onerror="alert(1)">' }),
    provenance: provenance("observational", "html-is-text"),
  });
  assert.equal("reason" in valid, false);
  assert.equal(renderKitStandardViewText((valid as any).data.value), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(host.readWorkspace().runs.length, 1);
  assert.equal(host.readWorkspace().quarantine.length, 8);
});

test("identical record replays are idempotent while conflicting identities quarantine without replacing accepted history", async () => {
  const { adapter, host } = await fixture();
  const contribution = descriptor("replay-safe-kit");
  host.register({ contribution });
  const digest = adapter.descriptorDigest(contribution);
  const original = record(contribution, digest, "stable-record", { verdict: "CONFIRMED", nested: { order: ["a", "b"] } });
  const accepted = host.ingest({ record: original, provenance: provenance("observational", "stable-run") });
  const reorderedReplay = structuredClone(original);
  reorderedReplay.spec.data = { nested: { order: ["a", "b"] }, verdict: "CONFIRMED" };
  const replay = host.ingest({ record: reorderedReplay, provenance: provenance("observational", "stable-run") });
  assert.equal("reason" in accepted, false);
  assert.deepEqual(replay, accepted);
  assert.equal(host.readWorkspace().runs.length, 1);

  const conflictingReplay = structuredClone(original);
  conflictingReplay.spec.data = { verdict: "FAIL" };
  const conflict = host.ingest({ record: conflictingReplay, provenance: provenance("observational", "stable-run") });
  assert.equal((conflict as any).reason, "conflicting_replay");
  assert.equal((conflict as any).contribution_ref, "replay-safe-kit");
  assert.equal((conflict as any).run_id, "stable-run");
  assert.equal((conflict as any).record_id, "stable-record");
  assert.deepEqual(host.readRun("stable-run")[0].data, { verdict: "CONFIRMED", nested: { order: ["a", "b"] } });
  assert.equal(host.readWorkspace().runs.length, 1);
});

test("typed lifecycle reports not-installed, disabled, degraded, and incompatible states", async () => {
  const { adapter, host } = await fixture();
  assert.equal((host.register({ contribution: descriptor("not-installed"), lifecycle: { installed: false } }) as any).lifecycle, "not_installed");
  assert.equal((host.register({ contribution: descriptor("disabled-kit"), lifecycle: { enabled: false } }) as any).lifecycle, "disabled");
  // Console intentionally declines the optional MCP Apps bridge, so a normal
  // enabled contribution is explicit degraded/standard-view operation.
  assert.equal((host.register({ contribution: descriptor("degraded-kit") }) as any).lifecycle, "degraded");
  const incompatibleHost = new KitObservabilityHost("tenant-a", adapter, {
    supported_contract_versions: [],
    capabilities: ["standard_views"],
  });
  assert.equal((incompatibleHost.register({ contribution: descriptor("incompatible-kit") }) as any).lifecycle, "incompatible");
});

test("a large generic run set remains traceable and preserves verdict classes verbatim", async () => {
  const { adapter, host } = await fixture();
  const contribution = descriptor("scale-kit");
  host.register({ contribution });
  const digest = adapter.descriptorDigest(contribution);
  const verdicts = ["CONFIRMED", "FAIL", "NOT_VERIFIED"];
  for (let index = 0; index < 1_000; index += 1) {
    host.ingest({
      record: record(contribution, digest, `scale-${index}`, { verdict: verdicts[index % verdicts.length] }),
      provenance: provenance(index % 2 === 0 ? "observational" : "controlled", `scale-${index}`),
    });
  }
  const workspace = host.readWorkspace();
  assert.equal(workspace.runs.length, 1_000);
  assert.deepEqual(workspace.aggregates.map((entry) => entry.run_count), [500, 500]);
  assert.deepEqual([...new Set(workspace.runs.map((run) => run.data.verdict))].sort(), ["CONFIRMED", "FAIL", "NOT_VERIFIED"]);
  assert.equal(workspace.aggregates.flatMap((entry) => entry.run_ids).length, 1_000);
});

test("authenticated Kit endpoints bind the local tenant and expose aggregate-to-run drill-through", async () => {
  const app = createConsoleHubServer({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "console-kit-host-")), port: 0 });
  await new Promise<void>((resolve) => app.listen({ port: 0 }, resolve));
  try {
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("server address unavailable");
    const base = `http://${address.address}:${address.port}`;
    const contribution = descriptor("api-kit");
    const adapter = await loadKitObservabilityContractAdapter();
    const registered = await requestJson("POST", `${base}/api/kits/contributions`, { tenant_id: "default", contribution });
    assert.equal(registered.statusCode, 201);
    const tenantRejected = await requestJson("POST", `${base}/api/kits/contributions`, { tenant_id: "another-tenant", contribution });
    assert.equal(tenantRejected.statusCode, 403);
    assert.equal(tenantRejected.body.error, "TENANT_MISMATCH");
    const ingested = await requestJson("POST", `${base}/api/kits/records`, {
      tenant_id: "default",
      record: record(contribution, adapter.descriptorDigest(contribution), "api-run-record"),
      provenance: provenance("observational", "api-run", "default"),
    });
    assert.equal(ingested.statusCode, 202);
    assert.equal(ingested.body.run_id, "api-run");
    const replayed = await requestJson("POST", `${base}/api/kits/records`, {
      tenant_id: "default",
      record: record(contribution, adapter.descriptorDigest(contribution), "api-run-record"),
      provenance: provenance("observational", "api-run", "default"),
    });
    assert.equal(replayed.statusCode, 202);
    assert.equal(replayed.body.run_id, "api-run");
    const conflictingReplay = await requestJson("POST", `${base}/api/kits/records`, {
      tenant_id: "default",
      record: record(contribution, adapter.descriptorDigest(contribution), "api-run-record", { verdict: "FAIL" }),
      provenance: provenance("observational", "api-run", "default"),
    });
    assert.equal(conflictingReplay.statusCode, 202);
    assert.equal(conflictingReplay.body.reason, "conflicting_replay");
    assert.equal(conflictingReplay.body.record_id, "api-run-record");

    const workspace = await requestJson("GET", `${base}/api/kits/workspace`);
    assert.equal(workspace.statusCode, 200);
    assert.equal(workspace.body.tenant_id, "default");
    assert.deepEqual(workspace.body.aggregates[0].run_ids, ["api-run"]);
    assert.equal(workspace.body.runs.length, 1);
    assert.deepEqual(workspace.body.runs[0].data, { verdict: "CONFIRMED" });
    const drill = await requestJson("GET", `${base}/api/kits/runs/api-run`);
    assert.equal(drill.statusCode, 200);
    assert.equal(drill.body.records[0].source_refs[0].tenant_id, "default");
  } finally {
    await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});

function requestJson(method: string, url: string, payload?: unknown): Promise<{ statusCode?: number; body: any }> {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(raw || "{}") }));
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

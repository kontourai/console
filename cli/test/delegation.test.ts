import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]): string => path.join(here, "fixtures", "delegation", ...parts);
const harness = fixture("harness.ts");
const tsxImport = process.env.KONTOUR_TEST_TSX_IMPORT ?? createRequire(import.meta.url).resolve("tsx");

interface RunResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }

function runHarness(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsxImport, harness, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr!.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(options.input ?? "");
  });
}

test("delegation process parity preserves cwd, complex argv, environment, and inherited stdio", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kontour-delegation-"));
  const canonicalRoot = await realpath(root);
  const recordPath = path.join(root, "record.json");
  const argv = ["space value", 'double"quote', "single'quote", "*.js", "semi;colon", "$(nope)", "雪", "--leading"];
  try {
    const result = await runHarness([process.execPath, fixture("parity-child.mjs"), ...argv], {
      cwd: canonicalRoot,
      env: { ...process.env, KONTOUR_PARITY_RECORD: recordPath, KONTOUR_PARITY_MARKER: "inherited-env" },
      input: "stdin payload\n",
    });
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "parity-stdout:stdin payload\n");
    assert.equal(result.stderr, "parity-stderr:inherited-env");
    const record = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
    assert.equal(typeof record.pid, "number");
    assert.deepEqual({ ...record, pid: "<pid>" }, {
      pid: "<pid>",
      cwd: canonicalRoot,
      argv,
      stdin: "stdin payload\n",
      marker: "inherited-env",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("delegation preserves exact ordinary exit codes", async (t) => {
  for (const expected of [0, 2, 37]) {
    await t.test(String(expected), async () => {
      const result = await runHarness([process.execPath, fixture("exit-child.mjs"), String(expected)]);
      assert.equal(result.code, expected);
      assert.equal(result.signal, null);
    });
  }
});

test("delegation executes each product-owned fixture bin without rewriting argv", async (t) => {
  const products = [
    ["flow", "flow"],
    ["flow-agents", "flow-agents"],
    ["console", "kontour"],
  ] as const;
  for (const [product, bin] of products) {
    await t.test(product, async () => {
      const root = await mkdtemp(path.join(tmpdir(), `kontour-${product}-`));
      const canonicalRoot = await realpath(root);
      const recordPath = path.join(root, "record.jsonl");
      const productBin = path.join(here, "fixtures", "packages", product, "bin", "record.mjs");
      const argv = ["kit", "value with spaces", "--literal=*.json", "雪"];
      try {
        const result = await runHarness([process.execPath, productBin, ...argv], {
          cwd: canonicalRoot,
          env: { ...process.env, KONTOUR_RECORD_FILE: recordPath, KONTOUR_FIXTURE_MARKER: bin },
        });
        assert.equal(result.code, 0);
        assert.equal(result.stdout, `${product}-fixture-stdout\n`);
        assert.equal(result.stderr, `${product}-fixture-stderr\n`);
        assert.deepEqual(JSON.parse((await readFile(recordPath, "utf8")).trim()), {
          product,
          cwd: canonicalRoot,
          argv,
          marker: bin,
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

for (const [signal, expected] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  test(`signal parity forwards ${signal} once and returns ${expected}`, { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kontour-signal-"));
    const recordPath = path.join(root, "signal-record");
    const child = spawn(process.execPath, ["--import", tsxImport, harness, process.execPath, fixture("signal-child.mjs")], {
      env: { ...process.env, KONTOUR_SIGNAL_RECORD: recordPath },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    child.stdout!.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    try {
      await waitFor(() => stdout.includes("READY\n"), 5_000, "signal fixture readiness");
      child.kill(signal);
      const result = await closeResult(child, 5_000);
      assert.deepEqual(result, { code: expected, signal: null });
      const record = await readFile(recordPath, "utf8");
      const [header, ...signals] = record.trim().split("\n");
      assert.ok(header);
      const fixturePid = (JSON.parse(header) as { pid: number }).pid;
      assert.deepEqual(signals, [signal]);
      await waitFor(async () => !(await processExists(fixturePid)), 5_000, "signal fixture cleanup");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  });
}

async function processExists(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function closeResult(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for delegated process exit")), timeoutMs);
    child.once("close", (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
  });
}

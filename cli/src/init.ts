import { constants } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, open, readFile, realpath, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import type { CliIo, CliDependencies } from "./cli";
import type { ProductRootOption } from "./command-line";
import { delegateProduct, delegateProductCaptured } from "./delegate";
import { discoverProducts, resolveDiscoveredExecutable } from "./discovery";
import { buildInitPlan, type InitPlan } from "./init-plan";
import { INIT_PINS } from "./init-plan";

type Mode = "inspect" | "plan" | "apply";
interface ParsedInit { mode: Mode; json: boolean; yes: boolean; runtime: string; kits: string[]; planId?: string }
interface AuthorityEdge { name: string; kind: "dependency" | "optional" | "peer"; targetId: string }
interface AuthorityPackage { id: string; name: string; version: string; sourceRoot: string; sha256: string; edges: AuthorityEdge[] }

function parse(argv: readonly string[]): ParsedInit | string {
  const modes = (["inspect", "plan", "apply"] as const).filter((mode) => argv.includes(`--${mode}`));
  if (modes.length !== 1) return "Select exactly one of --inspect, --plan, or --apply.";
  const parsed: ParsedInit = { mode: modes[0], json: argv.includes("--json"), yes: argv.includes("--yes"), runtime: "codex", kits: [] };
  const valued = new Set(["--runtime", "--kit", "--plan-id"]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (["--inspect", "--plan", "--apply", "--json", "--yes"].includes(token)) continue;
    if (!valued.has(token) || !argv[i + 1] || argv[i + 1].startsWith("--")) return `Invalid init argument: ${token}`;
    const value = argv[++i];
    if (/\0|\r|\n/.test(value) || value.length > 4096) return "Init arguments exceed the supported bounds.";
    if (token === "--runtime") parsed.runtime = value;
    else if (token === "--kit") parsed.kits.push(value);
    else parsed.planId = value;
  }
  if (!["base", "codex", "claude-code", "kiro", "opencode", "pi"].includes(parsed.runtime)) return "Unsupported runtime.";
  if (parsed.kits.some((kit) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(kit))) return "Kit ids must be lowercase catalog identifiers.";
  return parsed;
}

function emit(io: CliIo, json: boolean, value: unknown): void {
  if (json) { io.stdout.write(`${JSON.stringify(value, null, 2)}\n`); return; }
  const record = value as { mode?: string; plan_id?: string; status?: string; actions?: Array<{ id: string; status?: string }>; diagnostics?: Record<string, { exitCode?: number }> };
  const lines = [`Kontour init ${record.mode ?? "result"}${record.status ? `: ${record.status}` : ""}`];
  if (record.plan_id) lines.push(`plan id: ${record.plan_id}`);
  for (const [name, diagnostic] of Object.entries(record.diagnostics ?? {})) lines.push(`${name}: exit ${diagnostic.exitCode ?? "unknown"}`);
  for (const action of record.actions ?? []) lines.push(`${action.id}${action.status ? `: ${action.status}` : ""}`);
  io.stdout.write(`${lines.join("\n")}\n`);
}
function fail(io: CliIo, code: string, message: string): number { io.stderr.write(`${code}: ${message}\n`); return 2; }
function childEnv(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "NO_COLOR", "FORCE_COLOR", "CI"];
  return Object.fromEntries(allowed.flatMap((key) => typeof process.env[key] === "string" ? [[key, process.env[key]!]] : []));
}

async function digestTree(root: string, excludeNodeModules = false): Promise<string> {
  const hash = createHash("sha256");
  async function visit(dir: string, prefix = ""): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (excludeNodeModules && prefix === "" && entry.name === "node_modules") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const file = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`authority package contains symlink: ${rel}`);
      hash.update(`${entry.isDirectory() ? "d" : "f"}\0${rel}\0`);
      if (entry.isDirectory()) await visit(file, rel);
      else if (entry.isFile()) hash.update(await readFile(file));
      else throw new Error(`authority package contains unsupported entry: ${rel}`);
      hash.update("\0");
    }
  }
  await visit(root);
  return hash.digest("hex");
}

function packageNameSegments(name: string): string[] {
  if (name.length === 0 || name.length > 214 || name.includes("%") || name.includes("\\") || /[\u0000-\u001f\u007f]/.test(name)) throw new Error(`invalid runtime dependency name: ${name}`);
  const segment = /^[a-z0-9][a-z0-9._~-]*$/;
  if (name.startsWith("@")) {
    const parts = name.split("/");
    if (parts.length !== 2 || !segment.test(parts[0]!.slice(1)) || !segment.test(parts[1]!) || parts[0] === "@." || parts[0] === "@..") throw new Error(`invalid runtime dependency name: ${name}`);
    return parts;
  }
  if (name.includes("/") || !segment.test(name) || name === "." || name === "..") throw new Error(`invalid runtime dependency name: ${name}`);
  return [name];
}

function assertContained(root: string, candidate: string, label: string): void {
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !rel.includes(`..${process.platform === "win32" ? "\\" : "/"}`))) return;
  throw new Error(`${label} escapes authority root`);
}

async function resolveDependencyRoot(fromRoot: string, name: string, optional = false): Promise<string | null> {
  const segments = packageNameSegments(name);
  let cursor = fromRoot;
  while (true) {
    const searchRoot = join(cursor, "node_modules");
    const candidate = join(searchRoot, ...segments);
    assertContained(searchRoot, candidate, "dependency candidate");
    try {
      const resolved = await realpath(candidate);
      const canonicalSearch = await realpath(searchRoot);
      assertContained(canonicalSearch, resolved, "resolved dependency");
      return resolved;
    } catch (error) {
      if (!(error as Error).message.includes("escapes authority root") && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if ((error as Error).message.includes("escapes authority root")) throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) { if (optional) return null; throw new Error(`runtime dependency unavailable: ${name}`); }
    cursor = parent;
  }
}

async function authorityPackages(root: string): Promise<AuthorityPackage[]> {
  const found = new Map<string, AuthorityPackage>();
  async function visit(packageRootInput: string): Promise<string> {
    const packageRoot = await realpath(packageRootInput);
    if (found.has(packageRoot)) return packageRoot;
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { name?: string; version?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    if (!manifest.name || !manifest.version) throw new Error("authority package identity missing");
    packageNameSegments(manifest.name);
    const item: AuthorityPackage = { id: packageRoot, name: manifest.name, version: manifest.version, sourceRoot: packageRoot, sha256: await digestTree(packageRoot, true), edges: [] };
    found.set(packageRoot, item);
    const groups: Array<[AuthorityEdge["kind"], Record<string, string>, boolean]> = [
      ["dependency", manifest.dependencies ?? {}, false], ["optional", manifest.optionalDependencies ?? {}, true], ["peer", manifest.peerDependencies ?? {}, true],
    ];
    const seenNames = new Set<string>();
    for (const [kind, entries, optional] of groups) for (const name of Object.keys(entries).sort()) {
      packageNameSegments(name);
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      const target = await resolveDependencyRoot(packageRoot, name, optional);
      if (target) item.edges.push({ name, kind, targetId: await visit(target) });
    }
    item.edges.sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
    return packageRoot;
  }
  await visit(root);
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function snapshotPackages(packages: readonly AuthorityPackage[], flowAgentsRoot: string, executable: string, nodeBytes: Buffer, nodeMode: number, nodeSha256: string): Promise<{ root: string; executable: string; node: string; cleanup: () => Promise<void> }> {
  const temp = await mkdtemp(join(tmpdir(), "kontour-init-authority-"));
  const store = join(temp, "store");
  try {
    const targets = new Map<string, string>();
    for (const item of packages) {
      const target = join(store, createHash("sha256").update(item.id).digest("hex"));
      await cp(item.sourceRoot, target, { recursive: true, filter: (source) => !(relative(item.sourceRoot, source).split("/")[0] === "node_modules") });
      if (await digestTree(target, true) !== item.sha256) throw new Error(`authority snapshot drift: ${item.name}`);
      targets.set(item.id, target);
    }
    for (const item of packages) for (const edge of item.edges) {
      const instanceRoot = targets.get(item.id)!;
      const instanceModules = join(instanceRoot, "node_modules");
      const link = join(instanceModules, ...packageNameSegments(edge.name));
      assertContained(instanceModules, link, "snapshot dependency link");
      assertContained(store, targets.get(edge.targetId)!, "snapshot dependency target");
      await mkdir(dirname(link), { recursive: true });
      try { await stat(link); throw new Error(`snapshot dependency link collision: ${edge.name}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await symlink(targets.get(edge.targetId)!, link);
    }
    const node = join(temp, "node");
    await writeFile(node, nodeBytes, { flag: "wx", mode: nodeMode & 0o777 });
    await chmod(node, nodeMode & 0o777);
    if (createHash("sha256").update(await readFile(node)).digest("hex") !== nodeSha256) throw new Error("Node interpreter snapshot drift");
    const snapshotRoot = targets.get(flowAgentsRoot)!;
    return { root: snapshotRoot, executable: join(snapshotRoot, relative(flowAgentsRoot, executable)), node, cleanup: () => rm(temp, { recursive: true, force: true }) };
  } catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
}

export async function runInit(argv: readonly string[], roots: readonly ProductRootOption[], io: CliIo, dependencies: CliDependencies): Promise<number> {
  const args = parse(argv);
  if (typeof args === "string") return fail(io, "KONTOUR_INIT_ARGUMENT_INVALID", args);
  const cwd = resolve(dependencies.cwd ?? process.cwd());
  const originalCwd = process.cwd();
  const repositoryHandle = await open(cwd, constants.O_RDONLY);
  let snapshot: Awaited<ReturnType<typeof snapshotPackages>> | undefined;
  try {
    const repositoryStat = await repositoryHandle.stat();
    const repositoryRealpath = await realpath(cwd);
    const products = await discoverProducts(roots);
    const flowAgents = products.find((product) => product.productId === "flow-agents")!;
    if (flowAgents.diagnostics.length > 0 || !flowAgents.candidate) return fail(io, "KONTOUR_INIT_FLOW_AGENTS_REQUIRED", "Provide an explicit local @kontourai/flow-agents product root.");
    const executableResult = await resolveDiscoveredExecutable(flowAgents, "flow-agents-cli");
    if (!executableResult.ok) return fail(io, "KONTOUR_INIT_FLOW_AGENTS_REQUIRED", executableResult.diagnostics[0]?.message ?? "Flow Agents executable is unavailable.");
    const executableRealpath = await realpath(executableResult.value.executablePath);
    const packageRoot = await realpath(flowAgents.candidate.root);
    const authority = await authorityPackages(packageRoot);
    const flowAgentsAuthority = authority.find((item) => item.id === packageRoot);
    if (flowAgentsAuthority?.name !== "@kontourai/flow-agents" || flowAgentsAuthority.version !== INIT_PINS.flowAgents || flowAgents.packageVersion !== flowAgentsAuthority.version) {
      return fail(io, "KONTOUR_INIT_EXACT_VERSION_REQUIRED", `Expected @kontourai/flow-agents@${INIT_PINS.flowAgents}.`);
    }
    const flowEdge = flowAgentsAuthority.edges.find((edge) => edge.name === "@kontourai/flow");
    const flowAuthority = flowEdge ? authority.find((item) => item.id === flowEdge.targetId) : undefined;
    if (flowEdge?.kind !== "dependency" || flowAuthority?.name !== "@kontourai/flow" || flowAuthority.version !== INIT_PINS.flow) {
      return fail(io, "KONTOUR_INIT_EXACT_VERSION_REQUIRED", `Expected @kontourai/flow@${INIT_PINS.flow} as a Flow Agents runtime dependency.`);
    }
    const nodeRealpath = await realpath(process.execPath);
    const nodeStat = await stat(nodeRealpath);
    const nodeBytes = await readFile(nodeRealpath);
    const interpreter = { realpath: nodeRealpath, dev: nodeStat.dev, ino: nodeStat.ino, sha256: createHash("sha256").update(nodeBytes).digest("hex") };
    const plan: InitPlan = buildInitPlan({ cwd, repositoryRealpath, repositoryDev: repositoryStat.dev, repositoryIno: repositoryStat.ino, interpreter, runtime: args.runtime, kits: args.kits, flowAgentsVersion: flowAgentsAuthority.version, packageRoot, executableRealpath, rootInstanceId: flowAgentsAuthority.id, authorityPackages: authority });
    const capture = dependencies.delegateCaptured ?? (dependencies.delegate ? async (file: string, childArgv: readonly string[], options: Parameters<typeof delegateProduct>[2]) => ({ code: await dependencies.delegate!(file, childArgv, options), stdout: "", stderr: "" }) : delegateProductCaptured);
    const environment = childEnv();

    if (args.mode === "plan") { emit(io, args.json, plan); return 0; }
    snapshot = await snapshotPackages(authority, packageRoot, executableRealpath, nodeBytes, nodeStat.mode, interpreter.sha256);
    if (args.mode === "inspect") {
      const doctor = await capture(snapshot.node, [snapshot.executable, ...executableResult.value.argvPrefix, "telemetry-doctor", "--dest", cwd, "--json", "--headless"], { cwd, env: environment });
      const kitStatus = await capture(snapshot.node, [snapshot.executable, ...executableResult.value.argvPrefix, "kit", "status", "--dest", cwd], { cwd, env: environment });
      const parseOutput = (value: string): unknown => { try { return JSON.parse(value); } catch { return value.trim(); } };
      emit(io, args.json, { schemaVersion: "1.0.0", mode: "inspect", repository: { root: cwd }, products: { flowAgents: { version: flowAgents.packageVersion, descriptorSource: flowAgents.descriptorSource } }, desired: { kits: [] }, diagnostics: { doctor: { exitCode: doctor.code, output: parseOutput(doctor.stdout), stderr: doctor.stderr.trim() }, kitStatus: { exitCode: kitStatus.code, output: parseOutput(kitStatus.stdout), stderr: kitStatus.stderr.trim() } }, mutations: [], gaps: [{ owner: "flow-agents", issues: ["#321", "#322", "#323", "#324", "#325", "#485", "#486"], status: "not_verified" }] });
      return 0;
    }
    if (!args.yes || !args.planId) return fail(io, "KONTOUR_INIT_CONSENT_REQUIRED", "Apply requires --yes and the exact --plan-id emitted for the same runtime and kit inputs.");
    if (args.planId !== plan.plan_id) return fail(io, "KONTOUR_INIT_PLAN_INVALID", "Live repository or package authority differs from the approved plan; inspect and plan again.");
    const current = await stat(cwd);
    if (current.dev !== repositoryStat.dev || current.ino !== repositoryStat.ino || await realpath(cwd) !== repositoryRealpath) return fail(io, "KONTOUR_INIT_REPOSITORY_DRIFT", "Repository identity changed before execution.");
    process.chdir(repositoryRealpath);
    const held = await stat(".");
    if (held.dev !== repositoryStat.dev || held.ino !== repositoryStat.ino) return fail(io, "KONTOUR_INIT_REPOSITORY_DRIFT", "Could not enter the held repository directory.");
    const outcomes: Array<{ id: string; status: "completed" | "failed" | "not_run"; exitCode?: number; output?: unknown; stderr?: string }> = [];
    let failedCode = 0;
    const invoke = dependencies.delegate ?? delegateProduct;
    for (const action of plan.actions) {
      if (failedCode) { outcomes.push({ id: action.id, status: "not_run" }); continue; }
      const actionArgv = action.argv.map((token) => token === packageRoot || token.startsWith(`${packageRoot}/`) ? `${snapshot!.root}${token.slice(packageRoot.length)}` : token);
      if (args.json || action.sideEffect === "read-local") {
        const result = await capture(snapshot.node, [snapshot.executable, ...executableResult.value.argvPrefix, ...actionArgv], { env: environment });
        let output: unknown = result.stdout.trim(); try { output = JSON.parse(result.stdout); } catch { /* text */ }
        outcomes.push({ id: action.id, status: result.code ? "failed" : "completed", exitCode: result.code, output, stderr: result.stderr.trim() });
        failedCode = result.code;
      } else {
        const code = await invoke(snapshot.node, [snapshot.executable, ...executableResult.value.argvPrefix, ...actionArgv], { env: environment, stdio: "inherit" });
        outcomes.push({ id: action.id, status: code ? "failed" : "completed", exitCode: code }); failedCode = code;
      }
    }
    emit(io, args.json, { schemaVersion: "1.0.0", mode: "apply", plan_id: plan.plan_id, status: failedCode ? "failed" : "completed", actions: outcomes, recovery: plan.actions.filter((_, index) => outcomes[index]?.status !== "not_run").map((action) => `Flow Agents action ${action.id}: ${action.rollback}`) });
    return failedCode;
  } finally {
    await snapshot?.cleanup();
    await repositoryHandle.close();
    try { process.chdir(originalCwd); } catch { /* original caller cwd may have been removed */ }
  }
}

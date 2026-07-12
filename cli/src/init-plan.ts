import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { CLI_PACKAGE_VERSION } from "./package-identity";

export const INIT_PLAN_SCHEMA_VERSION = "1.0.0" as const;
export const INIT_PINS = {
  cli: CLI_PACKAGE_VERSION,
  console: "2.5.0",
  flowAgents: "3.8.0",
  flow: "3.1.4",
} as const;

export interface InitAction {
  readonly id: string;
  readonly owner: "flow-agents";
  readonly executableId: "flow-agents-cli";
  readonly argv: readonly string[];
  readonly sideEffect: "read-local" | "write-local";
  readonly confirmation: "never" | "user-request";
  readonly expectedPaths: readonly string[];
  readonly postcondition: string;
  readonly rollback: string;
}

export interface InitPlanBody {
  readonly schemaVersion: typeof INIT_PLAN_SCHEMA_VERSION;
  readonly mode: "plan";
  readonly repository: { readonly root: string; readonly realpath: string; readonly dev: number; readonly ino: number };
  readonly pins: typeof INIT_PINS;
  readonly interpreter: { readonly realpath: string; readonly dev: number; readonly ino: number; readonly sha256: string };
  readonly products: { readonly flowAgents: { readonly version: string | null; readonly packageRoot: string; readonly executableRealpath: string; readonly rootInstanceId: string; readonly authorityPackages: readonly { readonly id: string; readonly name: string; readonly version: string; readonly sourceRoot: string; readonly sha256: string; readonly edges: readonly { readonly name: string; readonly kind: "dependency" | "optional" | "peer"; readonly targetId: string }[] }[] } };
  readonly desired: { readonly runtime: string; readonly kits: readonly string[] };
  readonly actions: readonly InitAction[];
  readonly gaps: readonly { owner: string; issue: string; status: "unsupported"; summary: string }[];
}

export type InitPlan = InitPlanBody & { readonly plan_id: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function planId(body: InitPlanBody): string {
  return createHash("sha256").update(canonical(body)).digest("hex");
}

export function buildInitPlan(input: { cwd: string; repositoryRealpath: string; repositoryDev: number; repositoryIno: number; interpreter: { realpath: string; dev: number; ino: number; sha256: string }; runtime: string; kits: readonly string[]; flowAgentsVersion: string | null; packageRoot: string; executableRealpath: string; rootInstanceId: string; authorityPackages: readonly { id: string; name: string; version: string; sourceRoot: string; sha256: string; edges: readonly { name: string; kind: "dependency" | "optional" | "peer"; targetId: string }[] }[] }): InitPlan {
  const kits = [...new Set(input.kits)].sort();
  const initArgv = ["init", "--runtime", input.runtime, "--dest", resolve(input.cwd), "--yes", "--headless"];
  if (kits.length > 0) initArgv.push("--activate-kits");
  for (const kit of kits) initArgv.push("--activate-kit", kit);
  const kitInstallActions: InitAction[] = kits.map((kit) => ({
    id: `flow-agents-kit-install-${kit}`,
    owner: "flow-agents",
    executableId: "flow-agents-cli",
    argv: ["kit", "install", resolve(input.packageRoot, "kits", kit), "--dest", resolve(input.cwd)],
    sideEffect: "write-local",
    confirmation: "user-request",
    expectedPaths: [`.kontourai/flow-agents/kits/${kit}`],
    postcondition: `Flow Agents kit status reports '${kit}' installed.`,
    rollback: `Kontour performed no automatic rollback. Use Flow Agents-owned kit lifecycle guidance for '${kit}' and do not delete unknown files.`,
  }));
  const body: InitPlanBody = {
    schemaVersion: INIT_PLAN_SCHEMA_VERSION,
    mode: "plan",
    repository: { root: resolve(input.cwd), realpath: input.repositoryRealpath, dev: input.repositoryDev, ino: input.repositoryIno },
    pins: INIT_PINS,
    interpreter: input.interpreter,
    products: { flowAgents: { version: input.flowAgentsVersion, packageRoot: input.packageRoot, executableRealpath: input.executableRealpath, rootInstanceId: input.rootInstanceId, authorityPackages: [...input.authorityPackages].sort((a, b) => a.id.localeCompare(b.id)) } },
    desired: { runtime: input.runtime, kits },
    actions: [
      ...kitInstallActions,
      {
        id: "flow-agents-init",
        owner: "flow-agents",
        executableId: "flow-agents-cli",
        argv: initArgv,
        sideEffect: "write-local",
        confirmation: "user-request",
        expectedPaths: [".kontourai/flow-agents", `.${input.runtime}`],
        postcondition: "Flow Agents init exits successfully and owns validation of installed runtime assets.",
        rollback: "Kontour performed no automatic rollback. Inspect Flow Agents-owned output and remove or restore only paths confirmed by Flow Agents; do not delete unknown files.",
      },
      {
        id: "flow-agents-doctor",
        owner: "flow-agents",
        executableId: "flow-agents-cli",
        argv: ["telemetry-doctor", "--dest", resolve(input.cwd), "--json", "--headless"],
        sideEffect: "read-local",
        confirmation: "never",
        expectedPaths: [],
        postcondition: "Flow Agents telemetry doctor exits successfully.",
        rollback: "No rollback: this is a Flow Agents-owned read-only diagnostic.",
      },
    ],
    gaps: [
      { owner: "flow-agents", issue: "#321-#325", status: "unsupported", summary: "Unified provider, power, policy, and ranked doctor onboarding remains product-owned and is not recreated by Console." },
      { owner: "flow-agents", issue: "#485-#486", status: "unsupported", summary: "Catalog-neutral init and validation remain product-owned; Console selects no kit unless explicitly requested." },
    ],
  };
  return { ...body, plan_id: planId(body) };
}

export function validateInitPlan(value: unknown): value is InitPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (plan.schemaVersion !== INIT_PLAN_SCHEMA_VERSION || plan.mode !== "plan" || typeof plan.plan_id !== "string") return false;
  const { plan_id: supplied, ...body } = plan;
  if (planId(body as unknown as InitPlanBody) !== supplied) return false;
  const actions = plan.actions;
  return Array.isArray(actions) && actions.length > 0 && actions.every((action) => {
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const item = action as Record<string, unknown>;
    return item.owner === "flow-agents" && item.executableId === "flow-agents-cli"
      && Array.isArray(item.argv) && item.argv.every((token) => typeof token === "string" && token.length <= 4096 && !/[\u0000\r\n]/.test(token))
      && (item.sideEffect === "read-local" || item.sideEffect === "write-local")
      && typeof item.rollback === "string";
  });
}

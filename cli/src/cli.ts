import type { CatalogProductId } from "./catalog";
import { parseCommandLine } from "./command-line";
import { delegateProduct, delegateProductCaptured } from "./delegate";
import { discoverProducts } from "./discovery";
import { buildRouterOutput, renderRouterOutput } from "./output";
import { routeCommand } from "./router";
import type { RouterCommand } from "./router-output";
import { runInit } from "./init";
import { helpScope, renderHelp } from "./help";

const PRODUCT_IDS = new Set<CatalogProductId>(["console", "flow", "flow-agents"]);
const BUILT_INS = new Set<RouterCommand>(["products", "capabilities", "doctor"]);

export interface CliIo {
  readonly stdout: { write(value: string): unknown };
  readonly stderr: { write(value: string): unknown };
}

export interface CliDependencies {
  readonly delegate?: typeof delegateProduct;
  readonly cwd?: string;
  readonly delegateCaptured?: typeof delegateProductCaptured;
}

function error(io: CliIo, code: string, message: string): number {
  io.stderr.write(`${code}: ${message}\n`);
  return 2;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
  dependencies: CliDependencies = {},
): Promise<number> {
  const requestedHelp = helpScope(argv);
  if (requestedHelp) {
    io.stdout.write(renderHelp(requestedHelp));
    return 0;
  }
  const parsed = parseCommandLine(argv);
  if (!parsed.ok) return error(io, parsed.code, parsed.message);
  const [name, ...rest] = parsed.argv;
  if (name === "init") return runInit(rest, parsed.productRoots, io, dependencies);
  if (BUILT_INS.has(name as RouterCommand)) {
    const command = name as RouterCommand;
    if (rest.includes("--online")) return error(io, "ROUTER_ARGUMENT_INVALID", "--online is reserved and performs no network access.");
    const json = rest.includes("--json");
    const positionals = rest.filter((token) => token !== "--json");
    let productId: CatalogProductId | undefined;
    if (command === "capabilities" && positionals.length === 1 && PRODUCT_IDS.has(positionals[0] as CatalogProductId)) {
      productId = positionals[0] as CatalogProductId;
    } else if (positionals.length > 0) {
      return error(io, command === "capabilities" ? "ROUTER_PRODUCT_UNKNOWN" : "ROUTER_ARGUMENT_INVALID", command === "capabilities" ? "Select console, flow, or flow-agents." : `${command} accepts only --json.`);
    }
    const output = buildRouterOutput(command, await discoverProducts(parsed.productRoots), productId);
    io.stdout.write(json ? `${JSON.stringify(output, null, 2)}\n` : renderRouterOutput(output));
    return 0;
  }

  const routed = await routeCommand(argv);
  if (!routed.ok) {
    for (const item of routed.diagnostics) io.stderr.write(`${item.code}: ${item.message}\n`);
    return 2;
  }
  try {
    return await (dependencies.delegate ?? delegateProduct)(routed.executablePath, routed.argv);
  } catch {
    return error(io, "KONTOUR_DELEGATION_SPAWN_FAILED", "The product executable could not be started.");
  }
}

import type { ProductCapabilityDiagnostic, ProductCommandDeclaration } from "@kontourai/console-core/product-capability-descriptor";
import { parseCommandLine, selectNamespace, type ProductRootOption } from "./command-line";
import { discoverProducts, resolveDiscoveredExecutable, type DiscoveredProduct } from "./discovery";

export type RouteDiagnosticCode = "ROUTER_ARGUMENT_INVALID" | "ROUTER_NAMESPACE_UNKNOWN" | "ROUTER_COMMAND_UNKNOWN";
export interface RouteDiagnostic { readonly code: RouteDiagnosticCode | ProductCapabilityDiagnostic["code"]; readonly message: string; readonly productId?: string }
export type RouteResult =
  | { readonly ok: true; readonly product: DiscoveredProduct; readonly command: ProductCommandDeclaration; readonly executablePath: string; readonly argv: readonly string[] }
  | { readonly ok: false; readonly diagnostics: readonly RouteDiagnostic[] };

function matchCommand(commands: readonly ProductCommandDeclaration[], argv: readonly string[]): ProductCommandDeclaration | undefined {
  return [...commands]
    .sort((a, b) => b.path.length - a.path.length || a.path.join(" ").localeCompare(b.path.join(" ")))
    .find((command) => command.path.every((token, index) => argv[index] === token));
}

/** Resolve a route without spawning. Product argv remains literal Node strings. */
export async function routeCommand(input: readonly string[]): Promise<RouteResult> {
  const parsed = parseCommandLine(input);
  if (!parsed.ok) return { ok: false, diagnostics: [{ code: parsed.code, message: parsed.message }] };
  const selected = selectNamespace(parsed.argv);
  if (!selected) return { ok: false, diagnostics: [{ code: "ROUTER_NAMESPACE_UNKNOWN", message: "Select flow, flow agents, or console." }] };
  const products = await discoverProducts(parsed.productRoots);
  const product = products.find((item) => item.productId === selected.productId)!;
  if (product.diagnostics.length) return { ok: false, diagnostics: product.diagnostics };
  const command = matchCommand(product.descriptor.commands, selected.productArgv);
  if (!command) return { ok: false, diagnostics: [{ code: "ROUTER_COMMAND_UNKNOWN", productId: product.productId, message: "The command is not declared by this product descriptor." }] };
  const executable = await resolveDiscoveredExecutable(product, command.executableId);
  if (!executable.ok) return { ok: false, diagnostics: executable.diagnostics };
  // Descriptor argv is authoritative for the declared command. Preserve every
  // caller token following the matched command path exactly.
  const trailing = selected.productArgv.slice(command.path.length);
  return { ok: true, product, command, executablePath: executable.value.executablePath, argv: [...executable.value.argvPrefix, ...command.argv, ...trailing] };
}

export async function discoverFromOptions(productRoots: readonly ProductRootOption[]): Promise<readonly DiscoveredProduct[]> {
  return discoverProducts(productRoots);
}

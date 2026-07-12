import type { CatalogProductId } from "./catalog";

export const MAX_ROUTER_ARGV = 256;
export const MAX_ROUTER_TOKEN_LENGTH = 4096;

export interface ProductRootOption {
  readonly productId: CatalogProductId;
  readonly root: string;
}

export type ParsedCommandLine =
  | { readonly ok: true; readonly productRoots: readonly ProductRootOption[]; readonly argv: readonly string[] }
  | { readonly ok: false; readonly code: "ROUTER_ARGUMENT_INVALID"; readonly message: string };

const PRODUCTS = new Set<CatalogProductId>(["flow-agents", "flow", "console"]);

/** Parse only router-owned options before the command. Product argv is opaque. */
export function parseCommandLine(input: readonly string[]): ParsedCommandLine {
  if (input.length > MAX_ROUTER_ARGV || input.some((token) => token.length > MAX_ROUTER_TOKEN_LENGTH || /[\u0000\r\n]/.test(token))) {
    return { ok: false, code: "ROUTER_ARGUMENT_INVALID", message: "Router arguments exceed the supported bounds." };
  }
  const roots: ProductRootOption[] = [];
  let index = 0;
  while (input[index]?.startsWith("--product-root=")) {
    const value = input[index].slice("--product-root=".length);
    const separator = value.indexOf("=");
    const productId = value.slice(0, separator) as CatalogProductId;
    const root = value.slice(separator + 1);
    if (separator < 1 || !PRODUCTS.has(productId) || root.length === 0) {
      return { ok: false, code: "ROUTER_ARGUMENT_INVALID", message: "Use --product-root=<flow|flow-agents|console>=<root>." };
    }
    if (roots.some((candidate) => candidate.productId === productId)) {
      return { ok: false, code: "ROUTER_ARGUMENT_INVALID", message: "Supply at most one explicit root for each product." };
    }
    roots.push({ productId, root });
    index += 1;
  }
  return { ok: true, productRoots: roots, argv: input.slice(index) };
}

export interface NamespaceSelection {
  readonly productId: CatalogProductId;
  readonly namespace: readonly string[];
  readonly productArgv: readonly string[];
}

const NAMESPACES = [
  { productId: "flow-agents", namespace: ["flow", "agents"] },
  { productId: "console", namespace: ["console"] },
  { productId: "flow", namespace: ["flow"] },
] as const;

/** Longest-prefix namespace selection. Only the suite namespace is consumed. */
export function selectNamespace(argv: readonly string[]): NamespaceSelection | undefined {
  for (const route of NAMESPACES) {
    if (route.namespace.every((token, index) => argv[index] === token)) {
      return { productId: route.productId, namespace: route.namespace, productArgv: argv.slice(route.namespace.length) };
    }
  }
  return undefined;
}

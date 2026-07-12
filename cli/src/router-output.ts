import type {
  ProductArtifactDeclaration,
  ProductCapabilityDiagnostic,
  ProductCommandDeclaration,
  ProductProjectionDeclaration,
} from "@kontourai/console-core/product-capability-descriptor";
import type { DescriptorSource } from "./catalog";

export const ROUTER_OUTPUT_SCHEMA_VERSION = "1.0.0" as const;

export type RouterCommand = "products" | "capabilities" | "doctor";
export type ProductAvailability = "available" | "missing" | "incompatible";
export type RouterDiagnosticCode =
  | ProductCapabilityDiagnostic["code"]
  | "ROUTER_PRODUCT_MISSING"
  | "ROUTER_PRODUCT_UNKNOWN"
  | "ROUTER_COMMAND_UNKNOWN"
  | "ROUTER_EXPLICIT_VERSION_REQUIRED";

export interface RouterDiagnostic {
  readonly code: RouterDiagnosticCode;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly productId?: string;
}

export interface RouterProductResult {
  readonly id: string;
  readonly displayName: string;
  readonly owner: string;
  readonly package: {
    readonly name: string;
    readonly version: string | null;
  };
  readonly protocolVersion: string;
  readonly compatible: boolean;
  readonly availability: ProductAvailability;
  readonly descriptorSource: DescriptorSource;
  readonly executableSource: "explicit-product-root" | "unresolved";
  readonly commands: readonly ProductCommandDeclaration[];
  readonly artifacts: readonly ProductArtifactDeclaration[];
  readonly projections: readonly ProductProjectionDeclaration[];
  readonly diagnostics: readonly RouterDiagnostic[];
  readonly remediation: readonly string[];
}

export interface RouterOutput {
  readonly schemaVersion: typeof ROUTER_OUTPUT_SCHEMA_VERSION;
  readonly command: RouterCommand;
  readonly products: readonly RouterProductResult[];
  readonly diagnostics: readonly RouterDiagnostic[];
}

export function compareRouterProducts(a: RouterProductResult, b: RouterProductResult): number {
  return a.id.localeCompare(b.id) || a.package.name.localeCompare(b.package.name);
}

export function compareRouterDiagnostics(a: RouterDiagnostic, b: RouterDiagnostic): number {
  return a.code.localeCompare(b.code) || (a.productId ?? "").localeCompare(b.productId ?? "") || a.message.localeCompare(b.message);
}

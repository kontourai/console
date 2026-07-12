import type { ProductCapabilityDiagnostic } from "@kontourai/console-core/product-capability-descriptor";
import type { CatalogProductId } from "./catalog";
import type { DiscoveredProduct } from "./discovery";
import { missingProductRemediation } from "./install-policy";
import {
  ROUTER_OUTPUT_SCHEMA_VERSION,
  compareRouterDiagnostics,
  compareRouterProducts,
  type RouterCommand,
  type RouterDiagnostic,
  type RouterOutput,
  type RouterProductResult,
} from "./router-output";

function diagnostic(value: ProductCapabilityDiagnostic): RouterDiagnostic {
  return {
    code: value.code,
    severity: value.severity,
    message: value.message,
    ...(value.productId ? { productId: value.productId } : {}),
  };
}

function normalizedProduct(product: DiscoveredProduct): RouterProductResult {
  const errors = product.diagnostics.filter((item) => item.severity === "error");
  const availability = errors.length > 0 ? "incompatible" : product.candidate ? "available" : "missing";
  const diagnostics: RouterDiagnostic[] = product.diagnostics.map(diagnostic);
  const remediation: string[] = [];
  if (availability === "missing") {
    diagnostics.push({
      code: "ROUTER_PRODUCT_MISSING",
      severity: "warning",
      productId: product.productId,
      message: "No explicit local product package root was supplied.",
    });
    const packageBin = product.descriptor.executables[0]?.packageBin;
    remediation.push(`Provide an explicit local root with --product-root=${product.productId}=<root>.`);
    if (packageBin) {
      const install = missingProductRemediation(product.productId, product.descriptor.product.packageName, packageBin);
      remediation.push(install.localInstall, install.oneShot);
    }
  } else if (availability === "incompatible") {
    remediation.push(`Repair or replace the explicit ${product.descriptor.product.packageName} package root, then run doctor again.`);
  }

  return {
    id: product.productId,
    displayName: product.descriptor.product.displayName,
    owner: product.descriptor.product.id,
    package: { name: product.descriptor.product.packageName, version: product.packageVersion },
    protocolVersion: product.descriptor.protocolVersion,
    compatible: errors.length === 0,
    availability,
    descriptorSource: product.descriptorSource,
    executableSource: product.candidate ? "explicit-product-root" : "unresolved",
    commands: [...product.descriptor.commands].sort((a, b) => a.path.join("\u0000").localeCompare(b.path.join("\u0000"))),
    artifacts: [...product.descriptor.artifacts].sort((a, b) => a.id.localeCompare(b.id)),
    projections: [...product.descriptor.projections].sort((a, b) => a.id.localeCompare(b.id)),
    diagnostics: diagnostics.sort(compareRouterDiagnostics),
    remediation,
  };
}

export function buildRouterOutput(
  command: RouterCommand,
  discovered: readonly DiscoveredProduct[],
  productId?: CatalogProductId,
): RouterOutput {
  const products = discovered
    .filter((product) => productId === undefined || product.productId === productId)
    .map(normalizedProduct)
    .sort(compareRouterProducts);
  const diagnostics = products.flatMap((product) => product.diagnostics).sort(compareRouterDiagnostics);
  return { schemaVersion: ROUTER_OUTPUT_SCHEMA_VERSION, command, products, diagnostics };
}

function line(label: string, value: string): string {
  return `  ${label}: ${value}`;
}

/** Render the exact normalized model used by JSON output. */
export function renderRouterOutput(output: RouterOutput): string {
  const lines = [`Kontour ${output.command} (${output.schemaVersion})`];
  for (const product of output.products) {
    lines.push("", `${product.displayName} [${product.id}]`, line("owner", product.owner));
    lines.push(line("package", `${product.package.name}@${product.package.version ?? "unknown"}`));
    lines.push(line("availability", product.availability), line("protocol", `${product.protocolVersion} (${product.compatible ? "compatible" : "incompatible"})`));
    lines.push(line("descriptor", product.descriptorSource), line("executable", product.executableSource));
    if (output.command === "capabilities") {
      for (const command of product.commands) {
        lines.push(`  command ${command.path.join(" ")} — ${command.sideEffect}; confirmation=${command.authority.confirmation}`);
      }
      for (const artifact of product.artifacts) lines.push(`  artifact ${artifact.id} — ${artifact.direction}; ${artifact.mediaType}`);
      for (const projection of product.projections) lines.push(`  projection ${projection.id} — ${projection.schemaRef}`);
    }
    for (const item of product.diagnostics) lines.push(`  ${item.severity} ${item.code}: ${item.message}`);
    if (output.command === "doctor") {
      for (const item of product.remediation) lines.push(`  remediation: ${item}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

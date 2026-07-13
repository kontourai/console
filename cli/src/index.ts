export {
  COMPATIBILITY_CATALOG_VERSION,
  compatibilityCatalog,
  type CatalogProductId,
  type CompatibilityCatalogEntry,
  type DescriptorSource,
} from "./catalog";
export {
  ROUTER_OUTPUT_SCHEMA_VERSION,
  compareRouterDiagnostics,
  compareRouterProducts,
  type ProductAvailability,
  type RouterCommand,
  type RouterDiagnostic,
  type RouterDiagnosticCode,
  type RouterOutput,
  type RouterProductResult,
} from "./router-output";
export { parseCommandLine, selectNamespace, type NamespaceSelection, type ParsedCommandLine, type ProductRootOption } from "./command-line";
export { PRODUCT_DESCRIPTOR_ASSET, discoverProducts, resolveDiscoveredExecutable, type DiscoveredProduct, type ProductDiscoveryOptions } from "./discovery";
export { helpScope, renderHelp, type HelpScope } from "./help";
export { discoverFromOptions, routeCommand, type RouteDiagnostic, type RouteResult } from "./router";
export {
  EXACT_VERSION_PLACEHOLDER,
  missingProductRemediation,
  validateExactPackageSpec,
  validateExplicitDownloadSpecs,
  type ExactPackageSpec,
  type ExactPackageSpecResult,
  type InstallPolicyDiagnostic,
  type InstallPolicyDiagnosticCode,
  type MissingProductRemediation,
} from "./install-policy";
export { buildRouterOutput, renderRouterOutput } from "./output";
export { runCli, type CliDependencies, type CliIo } from "./cli";

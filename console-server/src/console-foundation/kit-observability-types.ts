/**
 * Structural types at Console's optional Kit adapter boundary (contract 1.0).
 * These declarations ship with Console; adopters need no Flow Agents package
 * merely to typecheck Console. Flow Agents still owns validation, descriptor
 * digests and negotiation. The real loader and producer conformance tests check
 * compatibility in both directions against the installed producer contract.
 */
export type KitObservabilityProjectionKind = "run_summary" | "metric_series" | "queue" | "grounded_narrative" | "learning";
export type KitObservabilityAuthority = "flow" | "surface" | "runtime";
export type KitObservabilityHostCapability = "standard_views" | "mcp_apps_resource_bridge" | "resource.open" | "export.local" | "proposal.review";
export type KitObservabilityDiagnosticCode = "contribution_absent" | "contribution_not_installed" | "contribution_disabled" | "invalid_contribution" | "unsupported_contract_version" | "host_contract_version_unsupported" | "required_host_capability_missing" | "optional_host_capability_unavailable" | "operator_intent_capability_unavailable";
export type KitObservabilityDiagnostic = {
  code: KitObservabilityDiagnosticCode;
  message: string;
};
export type KitObservabilityAuthorityRefs = Partial<Record<KitObservabilityAuthority, string>>;
export type KitObservabilityProjection = {
  schema_ref: string;
};
export type KitObservabilityMcpAppsResource = {
  uri: string;
  mime_type: "text/html;profile=mcp-app";
};
export type KitObservabilityMcpAppsBridgeDeclaration = {
  tool_name: string;
  visibility: ["model", "app"];
};
export type KitObservabilityMcpAppsBridgeResult = KitObservabilityMcpAppsBridgeDeclaration & {
  tool_meta: {
    ui: {
      resourceUri: string;
      visibility: ["model", "app"];
    };
  };
};
export type KitObservabilityPresentation = {
  preferred: {
    kind: "mcp_apps_resource_bridge";
    resource: KitObservabilityMcpAppsResource;
    bridge: KitObservabilityMcpAppsBridgeDeclaration;
  };
  fallback: {
    kind: "standard_views";
    source: "declared_projections";
  };
};
export type KitObservabilityOperatorAction = {
  intent: "open_resource";
  label: string;
  required_capability: "resource.open";
  target: {
    authority: KitObservabilityAuthority;
    kind: "workflow_run" | "work_item" | "narrative" | "queue_item";
  };
} | {
  intent: "export_local";
  label: string;
  required_capability: "export.local";
} | {
  intent: "review_proposal";
  label: string;
  required_capability: "proposal.review";
  target: {
    authority: "surface";
    kind: "proposal";
  };
};
export type KitObservabilityContribution = {
  apiVersion: "flowagents.kontourai.io/v1alpha1";
  kind: "KitObservabilityContribution";
  metadata: {
    name: string;
  };
  spec: {
    contract_version: "1.0";
    package_ref: string;
    projections: Partial<Record<KitObservabilityProjectionKind, KitObservabilityProjection>>;
    authority_refs: KitObservabilityAuthorityRefs;
    host: {
      required_capabilities: ["standard_views"];
      optional_capabilities: ["mcp_apps_resource_bridge"];
      presentation: KitObservabilityPresentation;
    };
    data_policy: {
      redaction: "declared";
      retention: "kit_owned";
      raw_source: "available" | "unavailable";
    };
    operator_intents: KitObservabilityOperatorAction[];
    compatibility: {
      unsupported_version: "diagnostic";
    };
  };
};
export type KitObservabilityRecord = {
  apiVersion: "flowagents.kontourai.io/v1alpha1";
  kind: "KitObservabilityRecord";
  metadata: {
    name: string;
  };
  spec: {
    binding: {
      contribution_ref: string;
      descriptor_digest: string;
      package_ref: string;
    };
    projection: {
      kind: KitObservabilityProjectionKind;
    };
    authority_refs: KitObservabilityAuthorityRefs;
    data: Record<string, unknown>;
  };
};
export type KitObservabilityHostState = {
  installed: boolean;
  enabled: boolean;
  supported_contract_versions: readonly string[];
  capabilities: readonly KitObservabilityHostCapability[];
};
export type KitObservabilityNegotiation = {
  status: "enabled" | "disabled" | "incompatible";
  presentation?: {
    kind: "mcp_apps_resource_bridge";
    resource: KitObservabilityMcpAppsResource;
    bridge: KitObservabilityMcpAppsBridgeResult;
  } | {
    kind: "standard_views";
    source: "declared_projections";
  };
  provenance?: {
    contribution_ref: string;
    descriptor_digest: string;
    package_ref: string;
    authority_refs: KitObservabilityAuthorityRefs;
  };
  navigation: {
    available_operator_intents: KitObservabilityOperatorAction[];
  };
  available_operator_intents: KitObservabilityOperatorAction[];
  diagnostics: KitObservabilityDiagnostic[];
};

import type {
  KitObservabilityContribution,
  KitObservabilityDiagnostic,
  KitObservabilityHostState,
  KitObservabilityNegotiation,
  KitObservabilityRecord,
} from "@kontourai/flow-agents/kit-observability-contract" with { "resolution-mode": "import" };

export type KitEvidenceMode = "observational" | "controlled";
export type KitContributionLifecycle =
  | "not_installed"
  | "enabled"
  | "degraded"
  | "disabled"
  | "incompatible";

export type KitSourceRef = {
  tenant_id: string;
  authority: "flow" | "surface" | "runtime";
  ref: string;
};

export type KitRecordProvenance = {
  mode: KitEvidenceMode;
  run_id: string;
  source_refs: KitSourceRef[];
};

export type KitContributionRegistration = {
  tenant_id?: string;
  contribution: unknown;
  lifecycle?: { installed?: boolean; enabled?: boolean };
};

export type KitRecordIngest = {
  tenant_id?: string;
  record: unknown;
  provenance: KitRecordProvenance;
};

export type KitQuarantineReason =
  | "invalid_descriptor"
  | "unsupported_version"
  | "unknown_contribution"
  | "invalid_record"
  | "cross_tenant_reference"
  | "invalid_source_reference"
  | "unsafe_content"
  | "conflicting_replay";

export type KitQuarantineEntry = {
  id: string;
  reason: KitQuarantineReason;
  diagnostic: string;
  contribution_ref?: string;
  run_id?: string;
  record_id?: string;
};

export type KitContributionRead = {
  contribution_ref: string;
  package_ref: string;
  descriptor_digest: string;
  lifecycle: KitContributionLifecycle;
  presentation: "standard_views";
  diagnostics: KitObservabilityDiagnostic[];
  projection_kinds: string[];
};

export type KitRunRead = {
  run_id: string;
  contribution_ref: string;
  descriptor_digest: string;
  package_ref: string;
  contribution_lifecycle_at_ingest: KitContributionLifecycle;
  record_id: string;
  projection_kind: string;
  evidence_mode: KitEvidenceMode;
  source_refs: KitSourceRef[];
  /** Untrusted producer data. Renderers must treat every string as text. */
  data: Record<string, unknown>;
};

export type KitAggregateRead = {
  contribution_ref: string;
  descriptor_digest: string;
  package_ref: string;
  evidence_mode: KitEvidenceMode;
  run_count: number;
  run_ids: string[];
  source_refs: KitSourceRef[];
};

export type KitWorkspaceRead = {
  tenant_id: string;
  contributions: KitContributionRead[];
  aggregates: KitAggregateRead[];
  runs: KitRunRead[];
  quarantine: KitQuarantineEntry[];
  limitations: ["in_memory_not_durable", "causal_lift_not_computed", "mcp_apps_not_executed"];
};

export type KitObservabilityContractAdapter = {
  validateContribution(value: unknown): KitObservabilityContribution;
  validateRecord(value: unknown, contribution: KitObservabilityContribution): KitObservabilityRecord;
  descriptorDigest(contribution: KitObservabilityContribution): string;
  negotiate(contribution: KitObservabilityContribution, host: KitObservabilityHostState): KitObservabilityNegotiation;
};

type RegisteredContribution = KitContributionRead & { descriptor: KitObservabilityContribution };

/**
 * Console-owned, tenant-scoped host for the public Flow Agents Kit contribution
 * contract. It stores projections; it never re-evaluates producer authority.
 */
export class KitObservabilityHost {
  private readonly contributions = new Map<string, RegisteredContribution>();
  private readonly runs = new Map<string, KitRunRead>();
  private readonly quarantined: KitQuarantineEntry[] = [];

  constructor(
    readonly tenantId: string,
    private readonly adapter: KitObservabilityContractAdapter,
    private readonly hostContract: Pick<KitObservabilityHostState, "supported_contract_versions" | "capabilities"> = {
      supported_contract_versions: ["1.0"],
      capabilities: ["standard_views", "resource.open", "export.local", "proposal.review"],
    },
  ) {}

  register(input: KitContributionRegistration): KitContributionRead | KitQuarantineEntry {
    assertAdvisoryTenant(input.tenant_id, this.tenantId);
    let descriptor: KitObservabilityContribution;
    try {
      descriptor = this.adapter.validateContribution(input.contribution);
    } catch (error) {
      const diagnostic = safeError(error);
      return this.quarantine(
        /apiVersion|contract_version|unsupported/i.test(diagnostic) ? "unsupported_version" : "invalid_descriptor",
        diagnostic,
      );
    }

    const installed = input.lifecycle?.installed ?? true;
    const enabled = input.lifecycle?.enabled ?? true;
    const negotiation = this.adapter.negotiate(descriptor, {
      installed,
      enabled,
      supported_contract_versions: this.hostContract.supported_contract_versions,
      capabilities: this.hostContract.capabilities,
    });
    const lifecycle = lifecycleFor(negotiation, installed);
    const read: RegisteredContribution = {
      contribution_ref: descriptor.metadata.name,
      package_ref: descriptor.spec.package_ref,
      descriptor_digest: this.adapter.descriptorDigest(descriptor),
      lifecycle,
      presentation: "standard_views",
      diagnostics: structuredClone(negotiation.diagnostics),
      projection_kinds: Object.keys(descriptor.spec.projections).sort(),
      descriptor,
    };
    this.contributions.set(contributionKey(read.contribution_ref, read.descriptor_digest), read);
    return publicContribution(read);
  }

  ingest(input: KitRecordIngest): KitRunRead | KitQuarantineEntry {
    try {
      assertAdvisoryTenant(input.tenant_id, this.tenantId);
      validateProvenance(input.provenance, this.tenantId);
    } catch (error) {
      const diagnostic = safeError(error);
      return this.quarantine(/tenant/i.test(diagnostic) ? "cross_tenant_reference" : "invalid_source_reference", diagnostic, undefined, input.provenance?.run_id);
    }

    const binding = bindingFrom(input.record);
    const contributionRef = binding?.contribution_ref;
    const registered = binding ? this.contributions.get(contributionKey(binding.contribution_ref, binding.descriptor_digest)) : undefined;
    if (!registered) {
      const knownRef = contributionRef && [...this.contributions.values()].some((entry) => entry.contribution_ref === contributionRef);
      return this.quarantine(knownRef ? "invalid_record" : "unknown_contribution", knownRef ? "record descriptor revision is not registered for this tenant" : "record contribution is not registered for this tenant", contributionRef, input.provenance.run_id);
    }
    if (registered.lifecycle === "disabled" || registered.lifecycle === "incompatible" || registered.lifecycle === "not_installed") {
      return this.quarantine("invalid_record", `contribution lifecycle is ${registered.lifecycle}`, contributionRef, input.provenance.run_id);
    }

    let record: KitObservabilityRecord;
    try {
      record = this.adapter.validateRecord(input.record, registered.descriptor);
    } catch (error) {
      return this.quarantine("invalid_record", safeError(error), contributionRef, input.provenance.run_id);
    }
    const unsafe = findUnsafeContent(record.spec.data);
    if (unsafe) return this.quarantine("unsafe_content", unsafe, contributionRef, input.provenance.run_id);

    const read: KitRunRead = {
      run_id: input.provenance.run_id,
      contribution_ref: registered.contribution_ref,
      descriptor_digest: registered.descriptor_digest,
      package_ref: registered.package_ref,
      contribution_lifecycle_at_ingest: registered.lifecycle,
      record_id: record.metadata.name,
      projection_kind: record.spec.projection.kind,
      evidence_mode: input.provenance.mode,
      source_refs: structuredClone(input.provenance.source_refs),
      data: structuredClone(record.spec.data),
    };

    const key = runKey(read);
    const existing = this.runs.get(key);
    if (existing) {
      // A retry is safe only when it is the same normalized record. Never let a
      // producer reuse a stable identity to replace accepted history.
      if (sameRunRecord(existing, read)) return structuredClone(existing);
      return this.quarantine(
        "conflicting_replay",
        "record identity conflicts with an already accepted record; accepted history is preserved",
        contributionRef,
        input.provenance.run_id,
        record.metadata.name,
      );
    }
    this.runs.set(key, read);
    return structuredClone(read);
  }

  readWorkspace(): KitWorkspaceRead {
    const runs = [...this.runs.values()].map((run) => structuredClone(run));
    const groups = new Map<string, KitRunRead[]>();
    for (const run of runs) {
      const key = `${run.contribution_ref}\u0000${run.descriptor_digest}\u0000${run.evidence_mode}`;
      groups.set(key, [...(groups.get(key) ?? []), run]);
    }
    const aggregates = [...groups.values()].map((group): KitAggregateRead => ({
      contribution_ref: group[0].contribution_ref,
      descriptor_digest: group[0].descriptor_digest,
      package_ref: group[0].package_ref,
      evidence_mode: group[0].evidence_mode,
      run_count: group.length,
      run_ids: [...new Set(group.map((run) => run.run_id))].sort(),
      source_refs: uniqueSourceRefs(group.flatMap((run) => run.source_refs)),
    })).sort(compareAggregate);
    return {
      tenant_id: this.tenantId,
      contributions: [...this.contributions.values()].map(publicContribution).sort((a, b) => {
        const left = contributionKey(a.contribution_ref, a.descriptor_digest);
        const right = contributionKey(b.contribution_ref, b.descriptor_digest);
        return left < right ? -1 : left > right ? 1 : 0;
      }),
      aggregates,
      runs: runs.sort((a, b) => a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0),
      quarantine: structuredClone(this.quarantined),
      limitations: ["in_memory_not_durable", "causal_lift_not_computed", "mcp_apps_not_executed"],
    };
  }

  readRun(runId: string): KitRunRead[] {
    return [...this.runs.values()].filter((run) => run.run_id === runId).map((run) => structuredClone(run));
  }

  private quarantine(reason: KitQuarantineReason, diagnostic: string, contributionRef?: string, runId?: string, recordId?: string): KitQuarantineEntry {
    const entry: KitQuarantineEntry = {
      id: `kit-quarantine-${this.quarantined.length + 1}`,
      reason,
      diagnostic: boundedDiagnostic(diagnostic),
      ...(contributionRef ? { contribution_ref: contributionRef } : {}),
      ...(runId ? { run_id: runId } : {}),
      ...(recordId ? { record_id: recordId } : {}),
    };
    this.quarantined.push(entry);
    return structuredClone(entry);
  }
}

export async function loadKitObservabilityContractAdapter(): Promise<KitObservabilityContractAdapter> {
  const contract = await import("@kontourai/flow-agents/kit-observability-contract");
  return {
    validateContribution: contract.validateKitObservabilityContribution,
    validateRecord: contract.validateKitObservabilityRecord,
    descriptorDigest: contract.kitObservabilityDescriptorDigest,
    negotiate: (contribution, host) => contract.negotiateKitObservabilityContribution(
      { status: "supported", contribution, diagnostics: [] },
      host,
    ),
  };
}

/** Escape-only standard-view rendering. No producer HTML is executed. */
export function renderKitStandardViewText(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function publicContribution(value: RegisteredContribution): KitContributionRead {
  const { descriptor: _descriptor, ...read } = value;
  return structuredClone(read);
}

function lifecycleFor(negotiation: KitObservabilityNegotiation, installed: boolean): KitContributionLifecycle {
  if (!installed) return "not_installed";
  if (negotiation.status === "disabled") return "disabled";
  if (negotiation.status === "incompatible") return "incompatible";
  return negotiation.diagnostics.length > 0 ? "degraded" : "enabled";
}

function assertAdvisoryTenant(advisory: string | undefined, authoritative: string): void {
  if (advisory !== undefined && advisory !== authoritative) throw new Error("payload tenant does not match authenticated tenant");
}

function validateProvenance(value: KitRecordProvenance, tenantId: string): void {
  if (!value || !["observational", "controlled"].includes(value.mode)) throw new Error("provenance mode must be observational or controlled");
  if (typeof value.run_id !== "string" || !value.run_id.trim() || value.run_id.length > 256) throw new Error("provenance run_id is invalid");
  if (!Array.isArray(value.source_refs) || value.source_refs.length === 0) throw new Error("provenance source_refs must be non-empty");
  for (const source of value.source_refs) {
    if (!source || source.tenant_id !== tenantId) throw new Error("cross-tenant source reference is forbidden");
    if (!["flow", "surface", "runtime"].includes(source.authority)) throw new Error("source reference authority is invalid");
    if (typeof source.ref !== "string" || !source.ref.startsWith(`${source.authority}://`) || !/^(flow|surface|runtime):\/\/[^\s\u0000-\u001f\u007f]+$/.test(source.ref)) throw new Error("source reference authority and identity must match");
  }
}

function bindingFrom(value: unknown): { contribution_ref: string; descriptor_digest: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const spec = (value as { spec?: unknown }).spec;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return undefined;
  const binding = (spec as { binding?: unknown }).binding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return undefined;
  const candidate = binding as { contribution_ref?: unknown; descriptor_digest?: unknown };
  return typeof candidate.contribution_ref === "string" && typeof candidate.descriptor_digest === "string"
    ? { contribution_ref: candidate.contribution_ref, descriptor_digest: candidate.descriptor_digest }
    : undefined;
}

function findUnsafeContent(value: unknown, path = "data"): string | undefined {
  if (typeof value === "string") {
    if (/[^\u0009\u000a\u000d\u0020-\uffff]/u.test(value)) return `${path} contains forbidden control bytes`;
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{16,}|\b(?:api[_-]?key|token|password)\s*[:=]\s*[^\s]{8,}/i.test(value)) return `${path} contains a redaction canary or secret-like value`;
    return undefined;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const unsafe = findUnsafeContent(value[index], `${path}[${index}]`);
      if (unsafe) return unsafe;
    }
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const unsafeKey = findUnsafeKey(key, path);
      if (unsafeKey) return unsafeKey;
      const unsafe = findUnsafeContent(entry, `${path}.${key}`);
      if (unsafe) return unsafe;
    }
  }
  return undefined;
}

function findUnsafeKey(key: string, parentPath: string): string | undefined {
  const unsafe = findUnsafeContent(key, `${parentPath} key`);
  if (unsafe) return unsafe;
  if (/^(?:api[_-]?key|(?:access|refresh|id|client)[_-]?token|token|password|secret|credential|private[_-]?key)$/i.test(key)) {
    return `${parentPath} contains a secret-like key`;
  }
  return undefined;
}

function runKey(run: KitRunRead): string {
  return `${run.contribution_ref}\u0000${run.descriptor_digest}\u0000${run.evidence_mode}\u0000${run.run_id}\u0000${run.record_id}`;
}

function sameRunRecord(left: KitRunRead, right: KitRunRead): boolean {
  return stableJson(left) === stableJson(right);
}

/** Canonicalize JSON-shaped validated records so key insertion order cannot turn a safe retry into a conflict. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function contributionKey(contributionRef: string, descriptorDigest: string): string {
  return `${contributionRef}\u0000${descriptorDigest}`;
}

function uniqueSourceRefs(refs: KitSourceRef[]): KitSourceRef[] {
  const unique = new Map(refs.map((ref) => [`${ref.tenant_id}\u0000${ref.authority}\u0000${ref.ref}`, ref]));
  return [...unique.values()].map((ref) => structuredClone(ref)).sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
}

function compareAggregate(left: KitAggregateRead, right: KitAggregateRead): number {
  const leftKey = `${left.contribution_ref}\u0000${left.descriptor_digest}\u0000${left.evidence_mode}`;
  const rightKey = `${right.contribution_ref}\u0000${right.descriptor_digest}\u0000${right.evidence_mode}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Kit observability input is invalid";
}

function boundedDiagnostic(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
}

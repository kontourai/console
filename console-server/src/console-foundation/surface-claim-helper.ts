import type { ConsoleActionRecord, CrossProductRef, OpenRecord } from "./types";

const DEFAULT_VERSION = "0.1";
const DEFAULT_PRODUCER = { product: "surface", id: "surface-console-producer" };

type MutableRecord = Record<string, unknown>;
type ResourceLike = OpenRecord & { metadata?: OpenRecord };
type ResourceFields = {
  apiVersion?: unknown;
  name?: unknown;
  uid?: unknown;
  scope?: unknown;
};
type RefMergeField = "apiVersion" | "name" | "uid" | "scope" | "label" | "url";
type StatusRecord = OpenRecord & { status?: unknown };

export function surfaceClaimStateToProjection(state: OpenRecord, options: OpenRecord = {}) {
  requireObject(state, "state");
  const claimId = requireString(state.claimId || state.id, "state.claimId");
  const generatedAt = options.generatedAt || state.generatedAt || state.lastUpdatedAt;
  const producer = clone(options.producer || state.producer || DEFAULT_PRODUCER);
  const scope = clone(options.scope || state.scope || { product: "surface", kind: "claim_set", id: claimId });
  const claimRef = refWithResource(
    clone((state.claimRef || { product: "surface", kind: "claim", id: claimId }) as CrossProductRef),
    options.claimResource || state.claimResource,
    {
      apiVersion: options.claimApiVersion || state.claimApiVersion,
      name: options.claimName || state.claimName,
      uid: options.claimUid || state.claimUid,
      scope: options.claimScope || state.claimScope
    }
  );
  const evidenceRefs = cloneArray<CrossProductRef>(state.evidenceRefs).map((ref) => refWithResource(ref, ref && ref.resource));
  const actionDescriptors = cloneArray<ConsoleActionRecord>(options.actions || state.actions);
  const actionRefs = mergeRefs(
    cloneArray<CrossProductRef>(state.actionRefs).map((ref) => refWithResource(ref, ref && ref.resource)),
    actionDescriptors
      .filter((action) => action && action.id)
      .map(actionToRef)
  );

  const claim = {
    id: claimId,
    label: state.label,
    status: requireString(state.status, "state.status"),
    currentValue: clone(state.currentValue),
    freshness: clone(state.freshness),
    validFrom: state.validFrom,
    validUntil: state.validUntil,
    lastUpdatedAt: state.lastUpdatedAt,
    lastVerifiedAt: state.lastVerifiedAt,
    evidenceRefs,
    actionRefs,
    sourceRef: claimRef,
    extensions: clone(state.extensions)
  };

  return compactObject({
    schema: "kontour.console.projection",
    version: options.version || state.version || DEFAULT_VERSION,
    id: options.id || state.projectionId,
    generatedAt: requireString(generatedAt, "state.generatedAt"),
    derivedFrom: clone(options.derivedFrom || state.derivedFrom || { directSnapshot: claimRef }),
    producer,
    scope,
    claims: [compactObject(claim)],
    evidence: cloneArray(state.evidence),
    actions: actionDescriptors.map(cleanActionDescriptor),
    links: cloneArray(state.links),
    extensions: clone(options.extensions || state.projectionExtensions)
  });
}

export function surfaceFreshnessTransitionToEvent(transition: OpenRecord, options: OpenRecord = {}) {
  requireObject(transition, "transition");
  const claimId = requireString(transition.claimId || transition.id, "transition.claimId");
  const occurredAt = options.occurredAt || transition.occurredAt || transition.changedAt;
  const producer = clone(options.producer || transition.producer || DEFAULT_PRODUCER);
  const scope = clone(options.scope || transition.scope || { product: "surface", kind: "claim_set", id: claimId });
  const subject = refWithResource(
    clone((transition.subject || transition.claimRef || { product: "surface", kind: "claim", id: claimId }) as CrossProductRef),
    options.claimResource || transition.claimResource,
    {
      apiVersion: options.claimApiVersion || transition.claimApiVersion,
      name: options.claimName || transition.claimName,
      uid: options.claimUid || transition.claimUid,
      scope: options.claimScope || transition.claimScope
    }
  );
  const refs = cloneArray<CrossProductRef>(transition.refs).map((ref) => refWithResource(ref, ref && ref.resource));

  if (!hasRef(refs, subject)) refs.unshift(clone(subject));

  return compactObject({
    schema: "kontour.console.event",
    version: options.version || transition.version || DEFAULT_VERSION,
    id: options.id || transition.id || `surface:${claimId}:freshness:${freshnessKey(transition.before)}->${freshnessKey(transition.after)}`,
    type: "claim.freshness.changed",
    occurredAt: requireString(occurredAt, "transition.occurredAt"),
    producer,
    scope,
    subject,
    payload: compactObject({
      before: clone(transition.before),
      after: clone(transition.after),
      refs,
      reason: transition.reason,
      data: clone(transition.data)
    }),
    links: cloneArray(transition.links),
    extensions: clone(options.extensions || transition.extensions)
  });
}

function requireObject(value: unknown, label: string): asserts value is OpenRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function cloneArray<T = OpenRecord>(value: unknown): T[] {
  return Array.isArray(value) ? clone(value) : [];
}

function clone<T>(value: T): T;
function clone(value: undefined): undefined;
function clone<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as T;
}

function actionToRef(action: ConsoleActionRecord) {
  const authority = asOpenRecord(action.authority);
  return refWithResource(clone((action.ref || {
    product: firstString(action.product, authority.product, "surface"),
    kind: "action",
    id: action.id
  }) as CrossProductRef), action.resource, {
    apiVersion: action.apiVersion,
    name: action.name,
    uid: action.uid,
    scope: action.scope
  });
}

function cleanActionDescriptor(action: ConsoleActionRecord) {
  const copy = compactObject(clone(action));
  ["resource", "ref", "apiVersion", "name", "uid", "scope"].forEach((key) => delete copy[key]);
  return copy;
}

function refWithResource<T extends OpenRecord>(ref: T, resource: unknown, fields?: ResourceFields): T;
function refWithResource(ref: undefined, resource: unknown, fields?: ResourceFields): undefined;
function refWithResource<T extends OpenRecord>(ref: T | undefined, resource: unknown, fields: ResourceFields = {}): T | undefined {
  if (!ref) return ref;
  const copy = clone(ref);
  const resourceRecord = asResource(resource);
  const metadata = asOpenRecord(resourceRecord.metadata);
  const enriched = {
    apiVersion: firstDefined(fields.apiVersion, resourceRecord.apiVersion),
    name: firstDefined(fields.name, metadata.name, resourceRecord.name),
    uid: firstDefined(fields.uid, metadata.uid, resourceRecord.uid),
    scope: firstDefined(fields.scope, resourceRecord.scope)
  };
  for (const [key, value] of Object.entries(enriched)) {
    if (value !== undefined && copy[key] === undefined) (copy as OpenRecord)[key] = clone(value);
  }
  delete copy.resource;
  return copy;
}

function mergeRefs(primary: CrossProductRef[], secondary: CrossProductRef[]) {
  const merged = primary.map((ref) => clone(ref));
  for (const ref of secondary) {
    const existing = merged.find((item) => hasRef([item], ref));
    if (existing) {
      for (const key of ["apiVersion", "name", "uid", "scope", "label", "url"] as RefMergeField[]) {
        if (existing[key] === undefined && ref[key] !== undefined) (existing as OpenRecord)[key] = clone(ref[key]);
      }
    } else {
      merged.push(clone(ref));
    }
  }
  return merged;
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined);
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) || "";
}

function hasRef(refs: CrossProductRef[], ref: CrossProductRef | undefined) {
  return refs.some((item) => item && ref && item.product === ref.product && item.kind === ref.kind && item.id === ref.id);
}

function freshnessKey(value: unknown) {
  const record = asStatusRecord(value);
  if (record) return record.status || stableStringify(record);
  return String(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as OpenRecord;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function compactObject(object: OpenRecord) {
  return Object.keys(object).reduce<MutableRecord>((copy, key) => {
    if (object[key] !== undefined) copy[key] = object[key];
    return copy;
  }, {});
}

function asOpenRecord(value: unknown): OpenRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as OpenRecord : {};
}

function asResource(value: unknown): ResourceLike {
  return asOpenRecord(value) as ResourceLike;
}

function asStatusRecord(value: unknown): StatusRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as StatusRecord : undefined;
}

module.exports = {
  surfaceClaimStateToProjection,
  surfaceFreshnessTransitionToEvent
};

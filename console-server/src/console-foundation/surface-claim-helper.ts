const DEFAULT_VERSION = "0.1";
const DEFAULT_PRODUCER = { product: "surface", id: "surface-console-producer" };

function surfaceClaimStateToProjection(state: any, options: any = {}) {
  requireObject(state, "state");
  const claimId = requireString(state.claimId || state.id, "state.claimId");
  const generatedAt = options.generatedAt || state.generatedAt || state.lastUpdatedAt;
  const producer = clone(options.producer || state.producer || DEFAULT_PRODUCER);
  const scope = clone(options.scope || state.scope || { product: "surface", kind: "claim_set", id: claimId });
  const claimRef = refWithResource(
    clone(state.claimRef || { product: "surface", kind: "claim", id: claimId }),
    options.claimResource || state.claimResource,
    {
      apiVersion: options.claimApiVersion || state.claimApiVersion,
      name: options.claimName || state.claimName,
      uid: options.claimUid || state.claimUid,
      scope: options.claimScope || state.claimScope
    }
  );
  const evidenceRefs = cloneArray(state.evidenceRefs).map((ref: any) => refWithResource(ref, ref && ref.resource));
  const actionDescriptors = cloneArray(options.actions || state.actions);
  const actionRefs = mergeRefs(
    cloneArray(state.actionRefs).map((ref: any) => refWithResource(ref, ref && ref.resource)),
    actionDescriptors
      .filter((action: any) => action && action.id)
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

function surfaceFreshnessTransitionToEvent(transition: any, options: any = {}) {
  requireObject(transition, "transition");
  const claimId = requireString(transition.claimId || transition.id, "transition.claimId");
  const occurredAt = options.occurredAt || transition.occurredAt || transition.changedAt;
  const producer = clone(options.producer || transition.producer || DEFAULT_PRODUCER);
  const scope = clone(options.scope || transition.scope || { product: "surface", kind: "claim_set", id: claimId });
  const subject = refWithResource(
    clone(transition.subject || transition.claimRef || { product: "surface", kind: "claim", id: claimId }),
    options.claimResource || transition.claimResource,
    {
      apiVersion: options.claimApiVersion || transition.claimApiVersion,
      name: options.claimName || transition.claimName,
      uid: options.claimUid || transition.claimUid,
      scope: options.claimScope || transition.claimScope
    }
  );
  const refs = cloneArray(transition.refs).map((ref: any) => refWithResource(ref, ref && ref.resource));

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

function requireObject(value: any, label: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function requireString(value: any, label: any) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function cloneArray(value: any) {
  return Array.isArray(value) ? clone(value) : [];
}

function clone(value: any) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function actionToRef(action: any) {
  return refWithResource(clone(action.ref || {
    product: action.product || action.authority && action.authority.product || "surface",
    kind: "action",
    id: action.id
  }), action.resource, {
    apiVersion: action.apiVersion,
    name: action.name,
    uid: action.uid,
    scope: action.scope
  });
}

function cleanActionDescriptor(action: any) {
  const copy = compactObject(clone(action));
  ["resource", "ref", "apiVersion", "name", "uid", "scope"].forEach((key: any) => delete copy[key]);
  return copy;
}

function refWithResource(ref: any, resource: any, fields: any = {}) {
  if (!ref) return ref;
  const copy = clone(ref);
  const metadata = resource && resource.metadata || {};
  const enriched = {
    apiVersion: firstDefined(fields.apiVersion, resource && resource.apiVersion),
    name: firstDefined(fields.name, metadata.name, resource && resource.name),
    uid: firstDefined(fields.uid, metadata.uid, resource && resource.uid),
    scope: firstDefined(fields.scope, resource && resource.scope)
  };
  for (const [key, value] of Object.entries(enriched)) {
    if (value !== undefined && copy[key] === undefined) copy[key] = clone(value);
  }
  delete copy.resource;
  return copy;
}

function mergeRefs(primary: any, secondary: any) {
  const merged = primary.map(clone);
  for (const ref of secondary) {
    const existing = merged.find((item: any) => hasRef([item], ref));
    if (existing) {
      for (const key of ["apiVersion", "name", "uid", "scope", "label", "url"]) {
        if (existing[key] === undefined && ref[key] !== undefined) existing[key] = clone(ref[key]);
      }
    } else {
      merged.push(clone(ref));
    }
  }
  return merged;
}

function firstDefined(...values: any[]) {
  return values.find((value: any) => value !== undefined);
}

function hasRef(refs: any, ref: any) {
  return refs.some((item: any) => item && ref && item.product === ref.product && item.kind === ref.kind && item.id === ref.id);
}

function freshnessKey(value: any) {
  if (value && typeof value === "object") return value.status || stableStringify(value);
  return String(value);
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key: any) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function compactObject(object: any) {
  return Object.keys(object).reduce((copy: any, key: any) => {
    if (object[key] !== undefined) copy[key] = object[key];
    return copy;
  }, {});
}

module.exports = {
  surfaceClaimStateToProjection,
  surfaceFreshnessTransitionToEvent
};

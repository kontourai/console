const DEFAULT_VERSION = "0.1";
const DEFAULT_PRODUCER = { product: "surface", id: "surface-console-producer" };

function surfaceClaimStateToProjection(state, options = {}) {
  requireObject(state, "state");
  const claimId = requireString(state.claimId || state.id, "state.claimId");
  const generatedAt = options.generatedAt || state.generatedAt || state.lastUpdatedAt;
  const producer = clone(options.producer || state.producer || DEFAULT_PRODUCER);
  const scope = clone(options.scope || state.scope || { product: "surface", kind: "claim_set", id: claimId });
  const evidenceRefs = cloneArray(state.evidenceRefs);
  const actionDescriptors = cloneArray(options.actions || state.actions);
  const actionRefs = cloneArray(state.actionRefs).concat(
    actionDescriptors
      .filter((action) => action && action.id)
      .map((action) => ({
        product: action.product || action.authority && action.authority.product || "surface",
        kind: "action",
        id: action.id
      }))
      .filter((ref) => !hasRef(cloneArray(state.actionRefs), ref))
  );
  const claimRef = clone(state.claimRef || { product: "surface", kind: "claim", id: claimId });

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
    actions: actionDescriptors.map(compactObject),
    links: cloneArray(state.links),
    extensions: clone(options.extensions || state.projectionExtensions)
  });
}

function surfaceFreshnessTransitionToEvent(transition, options = {}) {
  requireObject(transition, "transition");
  const claimId = requireString(transition.claimId || transition.id, "transition.claimId");
  const occurredAt = options.occurredAt || transition.occurredAt || transition.changedAt;
  const producer = clone(options.producer || transition.producer || DEFAULT_PRODUCER);
  const scope = clone(options.scope || transition.scope || { product: "surface", kind: "claim_set", id: claimId });
  const subject = clone(transition.subject || transition.claimRef || { product: "surface", kind: "claim", id: claimId });
  const refs = cloneArray(transition.refs);

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

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function cloneArray(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function hasRef(refs, ref) {
  return refs.some((item) => item && ref && item.product === ref.product && item.kind === ref.kind && item.id === ref.id);
}

function freshnessKey(value) {
  if (value && typeof value === "object") return value.status || stableStringify(value);
  return String(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function compactObject(object) {
  return Object.keys(object).reduce((copy, key) => {
    if (object[key] !== undefined) copy[key] = object[key];
    return copy;
  }, {});
}

module.exports = {
  surfaceClaimStateToProjection,
  surfaceFreshnessTransitionToEvent
};

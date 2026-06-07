import type { ConsoleActionRecord, CrossProductRef, OpenRecord } from "./types";

const DEFAULT_VERSION = "0.1";
const DEFAULT_PRODUCER = { product: "flow", id: "flow-console-producer" };

type MutableRecord = Record<string, unknown>;
type ResourceLike = OpenRecord & { metadata?: OpenRecord };
type ResourceFields = {
  apiVersion?: unknown;
  name?: unknown;
  uid?: unknown;
  scope?: unknown;
};
type GateRecord = OpenRecord & { id?: string; status?: string };
type ProcessRecord = OpenRecord & { id?: string; openGateRefs?: CrossProductRef[] };
type StatusRecord = OpenRecord & { status?: unknown };

function flowProcessStateToProjection(state: OpenRecord, options: OpenRecord = {}) {
  requireObject(state, "state");
  const stateProcess = asOpenRecord(state.process);
  const processId = requireString(stateProcess.id || state.processId || state.id, "state.processId");
  const generatedAt = options.generatedAt || state.generatedAt || state.updatedAt || stateProcess.updatedAt;
  const producer = clone(options.producer || state.producer || DEFAULT_PRODUCER);
  const scope = clone(options.scope || state.scope || { product: "flow", kind: "process_run", id: processId });
  const processRef = refWithResource(
    clone((state.processRef || stateProcess.processRef || { product: "flow", kind: "run", id: processId }) as CrossProductRef),
    options.processResource || state.processResource || stateProcess.processResource,
    {
      apiVersion: options.processApiVersion || state.processApiVersion || stateProcess.processApiVersion,
      name: options.processName || state.processName || stateProcess.processName,
      uid: options.processUid || state.processUid || stateProcess.processUid,
      scope: options.processScope || state.processScope || stateProcess.processScope
    }
  );
  const rawActions = cloneArray<ConsoleActionRecord>(options.actions || state.actions);
  const actions = rawActions.map(cleanActionDescriptor);
  const nextActionRefs = deriveNextActionRefs(state, rawActions);
  const primaryProcess = buildPrimaryProcess(state, stateProcess, processId, nextActionRefs);
  const processes = mergePrimaryProcess(cloneArray<ProcessRecord>(state.processes), primaryProcess);
  const gates = normalizeGates(state.gates, processRef);

  return compactObject({
    schema: "kontour.console.projection",
    version: options.version || state.version || DEFAULT_VERSION,
    id: options.id || state.projectionId,
    generatedAt: requireString(generatedAt, "state.generatedAt"),
    derivedFrom: clone(options.derivedFrom || state.derivedFrom || { directSnapshot: processRef }),
    producer,
    scope,
    processes,
    gates,
    evidence: cloneArray(state.evidence),
    decisions: cloneArray(state.decisions),
    actions,
    links: cloneArray(state.links),
    summary: compactObject({
      openGateCount: countOpenGates(gates, primaryProcess.openGateRefs),
      pendingActionCount: nextActionRefs.length
    }),
    actor: clone(state.actor),
    provenance: clone(state.provenance),
    extensions: clone(options.extensions || state.extensions || state.projectionExtensions)
  });
}

function deriveNextActionRefs(state: OpenRecord, actions: ConsoleActionRecord[]) {
  const stateProcess = asOpenRecord(state.process);
  const suppliedNextActionRefs = cloneArray<CrossProductRef>(stateProcess.nextActionRefs || state.nextActionRefs);
  return suppliedNextActionRefs.concat(
    actions
      .filter((action) => action && action.id)
      .map(actionToRef)
      .filter((ref) => !hasRef(suppliedNextActionRefs, ref))
  );
}

function actionToRef(action: ConsoleActionRecord) {
  const authority = asOpenRecord(action.authority);
  return refWithResource({
    product: firstString(action.product, authority.product, "flow"),
    kind: "action",
    id: action.id,
    label: action.label
  }, action.resource, {
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

function buildPrimaryProcess(state: OpenRecord, stateProcess: OpenRecord, processId: string, nextActionRefs: CrossProductRef[]) {
  return compactObject({
    id: processId,
    definitionId: stateProcess.definitionId || state.definitionId,
    label: stateProcess.label || state.label,
    status: requireString(stateProcess.status || state.status, "state.status"),
    currentStep: clone(stateProcess.currentStep || state.currentStep),
    startedAt: stateProcess.startedAt || state.startedAt,
    updatedAt: stateProcess.updatedAt || state.updatedAt,
    completedAt: stateProcess.completedAt || state.completedAt,
    percentComplete: stateProcess.percentComplete !== undefined ? stateProcess.percentComplete : state.percentComplete,
    openGateRefs: cloneArray(stateProcess.openGateRefs || state.openGateRefs),
    claimRefs: cloneArray(stateProcess.claimRefs || state.claimRefs),
    reviewItemRefs: cloneArray(stateProcess.reviewItemRefs || state.reviewItemRefs),
    nextActionRefs,
    extensions: clone(stateProcess.extensions || state.processExtensions)
  });
}

function normalizeGates(gates: unknown, processRef: CrossProductRef) {
  return cloneArray<GateRecord>(gates).map((gate) => {
    const {
      gateResource,
      resource,
      gateApiVersion,
      apiVersion,
      gateName,
      name,
      gateUid,
      uid,
      gateScope,
      scope,
      ...publicGate
    } = gate;
    const gateRef = refWithResource(
      { product: "flow", kind: "gate", id: requireString(gate.id, "gate.id") },
      gateResource || resource,
      {
        apiVersion: gateApiVersion || apiVersion,
        name: gateName || name,
        uid: gateUid || uid,
        scope: gateScope || scope
      }
    );
    return compactObject({
      ...publicGate,
      gateRef,
      processRef: clone(gate.processRef || processRef),
      expectationRefs: cloneArray<CrossProductRef>(gate.expectationRefs).map((ref) => refWithResource(ref, ref && ref.resource)),
      evidenceRefs: cloneArray<CrossProductRef>(gate.evidenceRefs).map((ref) => refWithResource(ref, ref && ref.resource))
    });
  });
}

function flowGateTransitionToEvent(transition: OpenRecord, options: OpenRecord = {}) {
  requireObject(transition, "transition");
  const gateId = requireString(transition.gateId || transition.id, "transition.gateId");
  const occurredAt = options.occurredAt || transition.occurredAt || transition.changedAt;
  const before = clone(transition.before);
  const after = clone((transition.after || { status: transition.status }) as StatusRecord);
  const afterStatus = requireString(after.status || transition.status, "transition.after.status");
  const eventType = eventTypeFor(transition.type, before, after, afterStatus);
  const transitionProcessRef = asOpenRecord(transition.processRef);
  const processId = transition.processId || transitionProcessRef.id;
  const producer = clone(options.producer || transition.producer || DEFAULT_PRODUCER);
  const scope = clone(options.scope || transition.scope || { product: "flow", kind: "process_run", id: processId || gateId });
  const subject = refWithResource(
    clone((transition.subject || transition.gateRef || { product: "flow", kind: "gate", id: gateId }) as CrossProductRef),
    options.gateResource || transition.gateResource,
    {
      apiVersion: options.gateApiVersion || transition.gateApiVersion,
      name: options.gateName || transition.gateName,
      uid: options.gateUid || transition.gateUid,
      scope: options.gateScope || transition.gateScope
    }
  );
  const processRef = (transition.processRef || (processId ? { product: "flow", kind: "run", id: processId } : undefined)) as CrossProductRef | undefined;
  const enrichedProcessRef = processRef ? refWithResource(
    clone(processRef),
    options.processResource || transition.processResource,
    {
      apiVersion: options.processApiVersion || transition.processApiVersion,
      name: options.processName || transition.processName,
      uid: options.processUid || transition.processUid,
      scope: options.processScope || transition.processScope
    }
  ) : undefined;
  const refs = cloneArray<CrossProductRef>(transition.refs).map((ref) => refWithResource(ref, ref && ref.resource));

  if (!hasRef(refs, subject)) refs.unshift(clone(subject));
  if (enrichedProcessRef && !hasRef(refs, enrichedProcessRef)) refs.push(enrichedProcessRef);

  return compactObject({
    schema: "kontour.console.event",
    version: options.version || transition.version || DEFAULT_VERSION,
    id: options.id || transition.eventId || `flow:${processId || "process"}:gate:${gateId}:${eventType}:${statusKey(before)}->${statusKey(after)}`,
    type: eventType,
    occurredAt: requireString(occurredAt, "transition.occurredAt"),
    producer,
    scope,
    subject,
    actor: clone(transition.actor),
    correlationId: transition.correlationId,
    causationId: transition.causationId,
    sequence: transition.sequence,
    payload: compactObject({
      before,
      after,
      refs,
      summary: clone(transition.summary),
      reason: transition.reason,
      data: clone(transition.data)
    }),
    links: cloneArray(transition.links),
    extensions: clone(options.extensions || transition.extensions)
  });
}

function eventTypeFor(type: unknown, before: unknown, after: unknown, status: unknown) {
  if (typeof type === "string" && type.startsWith("gate.")) return type;
  const normalized = normalizeStatus(status);
  if (normalized === "open" || normalized === "opened") return "gate.opened";
  if (normalized === "passed" || normalized === "pass") return "gate.passed";
  if (normalized === "failed" || normalized === "fail") return "gate.failed";
  if (normalized === "routed_back" || normalized === "route_back") return "gate.routed_back";
  if (normalized === "waiting" && hasRouteBackMetadata(before, after)) return "gate.routed_back";
  return `gate.${normalized}`;
}

function hasRouteBackMetadata(before: unknown, after: unknown) {
  const beforeRecord = asOpenRecord(before);
  const afterRecord = asOpenRecord(after);
  return Boolean(
    afterRecord && (afterRecord.routeBackTo || afterRecord.routedBackTo || afterRecord.routeBackReason) ||
    beforeRecord && (beforeRecord.routeBackTo || beforeRecord.routedBackTo || beforeRecord.routeBackReason)
  );
}

function mergePrimaryProcess(processes: ProcessRecord[], primaryProcess: ProcessRecord) {
  if (processes.some((process) => process && process.id === primaryProcess.id)) return processes.map(compactObject);
  return [primaryProcess].concat(processes.map(compactObject));
}

function countOpenGates(gates: GateRecord[], openGateRefs: unknown) {
  const explicitIds = new Set(cloneArray<CrossProductRef>(openGateRefs).map((ref) => ref.id));
  return gates.filter((gate) => isOpenGate(gate) || (gate.id !== undefined && explicitIds.has(gate.id))).length;
}

function isOpenGate(gate: GateRecord) {
  return typeof gate.status === "string" && ["open", "waiting", "routed_back"].includes(gate.status);
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
  delete copy.gateResource;
  delete copy.processResource;
  return copy;
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

function normalizeStatus(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function statusKey(value: unknown) {
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
    if (isSafeObjectKey(key) && object[key] !== undefined) copy[key] = object[key];
    return copy;
  }, {});
}

function isSafeObjectKey(key: string) {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
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
  flowProcessStateToProjection,
  flowGateTransitionToEvent
};

import type { ConsoleRecordBase, ValidationIssue } from "./types";

/**
 * `kontour.flow-agents.transition` — one record per flow-agents CLI invocation,
 * the cost-enrichment producer for the gate scorecard (console #277 layer 2;
 * producer flow-agents #1274, emitter flow-agents #1273).
 *
 * THE SHAPE IS THE PRODUCER'S, NOT OURS. It is `TransitionRecord` in
 * flow-agents' `src/transition-log.ts`, published as
 * `scripts/telemetry/transition-record.schema.json` (schema id
 * https://kontourai.dev/schemas/kontour.flow-agents.transition/1.0.json), and
 * the captured fixtures under test/fixtures/flow-agents-transitions/ are real
 * emitted records — the #278 review history is one long lesson in what happens
 * when a consumer validates a shape no producer emits. Notable inherited
 * decisions this validator must not "improve":
 *
 *  - the type discriminator is `schema` + `version`, NOT `kind` — flow-agents
 *    already uses `.kind` as a within-type discriminator elsewhere;
 *  - `command` and `verb` are REQUIRED BUT NULLABLE (an interrupted or
 *    unregistered invocation is still a true record of an invocation);
 *  - argv is never present. `targets` carries only allowlisted identifier-flag
 *    values; `flags` carries flag NAMES only; `error_name` is a thrown error's
 *    CLASS name (bounded at 80 chars), never its message. Rejecting records for
 *    carrying MORE than this is right; expecting more is wrong;
 *  - the producer schema declares `additionalProperties: true`, so unknown extra
 *    fields are ACCEPTED here — a producer minor-version addition must not turn
 *    into a fleet-wide 400;
 *  - `exit_code`/`outcome` classify the PROCESS exit, and exit 70 mixes contract
 *    refusals with genuine faults ("unhandled-error", deliberately not
 *    "crashed"). `gate_outcome` ("advanced" | "awaiting"), when present, is what
 *    the GATE did — the two disagree by design (transition-log.ts,
 *    noteGateOutcome).
 *
 * `output_tokens` is the ONE console-side extension: the emitter's per-invocation
 * output-token attribution. No producer emits it yet — flow-agents' own scorer
 * (`scripts/telemetry/gate-scorecard.mjs` attributeTokens) computes exactly this
 * value at fold time by matching each transition to the most recent preceding
 * transcript turn, consuming each turn AT MOST ONCE — so this field is that
 * producer vocabulary carried onto the wire, declared ahead of the emitter
 * because `validateRecordBody()` rejects unknown kinds outright and consumer
 * must land first (flow-agents#1273). A transition whose turn was already
 * consumed by an earlier transition gets NO tokens of its own (the field is
 * simply absent), which is why every per-gate figure folded from this is a
 * FLOOR: attribution covers output tokens only, and only for transitions that
 * won their turn.
 */
export const TRANSITION_SCHEMA = "kontour.flow-agents.transition" as const;
export const TRANSITION_SCHEMA_VERSION = "1.0" as const;

export type TransitionOutcome = "ok" | "nonzero" | "unhandled-error" | "usage";
const TRANSITION_OUTCOMES: readonly TransitionOutcome[] = ["ok", "nonzero", "unhandled-error", "usage"];
/** The producer bounds `error_name` at 80 chars before recording (MAX_ERROR_NAME). */
const MAX_ERROR_NAME_LENGTH = 80;

export interface ConsoleTransitionRecord extends ConsoleRecordBase {
  schema: typeof TRANSITION_SCHEMA;
  version: typeof TRANSITION_SCHEMA_VERSION;
  command: string | null;
  verb: string | null;
  /** Allowlisted identifier-flag values. `expectation` + `flow` are the join keys
   *  the scorecard cost enrichment consumes. */
  targets: Record<string, string>;
  flags: string[];
  exit_code: number;
  outcome: TransitionOutcome;
  error_name?: string;
  gate_outcome?: "advanced" | "awaiting";
  gate_missing?: string[];
  started_at: string;
  duration_ms: number;
  cwd_repo?: string | null;
  actor: { runtime: string | null; session_id: string | null };
  /** Emitter-side output-token attribution for THIS invocation's turn — see the
   *  module doc. Absent ≠ zero: absent means "no turn attributed", and the fold
   *  reports it as such (`transitions_without_turn`), never as 0 tokens. */
  output_tokens?: number;
}

function issue(path: string, message: string): ValidationIssue {
  return { severity: "error", path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate one wire record against the producer contract above. Returns issues
 * (empty = valid); the ingest boundary maps a non-empty list to 400
 * INVALID_RECORD. Field-for-field mirror of transition-record.schema.json plus
 * the two optional gate_outcome fields the producer's TS type defines, plus the
 * optional `output_tokens` extension.
 */
export function validateTransitionRecord(value: unknown, pathPrefix = "record"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return [issue(pathPrefix, "record must be a JSON object")];
  }

  if (value.schema !== TRANSITION_SCHEMA) {
    issues.push(issue(`${pathPrefix}.schema`, `schema must be "${TRANSITION_SCHEMA}"`));
  }
  if (value.version !== TRANSITION_SCHEMA_VERSION) {
    issues.push(issue(`${pathPrefix}.version`, `version must be "${TRANSITION_SCHEMA_VERSION}"`));
  }

  for (const field of ["command", "verb"] as const) {
    if (!(field in value)) {
      issues.push(issue(`${pathPrefix}.${field}`, `${field} is required (nullable, but present)`));
    } else if (value[field] !== null && typeof value[field] !== "string") {
      issues.push(issue(`${pathPrefix}.${field}`, `${field} must be a string or null`));
    }
  }

  const targets = value.targets;
  if (!isPlainObject(targets)) {
    issues.push(issue(`${pathPrefix}.targets`, "targets is required and must be an object"));
  } else {
    for (const [key, targetValue] of Object.entries(targets)) {
      if (typeof targetValue !== "string") {
        issues.push(issue(`${pathPrefix}.targets.${key}`, "target values must be strings"));
      }
    }
  }

  const flags = value.flags;
  if (!Array.isArray(flags)) {
    issues.push(issue(`${pathPrefix}.flags`, "flags is required and must be an array of flag names"));
  } else if (flags.some((flag) => typeof flag !== "string")) {
    issues.push(issue(`${pathPrefix}.flags`, "flags entries must be strings"));
  }

  if (typeof value.exit_code !== "number" || !Number.isInteger(value.exit_code)) {
    issues.push(issue(`${pathPrefix}.exit_code`, "exit_code is required and must be an integer"));
  }
  if (!TRANSITION_OUTCOMES.includes(value.outcome as TransitionOutcome)) {
    issues.push(issue(`${pathPrefix}.outcome`, `outcome must be one of: ${TRANSITION_OUTCOMES.join(", ")}`));
  }

  if (typeof value.started_at !== "string" || Number.isNaN(Date.parse(value.started_at))) {
    issues.push(issue(`${pathPrefix}.started_at`, "started_at is required and must be an ISO 8601 date-time"));
  }
  if (typeof value.duration_ms !== "number" || !Number.isInteger(value.duration_ms) || value.duration_ms < 0) {
    issues.push(issue(`${pathPrefix}.duration_ms`, "duration_ms is required and must be a non-negative integer"));
  }

  if ("cwd_repo" in value && value.cwd_repo !== null && typeof value.cwd_repo !== "string") {
    issues.push(issue(`${pathPrefix}.cwd_repo`, "cwd_repo must be a string or null"));
  }

  const actor = value.actor;
  if (!isPlainObject(actor)) {
    issues.push(issue(`${pathPrefix}.actor`, "actor is required and must be an object"));
  } else {
    for (const field of ["runtime", "session_id"] as const) {
      if (!(field in actor)) {
        issues.push(issue(`${pathPrefix}.actor.${field}`, `actor.${field} is required (nullable, but present)`));
      } else if (actor[field] !== null && typeof actor[field] !== "string") {
        issues.push(issue(`${pathPrefix}.actor.${field}`, `actor.${field} must be a string or null`));
      }
    }
  }

  if ("error_name" in value && (typeof value.error_name !== "string" || value.error_name.length > MAX_ERROR_NAME_LENGTH)) {
    issues.push(issue(`${pathPrefix}.error_name`, `error_name must be a string of at most ${MAX_ERROR_NAME_LENGTH} chars`));
  }
  if ("gate_outcome" in value && value.gate_outcome !== "advanced" && value.gate_outcome !== "awaiting") {
    issues.push(issue(`${pathPrefix}.gate_outcome`, "gate_outcome must be \"advanced\" or \"awaiting\""));
  }
  if ("gate_missing" in value && (!Array.isArray(value.gate_missing) || value.gate_missing.some((id) => typeof id !== "string"))) {
    issues.push(issue(`${pathPrefix}.gate_missing`, "gate_missing must be an array of expectation ids"));
  }

  // A malformed cost claim must be rejected, not silently absorbed as "no turn":
  // absorbing it would convert an emitter bug into permanently understated cost.
  if ("output_tokens" in value && (typeof value.output_tokens !== "number" || !Number.isInteger(value.output_tokens) || value.output_tokens < 0)) {
    issues.push(issue(`${pathPrefix}.output_tokens`, "output_tokens, when present, must be a non-negative integer"));
  }

  return issues;
}

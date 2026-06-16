/**
 * The structural gate.
 *
 * A gate predicate takes the REAL grounded claim(s) + the requested binding and
 * returns a discriminated GateOutcome: PASS (emit the verified value) or BLOCK
 * (refuse / flag). There is NO confidence threshold anywhere. Every decision is a
 * comparison of STRUCTURAL BINDING FACTS that came out of the real TrustBundle:
 *
 *   - qualifier match : requestedQualifier === groundedQualifier
 *   - freshness        : groundingHashSnapshot === source's CURRENT content hash
 *   - join integrity   : every sub-claim's qualifier === the requested qualifier
 *   - locator support  : the cited locator actually holds the claimed value
 *
 * The conductor consumes GateOutcome through a discriminated union, so there is no
 * code path that emits a "grounded" answer when the gate BLOCKs. TypeScript enforces
 * it: a Blocked outcome carries no value/bundle to read.
 */

import { currentContentHash, findRecordByDoc } from "./corpus.js";
import type { GroundedClaim, ClaimBinding } from "./ground.js";

export interface GatePass {
  outcome: "pass";
  value: number;
  /** The grounded claim whose bundle the panel renders. */
  grounded: GroundedClaim;
}

export interface GateBlock {
  outcome: "block";
  /** Why the structural gate refused — names the exact binding that failed. */
  reason: string;
  /** Machine-readable mismatch kind, for tests + UI badges. */
  mismatch: "qualifier" | "freshness" | "join" | "locator" | "absent";
  /**
   * The grounded claim that WAS produced (if any). Present for stale/qualifier/
   * locator cases where a bundle exists but is bound to the wrong thing — the panel
   * can show what WAS proven, alongside why it doesn't answer the question.
   */
  grounded?: GroundedClaim;
}

export type GateOutcome = GatePass | GateBlock;

// ── Scenario 0 / absence: nothing grounded ────────────────────────────────────

export function gateAbsent(binding: ClaimBinding): GateBlock {
  return {
    outcome: "block",
    mismatch: "absent",
    reason:
      `No source record exists for ${binding.subjectId} / ${binding.requestedQualifier} / ` +
      `${binding.fieldOrBehavior}. Nothing to ground — refusing rather than fabricating.`,
  };
}

// ── Scenario 1 / qualifier: value bound to wrong period ───────────────────────

export function gateQualifier(binding: ClaimBinding, grounded: GroundedClaim): GateOutcome {
  if (grounded.groundedQualifier !== binding.requestedQualifier) {
    return {
      outcome: "block",
      mismatch: "qualifier",
      grounded,
      reason:
        `Requested qualifier ${binding.requestedQualifier} but the only grounding for ` +
        `$${grounded.value.toLocaleString()} is bound to ${grounded.groundedQualifier} ` +
        `(source ${grounded.docId}). The value is real, but it does not answer ` +
        `${binding.requestedQualifier} — refusing.`,
    };
  }
  return { outcome: "pass", value: grounded.value, grounded };
}

// ── Scenario 2 / freshness: grounding snapshot no longer matches source ────────

export function gateFreshness(binding: ClaimBinding, grounded: GroundedClaim): GateOutcome {
  const currentHash = currentContentHash(grounded.docId);
  if (currentHash !== undefined && currentHash !== grounded.groundingHashSnapshot) {
    const current = findRecordByDoc(grounded.docId);
    return {
      outcome: "block",
      mismatch: "freshness",
      grounded,
      reason:
        `Claim is STALE: the grounding snapshot (integrity-ref ${grounded.groundingHashSnapshot}) ` +
        `no longer matches the source's current content hash (${currentHash}). ` +
        `Source ${grounded.docId} was restated` +
        (current ? ` ${current.observedAt} to $${current.value.toLocaleString()}` : "") +
        `. The cached value cannot be trusted — refusing pending re-grounding.`,
    };
  }
  // qualifier still has to line up for a clean pass
  if (grounded.groundedQualifier !== binding.requestedQualifier) {
    return gateQualifier(binding, grounded);
  }
  return { outcome: "pass", value: grounded.value, grounded };
}

// ── Scenario 3 / join: a sub-claim is bound to the wrong qualifier ────────────

export interface JoinInput {
  /** Human label for the derived figure, e.g. "Q3-2025 margin". */
  label: string;
  /** The arithmetic result the answer asserts. */
  derivedValue: number;
  /** Each sub-claim that fed the computation. */
  subClaims: Array<{ role: string; grounded: GroundedClaim }>;
}

export function gateJoin(binding: ClaimBinding, join: JoinInput): GateOutcome {
  // Every sub-claim must be bound to the requested qualifier. A single wrong-period
  // sub-claim invalidates the join — structurally, not by inspecting the final number.
  const offender = join.subClaims.find(
    (s) => s.grounded.groundedQualifier !== binding.requestedQualifier
  );
  if (offender) {
    return {
      outcome: "block",
      mismatch: "join",
      grounded: offender.grounded,
      reason:
        `Invalid join for ${join.label}: sub-claim "${offender.role}" is bound to ` +
        `${offender.grounded.groundedQualifier}, not the requested ${binding.requestedQualifier} ` +
        `(source ${offender.grounded.docId}). The composed figure mixes periods — refusing.`,
    };
  }
  // All sub-claims share the requested qualifier — the join is structurally valid.
  // Return the revenue sub-claim's bundle as the representative grounding to render.
  const rep = join.subClaims[0]?.grounded;
  if (!rep) {
    return {
      outcome: "block",
      mismatch: "join",
      reason: `Invalid join for ${join.label}: no sub-claims supplied.`,
    };
  }
  return { outcome: "pass", value: join.derivedValue, grounded: rep };
}

// ── Scenario 4 / locator: cited locator does not hold the claimed value ───────

export function gateLocator(
  binding: ClaimBinding,
  grounded: GroundedClaim,
  /** The locator that ACTUALLY holds the claimed value in the source, if any. */
  realLocatorForValue: string | undefined
): GateOutcome {
  if (realLocatorForValue === undefined || grounded.groundedLocator !== realLocatorForValue) {
    return {
      outcome: "block",
      mismatch: "locator",
      grounded,
      reason:
        `Citation does not support the figure: the claim cites locator ` +
        `"${grounded.groundedLocator}" in ${grounded.docId}, but $${grounded.value.toLocaleString()} ` +
        `is not what lives at that locator` +
        (realLocatorForValue ? ` (the actuals are at "${realLocatorForValue}")` : "") +
        `. The document is real but the cited locator is citation theater — refusing.`,
    };
  }
  if (grounded.groundedQualifier !== binding.requestedQualifier) {
    return gateQualifier(binding, grounded);
  }
  return { outcome: "pass", value: grounded.value, grounded };
}

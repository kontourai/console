import { isSafeExternalUrl } from "./safeUrl";

/**
 * Source-of-truth link-outs (console#256) — the ground-truth refs the trust
 * bridge folds onto `state.processes[i].sourceOfTruthRefs` (console#254,
 * `workflow-trust-bridge.ts`'s `WorkflowTrustSourceOfTruthRef`): a work-item's
 * canonical GitHub issue, plus assignment-branch/assignment-actor/assignment-
 * artifact-dir and any future kind a producer adds. This module owns the ONE
 * derivation every console surface (fleet cards, run detail, ...) reuses
 * rather than re-deriving its own subset — see `deriveRunDetail.ts`'s prior
 * `deriveSourceOfTruthRefs`, which only kept url-bearing entries; this
 * version keeps every entry with an honest label, since a ref with no url is
 * still real ground truth (an assignment branch/actor/artifact-dir), it is
 * just not a link.
 */
export type SourceRefKind = "work-item" | "assignment-branch" | "assignment-actor" | "assignment-artifact-dir" | string;

export interface SourceRef {
  kind: SourceRefKind;
  label: string;
  /**
   * Present ONLY when this ref carries a real, non-empty, safe (http/https)
   * URL — a ref without one renders as plain text/code, never a fake or dead
   * anchor (this task's honesty requirement).
   */
  url?: string;
}

/**
 * Deterministic render order (this task's ask): work-item first (the
 * backlog/issue ground truth), then the assignment trio in a fixed order.
 * Any other/future kind sorts after these, in original encounter order
 * (`Array#sort` is a stable sort in Node/V8, so ties never reorder).
 */
const KIND_ORDER: Record<string, number> = {
  "work-item": 0,
  "assignment-branch": 1,
  "assignment-actor": 2,
  "assignment-artifact-dir": 3,
};

function kindRank(kind: string): number {
  return KIND_ORDER[kind] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * `sourceOfTruthRefs` is not a declared `ConsoleProcess` field — no
 * console-core type owns it (console#254 folds it on dynamically via
 * `payload.after`). Read defensively off the raw record so a producer's
 * link-outs render the moment they appear, without ever fabricating a link:
 * malformed entries (not an object, no honest label) are silently skipped
 * rather than guessed at; an entry's `url` is kept only when it is a real,
 * safe http(s) string (tolerating either a `url` or `href` key, matching the
 * producer field name flexibility the prior deriveRunDetail helper had).
 */
export function deriveSourceRefs(record: unknown): SourceRef[] {
  const raw = (record as { sourceOfTruthRefs?: unknown } | null | undefined)?.sourceOfTruthRefs;
  if (!Array.isArray(raw)) return [];

  const refs: SourceRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { kind?: unknown; label?: unknown; id?: unknown; url?: unknown; href?: unknown };

    const label = (typeof candidate.label === "string" && candidate.label)
      || (typeof candidate.id === "string" && candidate.id)
      || undefined;
    if (!label) continue; // nothing honest to show

    const kind = typeof candidate.kind === "string" && candidate.kind ? candidate.kind : "ref";

    const rawUrl = typeof candidate.url === "string" && candidate.url
      ? candidate.url
      : typeof candidate.href === "string" && candidate.href
        ? candidate.href
        : undefined;
    const url = rawUrl && isSafeExternalUrl(rawUrl) ? rawUrl : undefined;

    refs.push(url ? { kind, label, url } : { kind, label });
  }

  return refs
    .map((ref, index) => ({ ref, index }))
    .sort((a, b) => kindRank(a.ref.kind) - kindRank(b.ref.kind) || a.index - b.index)
    .map(({ ref }) => ref);
}

import React from "react";
import { isSafeExternalUrl } from "../utils/safeUrl";
import type { SourceRef, SourceRefKind } from "../utils/sourceRefs";

/**
 * A compact row of source-of-truth ref chips (console#256) — the shared
 * render for `state.processes[i].sourceOfTruthRefs` (console#254), reused by
 * both the fleet cards (`WorkerFleetSection.tsx`) and the run detail
 * (`sections/board/RunDetailView.tsx`) so a work-item/assignment link-out
 * looks and behaves identically everywhere it appears.
 *
 * Honesty contract: a ref only ever renders as a real `<a href>` when
 * `deriveSourceRefs` (utils/sourceRefs.ts) attached a safe, http(s) `url` —
 * every other ref (a branch/actor/artifact-dir with no url, or any ref whose
 * url failed the safe-scheme allow-list) renders as plain labeled text,
 * never a dead or fake anchor.
 */
export interface SourceRefLinksProps {
  refs: SourceRef[];
  /** Restrict rendering to these kinds only (e.g. the fleet card's compact
   *  work-item-only chip) — omit to render every ref, in `refs`' order. */
  only?: SourceRefKind[];
  className?: string;
  /** Overrides the wrapping list's aria-label (default: "Source of truth"). */
  ariaLabel?: string;
}

export function SourceRefLinks({ refs, only, className, ariaLabel = "Source of truth" }: SourceRefLinksProps) {
  const visible = only ? refs.filter((ref) => only.includes(ref.kind)) : refs;
  if (visible.length === 0) return null;

  return (
    <ul className={`source-ref-links${className ? ` ${className}` : ""}`} aria-label={ariaLabel}>
      {visible.map((ref, index) => (
        <SourceRefChip key={`${ref.kind}:${ref.label}:${index}`} entry={ref} />
      ))}
    </ul>
  );
}

function SourceRefChip({ entry }: { entry: SourceRef }) {
  // Re-checked at render time (not just trusted from `deriveSourceRefs`) so
  // this component's own honesty contract holds even for a hand-built
  // `SourceRef` a future caller constructs without going through the shared
  // derivation -- an unsafe/unparsable url NEVER becomes a live `<a href>`.
  const safeUrl = entry.url && isSafeExternalUrl(entry.url) ? entry.url : undefined;
  return (
    <li className={`source-ref-chip source-ref-chip-${entry.kind}`}>
      {safeUrl ? (
        <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="source-ref-link" title={entry.label}>
          {entry.label}
        </a>
      ) : (
        // No safe url: an honest labeled chip, never a dead/fake anchor. A
        // plain <code> reads ambiguously on its own (no kind context), so the
        // kind is spelled out in aria-label for assistive tech.
        <code className="source-ref-text" aria-label={`${entry.kind}: ${entry.label}`} title={entry.label}>
          {entry.label}
        </code>
      )}
    </li>
  );
}

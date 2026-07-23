/**
 * The single allow-list every external link-out in this app must pass before
 * ever rendering as a live `<a href>` (console#253 review finding 6, probe:
 * `javascript:`/`data:` URLs must never execute/render inline instead of
 * navigating externally). Moved here from `sections/board/deriveRunDetail.ts`
 * (console#256) so the shared `SourceRefLinks` component and its derivation
 * helper — and any future link-out surface — reuse the SAME check instead of
 * re-implementing it.
 */
const ALLOWED_LINK_PROTOCOLS = new Set(["https:", "http:"]);

/**
 * True only for a well-formed, non-empty http(s) URL string. An unparsable
 * string is rejected the same way as an unsafe scheme — never a broken or
 * relative href masquerading as an external link.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return ALLOWED_LINK_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

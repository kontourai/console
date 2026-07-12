const fs = require("node:fs");
const path = require("node:path");

// Single source of truth for the Console's release/API version: the published
// @kontourai/console package version. This is what npm publishes and what the
// deploy Dockerfile pins, so it — not console-server's local package version — is
// the number the OpenAPI contract and the /version probe should report.
//
// Resolved at runtime by probing ancestors of the module dir for the package.json
// whose name is @kontourai/console. Works both in the workspace (repo-root
// package.json) and when installed under node_modules/@kontourai/console. Never
// throws: a version surface must never crash `serve`.
const PACKAGE_NAME = "@kontourai/console";
const UNKNOWN_VERSION = "0.0.0-unknown";

export function resolveConsoleVersion(moduleDir: string = __dirname): string {
  // NOTE: console-server/package.json is ALSO named @kontourai/console with a stale
  // 0.1.0, so the FIRST (innermost) match is wrong. The published package root — in
  // the workspace (repo-root package.json) and under node_modules/@kontourai/console —
  // is the OUTERMOST @kontourai/console, so keep walking and take the last match.
  let dir = moduleDir;
  let found: string | undefined;
  for (let depth = 0; depth < 12; depth += 1) {
    const pkgPath = path.join(dir, "package.json");
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg && pkg.name === PACKAGE_NAME && typeof pkg.version === "string") {
          found = pkg.version;
        }
      }
    } catch {
      // ignore a malformed/unreadable package.json and keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found ?? UNKNOWN_VERSION;
}

// Build/deploy provenance for the /version probe. gitSha/builtAt are stamped into
// the container env at build time when available; absent in dev.
export function resolveBuildInfo(): { version: string; gitSha?: string; builtAt?: string } {
  const gitSha = process.env.CONSOLE_BUILD_SHA || undefined;
  const builtAt = process.env.CONSOLE_BUILT_AT || undefined;
  return { version: resolveConsoleVersion(), ...(gitSha ? { gitSha } : {}), ...(builtAt ? { builtAt } : {}) };
}

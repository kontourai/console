#!/usr/bin/env -S node --import tsx
/**
 * Screenshot the three-lane gallery.
 * Builds the page, serves dist/, captures one shot per scenario (three lanes visible)
 * plus a full-page shot, writes to /tmp/grounded-demo/.
 *
 * Filenames:
 *   s1-qualifier.png, s2-stale.png, s3-join.png, s4-citation.png, s0-absence.png,
 *   gallery-full.png
 *
 * Usage: npm run demo:grounded:screenshot
 */

import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./scenarios.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

console.log("Building gallery page...");
execSync("node --import tsx demo/grounded-answer/build-page.ts", { cwd: root, stdio: "inherit" });

const distDir = join(__dirname, "dist");
const port = 9878;
console.log(`\nStarting HTTP server on port ${port}...`);
const server = spawn("npx", ["serve", distDir, "-p", String(port), "--no-clipboard"], {
  cwd: root,
  detached: true,
  stdio: "pipe",
});

await new Promise((resolve) => setTimeout(resolve, 2500));

const outDir = "/tmp/grounded-demo";
mkdirSync(outDir, { recursive: true });

const { chromium } = await import(
  "/Users/brian/dev/github/kontourai/kontourai.io/node_modules/playwright/index.mjs"
);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
page.on("pageerror", (err: Error) => console.error("PAGE ERROR:", err.message));

const pageUrl = `http://localhost:${port}/index.html`;
console.log(`\nNavigating to ${pageUrl}...`);
await page.goto(pageUrl, { waitUntil: "networkidle" });

await page.waitForFunction(
  () =>
    typeof customElements !== "undefined" &&
    customElements.get("surface-trust-panel") !== undefined,
  { timeout: 15000 }
);
await page.waitForTimeout(1000);

console.log("Taking screenshots...");

// One screenshot per scenario — scroll its section to the top and clip the lanes.
for (const s of SCENARIOS) {
  const handle = await page.$(`#${s.slug}`);
  if (!handle) {
    console.warn(`  (missing section #${s.slug})`);
    continue;
  }
  await handle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await handle.screenshot({ path: join(outDir, `${s.slug}.png`) });
  console.log(`  Saved ${s.slug}.png`);
}

// Full page
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
await page.screenshot({ path: join(outDir, "gallery-full.png"), fullPage: true });
console.log("  Saved gallery-full.png");

await browser.close();
if (server.pid) process.kill(-server.pid, "SIGTERM");

console.log(`\nScreenshots written to ${outDir}/`);

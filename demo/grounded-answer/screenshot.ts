#!/usr/bin/env -S node --import tsx
/**
 * Screenshot script for the grounded answer demo.
 * Builds the demo page, starts an HTTP server, takes screenshots, and cleans up.
 *
 * Uses Playwright at /Users/brian/dev/github/kontourai/kontourai.io/node_modules/playwright
 *
 * Usage: node --import tsx demo/grounded-answer/screenshot.ts
 *        or: npm run demo:grounded:screenshot
 *
 * Output: /tmp/grounded-demo/
 *   01-alpha-with-data.png     — query WITH data: raw vs grounded (trust panel visible)
 *   02-omega-no-data-refusal.png — query WITHOUT data: raw confident number vs refusal
 *   03-full-page.png           — full page
 */

import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

// Build the demo page first
console.log("Building demo page...");
execSync("node --import tsx demo/grounded-answer/build-page.ts", {
  cwd: root,
  stdio: "inherit",
});

// Start HTTP server
const distDir = join(__dirname, "dist");
const port = 9877;
console.log(`\nStarting HTTP server on port ${port}...`);
const server = spawn("npx", ["serve", distDir, "-p", String(port), "--no-clipboard"], {
  cwd: root,
  detached: true,
  stdio: "pipe",
});

// Wait for server to start
await new Promise((resolve) => setTimeout(resolve, 2000));

// Take screenshots
const outDir = "/tmp/grounded-demo";
mkdirSync(outDir, { recursive: true });

// Use Playwright (CommonJS)
const { chromium } = await import(
  "/Users/brian/dev/github/kontourai/kontourai.io/node_modules/playwright/index.mjs"
);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

const page = await context.newPage();
page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

const pageUrl = `http://localhost:${port}/index.html`;
console.log(`\nNavigating to ${pageUrl}...`);
await page.goto(pageUrl, { waitUntil: "networkidle" });

// Wait for the surface-trust-panel custom element to be defined
await page.waitForFunction(
  () => typeof customElements !== "undefined" && customElements.get("surface-trust-panel") !== undefined,
  { timeout: 15000 }
);
await page.waitForTimeout(800);

console.log("Taking screenshots...");

// Screenshot A: Query 1 WITH data (alpha) — shows grounded answer + trust panel
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({
  path: join(outDir, "01-alpha-with-data.png"),
  clip: { x: 0, y: 0, width: 1440, height: 900 },
});
console.log("  Saved 01-alpha-with-data.png");

// Scroll to query 2 section
const query2Y = await page.evaluate(() => {
  const divider = document.querySelector(".query-divider");
  if (!divider) return 700;
  return divider.getBoundingClientRect().top + window.scrollY - 20;
});
await page.evaluate((y: number) => window.scrollTo(0, y), query2Y);
await page.waitForTimeout(200);

// Screenshot B: Query 2 WITHOUT data (omega) — raw confident number vs structural refusal
await page.screenshot({
  path: join(outDir, "02-omega-no-data-refusal.png"),
  clip: { x: 0, y: 0, width: 1440, height: 900 },
});
console.log("  Saved 02-omega-no-data-refusal.png");

// Screenshot C: Full page
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({
  path: join(outDir, "03-full-page.png"),
  fullPage: true,
});
console.log("  Saved 03-full-page.png");

await browser.close();

// Kill the server
if (server.pid) {
  process.kill(-server.pid, "SIGTERM");
}

console.log(`\nScreenshots saved to ${outDir}/`);
console.log("  01-alpha-with-data.png      — query WITH data: trust panel with real chain of custody");
console.log("  02-omega-no-data-refusal.png — query WITHOUT data: raw \$295k vs structural refusal");
console.log("  03-full-page.png             — complete demo page");

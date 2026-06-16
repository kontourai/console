#!/usr/bin/env -S node --import tsx
/**
 * Screenshot the PRESENTATION-MODE deck (dist/present.html), one image per step.
 *
 * Builds the deck, serves dist/, navigates to each step via #step-N, captures a
 * full-viewport shot. Output: /tmp/grounded-demo/present/NN-<name>.png and a
 * contact-sheet montage (present-contact-sheet.png) if ImageMagick is available.
 *
 * Usage: npm run demo:grounded:present:screenshot
 */

import { execSync, spawn } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAll } from "./harness.js";
import { SCENARIOS } from "./scenarios.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

console.log("Building presentation deck...");
execSync("node --import tsx demo/grounded-answer/build-present.ts", { cwd: root, stdio: "inherit" });

// Reconstruct the step order the build uses, so filenames stay in sync with the deck.
runAll(SCENARIOS); // ensure the harness is exercised (parity with the build)
// Arc: title, setup, opening win, hero precision pair (w1 then s1), remaining traps, close.
const stepNames: string[] = ["title", "setup", "win-open"];
stepNames.push("w1-question", "w1-reveal", "s1-question", "s1-reveal");
const REMAINING_TRAP_ORDER = ["s2", "s4", "s3", "s0"];
for (const id of REMAINING_TRAP_ORDER) {
  stepNames.push(`${id}-question`, `${id}-reveal`);
}
// OKF interop beats (real Google source): the win + the freshness trap.
stepNames.push("okf-win", "okf-trap-reveal");
stepNames.push("insight", "kontour-answer", "close");

const distDir = join(__dirname, "dist");
const port = 9879;
console.log(`\nStarting HTTP server on port ${port}...`);
const server = spawn("npx", ["serve", distDir, "-p", String(port), "--no-clipboard"], {
  cwd: root,
  detached: true,
  stdio: "pipe",
});

await new Promise((resolve) => setTimeout(resolve, 2500));

const outDir = "/tmp/grounded-demo/present";
mkdirSync(outDir, { recursive: true });

const { chromium } = await import(
  "/Users/brian/dev/github/kontourai/kontourai.io/node_modules/playwright/index.mjs"
);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
page.on("pageerror", (err: Error) => console.error("PAGE ERROR:", err.message));

const base = `http://localhost:${port}/present.html`;
console.log(`\nNavigating to ${base}...`);
await page.goto(`${base}#step-0`, { waitUntil: "networkidle" });

// Wait for the real trust panel component to define before shooting reveal steps.
await page.waitForFunction(
  () =>
    typeof customElements !== "undefined" &&
    customElements.get("surface-trust-panel") !== undefined,
  { timeout: 15000 }
);
await page.waitForTimeout(800);

console.log("Capturing steps...");
const saved: string[] = [];
for (let i = 0; i < stepNames.length; i++) {
  // Drive the deck by setting the hash and dispatching, matching the on-screen controls.
  await page.evaluate((n: number) => {
    location.hash = "#step-" + n;
  }, i);
  await page.waitForTimeout(500); // let fonts/panel settle + progress transition
  const file = `${String(i + 1).padStart(2, "0")}-${stepNames[i]}.png`;
  await page.screenshot({ path: join(outDir, file) });
  saved.push(file);
  console.log(`  Saved ${file}`);
}

await browser.close();
if (server.pid) process.kill(-server.pid, "SIGTERM");

// Optional contact sheet (best-effort; needs ImageMagick `montage`).
try {
  const shots = readdirSync(outDir)
    .filter((f) => /^\d\d-.*\.png$/.test(f))
    .sort()
    .map((f) => join(outDir, f));
  execSync(
    `montage ${shots.map((s) => `'${s}'`).join(" ")} -tile 3x -geometry 480x300+6+6 -background '#e8e6df' '${join(outDir, "present-contact-sheet.png")}'`,
    { stdio: "pipe" }
  );
  console.log("  Saved present-contact-sheet.png");
} catch {
  console.log("  (skipped contact sheet — ImageMagick `montage` not available)");
}

console.log(`\nPresentation screenshots written to ${outDir}/`);

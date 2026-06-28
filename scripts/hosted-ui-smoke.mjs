#!/usr/bin/env node
// Visual smoke test for the hosted Console UI against a real hub.
//
// Unlike tests/browser/console-ui.spec.ts (which mocks the hub and auto-connects),
// this drives the real console-ui against a live hub through token auth, asserts the
// connection actually establishes and the operate plane renders non-empty, and saves
// screenshots. This is the check that catches "looks broken until you authenticate",
// CORS/proxy issues, and empty operating planes — none of which the mocked e2e can see.
//
// Usage:
//   CONSOLE_SMOKE_AUTH_TOKEN=... [CONSOLE_SMOKE_URL=http://127.0.0.1:5175] \
//   [CONSOLE_SMOKE_TENANT=kontour] node scripts/hosted-ui-smoke.mjs
//
// Requires the console-ui dev/preview server already running at CONSOLE_SMOKE_URL,
// pointed at the hub (same-origin or via a proxy). Exits non-zero on failure.
import { chromium } from "@playwright/test";

const URL = process.env.CONSOLE_SMOKE_URL || "http://127.0.0.1:5175";
const TOKEN = process.env.CONSOLE_SMOKE_AUTH_TOKEN || "";
const TENANT = process.env.CONSOLE_SMOKE_TENANT || "kontour";
const OUT = process.env.CONSOLE_SMOKE_OUT || "./test-results/hosted-ui";

if (!TOKEN) {
  console.error("skip: set CONSOLE_SMOKE_AUTH_TOKEN to run the hosted UI smoke");
  process.exit(0);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let failed = false;
const fail = (m) => { console.error("  ✗", m); failed = true; };
const pass = (m) => console.log("  ✓", m);

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => fail(`goto: ${e.message}`));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/01-initial.png`, fullPage: true });

// Authenticate via the Connection popover (token auth).
await page.getByRole("button", { name: "Connection" }).click().catch(() => {});
await page.waitForTimeout(300);
await page.fill("#hub-tenant", TENANT).catch(() => {});
await page.fill("#hub-token", TOKEN).catch(() => {});
await page.getByRole("button", { name: "Reconnect" }).click().catch(() => {});
await page.waitForTimeout(6000);

const status = await page.locator(".conn-dot").getAttribute("data-status").catch(() => "?");
status === "connected" ? pass(`connection status: ${status}`) : fail(`connection status: ${status} (expected connected)`);

await page.screenshot({ path: `${OUT}/02-operate.png`, fullPage: true });
const operateText = await page.getByRole("main").innerText().catch(() => "");
/Gates\s*\n?\s*[1-9]/.test(operateText) || /PASSED|WAITING|BLOCKED/.test(operateText)
  ? pass("operate plane rendered gates")
  : fail("operate plane has no gates (empty state)");
/VERIFIED|DISPUTED|STALE|PROPOSED/.test(operateText) ? pass("operate plane rendered claims") : fail("operate plane has no claims");

// Telemetry view should show sessions/records.
await page.getByRole("button", { name: "Telemetry", exact: true }).click().catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/03-telemetry.png`, fullPage: true });

errors.length === 0 ? pass("no page errors") : fail(`page errors: ${errors.slice(0, 3).join(" | ")}`);

await browser.close();
console.log(failed ? "hosted UI smoke FAILED" : "hosted UI smoke passed");
process.exit(failed ? 1 : 0);

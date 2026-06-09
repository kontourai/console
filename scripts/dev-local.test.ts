#!/usr/bin/env -S node --import tsx --test

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDevLocalConfig,
  mergeAllowedOrigins,
  nextAvailablePort,
  parseDevLocalArgs,
} = require("./dev-local");

test("parseDevLocalArgs uses local console defaults", () => {
  assert.deepEqual(parseDevLocalArgs([], {}), {
    host: "127.0.0.1",
    hubPort: 3738,
    uiPort: 5175,
  });
});

test("parseDevLocalArgs accepts host and port overrides", () => {
  assert.deepEqual(parseDevLocalArgs(["--host", "0.0.0.0", "--hub-port", "3838", "--ui-port", "5275"], {}), {
    host: "0.0.0.0",
    hubPort: 3838,
    uiPort: 5275,
  });
});

test("mergeAllowedOrigins appends required origins without duplicates", () => {
  assert.deepEqual(
    mergeAllowedOrigins("http://example.test, http://127.0.0.1:5175", [
      "http://127.0.0.1:5175",
      "http://localhost:5175",
    ]),
    ["http://example.test", "http://127.0.0.1:5175", "http://localhost:5175"],
  );
});

test("nextAvailablePort skips busy ports", async () => {
  const busyPorts = new Set([3738, 3739]);
  const port = await nextAvailablePort("127.0.0.1", 3738, async (_host: string, candidate: number) => {
    return !busyPorts.has(candidate);
  });

  assert.equal(port, 3740);
});

test("nextAvailablePort skips reserved ports", async () => {
  const port = await nextAvailablePort("127.0.0.1", 5175, async () => true, new Set([5175]));

  assert.equal(port, 5176);
});

test("parseDevLocalArgs rejects ephemeral ports because URLs are prewired", () => {
  assert.throws(() => parseDevLocalArgs(["--hub-port", "0"], {}), /--hub-port must be an integer from 1 to 65535/);
  assert.throws(() => parseDevLocalArgs(["--ui-port", "0"], {}), /--ui-port must be an integer from 1 to 65535/);
});

test("buildDevLocalConfig wires hub URL and UI origins together", async () => {
  const config = await buildDevLocalConfig(
    { host: "127.0.0.1", hubPort: 3738, uiPort: 5175 },
    { CONSOLE_ALLOWED_ORIGINS: "http://deployed.example" },
    async () => true,
  );

  assert.equal(config.hubUrl, "http://127.0.0.1:3738");
  assert.equal(config.uiUrl, "http://127.0.0.1:5175/");
  assert.deepEqual(config.allowedOrigins, [
    "http://deployed.example",
    "http://127.0.0.1:5175",
    "http://localhost:5175",
  ]);
});

test("buildDevLocalConfig keeps hub and UI ports distinct", async () => {
  const config = await buildDevLocalConfig(
    { host: "127.0.0.1", hubPort: 3738, uiPort: 3738 },
    {},
    async () => true,
  );

  assert.equal(config.hubPort, 3738);
  assert.equal(config.uiPort, 3739);
  assert.equal(config.hubUrl, "http://127.0.0.1:3738");
  assert.equal(config.uiUrl, "http://127.0.0.1:3739/");
});

test("buildDevLocalConfig maps wildcard bind host to loopback browser URLs", async () => {
  const config = await buildDevLocalConfig(
    { host: "0.0.0.0", hubPort: 3738, uiPort: 5175 },
    {},
    async () => true,
  );

  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.browserHost, "127.0.0.1");
  assert.equal(config.hubUrl, "http://127.0.0.1:3738");
  assert.equal(config.uiUrl, "http://127.0.0.1:5175/");
  assert.deepEqual(config.allowedOrigins, ["http://127.0.0.1:5175", "http://localhost:5175"]);
});

#!/usr/bin/env node
import { appendFile } from "node:fs/promises";

const recordFile = process.env.KONTOUR_RECORD_FILE;
if (recordFile) {
  await appendFile(recordFile, `${JSON.stringify({ product: "flow-agents", cwd: process.cwd(), argv: process.argv.slice(2), marker: process.env.KONTOUR_FIXTURE_MARKER ?? null })}\n`);
}
process.stdout.write("flow-agents-fixture-stdout\n");
process.stderr.write("flow-agents-fixture-stderr\n");

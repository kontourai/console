#!/usr/bin/env node
import { appendFile } from "node:fs/promises";

const recordFile = process.env.KONTOUR_RECORD_FILE;
if (recordFile) {
  await appendFile(recordFile, `${JSON.stringify({ product: "console", cwd: process.cwd(), argv: process.argv.slice(2), marker: process.env.KONTOUR_FIXTURE_MARKER ?? null })}\n`);
}
process.stdout.write("console-fixture-stdout\n");
process.stderr.write("console-fixture-stderr\n");

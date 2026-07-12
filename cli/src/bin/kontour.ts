#!/usr/bin/env node
import { runCli } from "../cli";

void runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}, () => {
  process.stderr.write("KONTOUR_INTERNAL_ERROR: The router could not complete the request.\n");
  process.exitCode = 70;
});

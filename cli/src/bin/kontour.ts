#!/usr/bin/env node
import { helpScope, renderHelp } from "../help";

const argv = process.argv.slice(2);
const requestedHelp = helpScope(argv);
if (requestedHelp) {
  process.stdout.write(renderHelp(requestedHelp));
} else {
  void import("../cli.js").then(({ runCli }) => runCli(argv)).then((code) => {
    process.exitCode = code;
  }, () => {
    process.stderr.write("KONTOUR_INTERNAL_ERROR: The router could not complete the request.\n");
    process.exitCode = 70;
  });
}

import { appendFileSync, writeFileSync } from "node:fs";

const recordPath = process.env.KONTOUR_SIGNAL_RECORD;
if (!recordPath) throw new Error("KONTOUR_SIGNAL_RECORD is required");

writeFileSync(recordPath, JSON.stringify({ pid: process.pid, signals: [] }));
const finish = (signal) => {
  appendFileSync(recordPath, `\n${signal}`);
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
};
process.once("SIGINT", () => finish("SIGINT"));
process.once("SIGTERM", () => finish("SIGTERM"));
process.stdout.write("READY\n");
setInterval(() => {}, 1_000);

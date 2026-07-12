import { writeFile } from "node:fs/promises";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString("utf8");
const record = {
  pid: process.pid,
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  stdin,
  marker: process.env.KONTOUR_PARITY_MARKER,
};

if (process.env.KONTOUR_PARITY_RECORD) {
  await writeFile(process.env.KONTOUR_PARITY_RECORD, JSON.stringify(record));
}
process.stdout.write(`parity-stdout:${stdin}`);
process.stderr.write(`parity-stderr:${process.env.KONTOUR_PARITY_MARKER ?? ""}`);

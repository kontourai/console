import { delegateProduct } from "../../../src/delegate.js";

async function main(): Promise<void> {
  const [executable, ...argv] = process.argv.slice(2);
  if (!executable) throw new Error("expected an executable path");
  process.exitCode = await delegateProduct(executable, argv);
}

void main();

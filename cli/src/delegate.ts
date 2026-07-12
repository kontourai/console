import { spawn, type SpawnOptions } from "node:child_process";
import { constants as osConstants } from "node:os";

export type ForwardedSignal = "SIGINT" | "SIGTERM";

export interface DelegateOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class DelegationError extends Error {
  readonly code = "KONTOUR_DELEGATION_SPAWN_FAILED";

  constructor(cause: unknown) {
    super("The product executable could not be started.", { cause });
    this.name = "DelegationError";
  }
}

function signalExitCode(signal: NodeJS.Signals): number {
  const signalNumber = osConstants.signals[signal];
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

/**
 * Execute a product-owned CLI without importing it or involving a shell.
 *
 * The caller is responsible for resolving and validating `executable`. This
 * adapter intentionally preserves the current process boundary: cwd, env and
 * all three standard streams are inherited unless the caller supplies cwd/env.
 */
export function delegateProduct(
  executable: string,
  argv: readonly string[],
  options: DelegateOptions = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: "inherit",
      shell: false,
    };
    const child = spawn(executable, [...argv], spawnOptions);
    const forwarded = new Set<ForwardedSignal>();
    let settled = false;

    const forward = (signal: ForwardedSignal): void => {
      if (forwarded.has(signal)) return;
      forwarded.add(signal);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    };
    const onSigint = (): void => forward("SIGINT");
    const onSigterm = (): void => forward("SIGTERM");
    const cleanup = (): void => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };
    const settle = (result: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      result();
    };

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    child.once("error", (error) => {
      settle(() => reject(new DelegationError(error)));
    });
    child.once("close", (code, signal) => {
      settle(() => resolve(code ?? (signal ? signalExitCode(signal) : 1)));
    });
  });
}

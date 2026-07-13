export type HelpScope = "root" | "init";

const ROOT_HELP = `Usage: kontour <command> [options]

Commands:
  init          Inspect, plan, or apply a pinned Flow Agents setup
  products      List discovered Kontour products
  capabilities  Show product capabilities
  doctor        Diagnose installed product availability

Options:
  --product-root=<product>=<absolute-package-root>
  --help, -h
`;

const INIT_HELP = `Usage: kontour init <--inspect|--plan|--apply> [options]

Options:
  --runtime <base|codex|claude-code|kiro|opencode|pi>
  --kit <catalog-id>
  --plan-id <sha256>
  --yes
  --json
  --help, -h
`;

/** Render help as inert text without importing or invoking product setup code. */
export function renderHelp(scope: HelpScope): string {
  return scope === "init" ? INIT_HELP : ROOT_HELP;
}

/** Recognize help without validating product roots or loading operational code. */
export function helpScope(argv: readonly string[]): HelpScope | undefined {
  const commandIndex = argv.findIndex((token) => !token.startsWith("--product-root="));
  const command = argv[commandIndex];
  if (command === "--help" || command === "-h") return "root";
  if (command === "init" && argv.slice(commandIndex + 1).some((token) => token === "--help" || token === "-h")) return "init";
  return undefined;
}

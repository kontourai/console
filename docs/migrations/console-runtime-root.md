# Console runtime root migration

Console now reads and writes generated local state only under `.kontourai/console`.
It does not read, merge, or write the former `.kontour` tree.

Authored telemetry descriptors remain visible as `console.telemetry.json` at the
repository or configured product root. Do not move those descriptors into the
generated runtime tree.

The former `telemetryFlowAgentsRoot` option is removed. Configure the Flow
Agents repository root through `telemetryProductRoots` or
`CONSOLE_TELEMETRY_PRODUCT_ROOTS`; its generated artifacts remain under
`.kontourai/flow-agents` inside that product root.

## One-time operator migration

1. Stop every Console hub, producer, bridge, and telemetry writer for the
   repository.
2. Back up the repository and confirm that `.kontourai/console` and
   `.kontourai/console.migrating` do not exist.
3. Reject the migration if the old tree contains symbolic links:

   ```sh
   find .kontour -type l -print
   ```

   Continue only when that command prints nothing.
4. Stage a copy without modifying the source tree:

   ```sh
   mkdir -p .kontourai
   cp -R .kontour .kontourai/console.migrating
   ```

5. Validate the staged event and projection records:

   ```sh
   npx --package @kontourai/console console-inspect local .kontourai/console.migrating
   ```

6. Promote the staged tree only after validation succeeds:

   ```sh
   mv .kontourai/console.migrating .kontourai/console
   npx --package @kontourai/console console-inspect local
   ```

Keep the old `.kontour` tree as rollback material until the new Console version
has been verified. Current Console versions ignore it, so leaving it in place
does not create dual-root behavior.

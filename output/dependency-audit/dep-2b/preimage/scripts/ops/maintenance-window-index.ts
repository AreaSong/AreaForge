import { buildMaintenanceWindowIndex } from "../quality/maintenance-window-index-common";

const sourceRoot = process.argv[2] ?? "docs/development";
try {
  process.stdout.write(`${JSON.stringify(buildMaintenanceWindowIndex(sourceRoot), null, 2)}\n`);
} catch (error) {
  console.error(`FAIL maintenance window index generation: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

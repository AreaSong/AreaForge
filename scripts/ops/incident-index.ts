import { buildIncidentIndex } from "../quality/incident-index-common";

const sourceRoot = process.argv[2] ?? "docs/development";

try {
  process.stdout.write(`${JSON.stringify(buildIncidentIndex(sourceRoot), null, 2)}\n`);
} catch (error) {
  console.error(`FAIL incident index generation: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

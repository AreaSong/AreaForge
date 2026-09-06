import assert from "node:assert/strict";
import { prisma } from "../../packages/db/src/index";

const requiredMigrations = [
  "20260906105000_v15_r_check_in_owner",
  "20260906105500_v15_r_member_learning_state",
  "20260906110000_v16_data_export_jobs",
  "20260906120000_v17_controlled_operations",
  "20260906130000_v18_private_ranking",
] as const;

const requiredTables = [
  "DataJob",
  "DataExportPackage",
  "DataExportDownloadGrant",
  "ControlledOperationRequest",
  "RankingPreference",
  "PrivateChallenge",
  "PrivateChallengeParticipant",
  "RankingProjection",
] as const;

try {
  assert.equal(process.env.AREAFORGE_AB_CANDIDATE_ISOLATED_DB, "1", "candidate schema selftest requires explicit isolated-db guard");
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname), "candidate schema selftest requires loopback PostgreSQL");
  const [databaseRow, migrationRows, tableRows] = await Promise.all([
    prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`,
    prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT "migration_name", "finished_at"
      FROM "_prisma_migrations"
      ORDER BY "migration_name"
    `,
    prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `,
  ]);
  const database = databaseRow[0]?.current_database ?? "";
  assert.match(database, /(ab|candidate|v15|v16|v17|v18)/i, "database name must identify an isolated candidate fixture");
  assert.deepEqual(
    migrationRows.filter((row) => requiredMigrations.includes(row.migration_name as typeof requiredMigrations[number]) && row.finished_at !== null).map((row) => row.migration_name).sort(),
    [...requiredMigrations].sort(),
  );
  assert.deepEqual(tableRows.filter((row) => requiredTables.includes(row.table_name as typeof requiredTables[number])).map((row) => row.table_name).sort(), [...requiredTables].sort());
  console.log(JSON.stringify({
    schemaVersion: "ab-candidate-schema-selftest-v1",
    status: "pass",
    database,
    migrations: requiredMigrations,
    tables: requiredTables,
    safetyFacts: {
      readOnly: true,
      isolatedDatabaseRequired: true,
      productionWriteAttempted: false,
      physicalDeleteAttempted: false,
      serverCommandAttempted: false,
      secretsOperationAttempted: false,
    },
    doesNotProve: [
      "shared test database migration status",
      "production migration or production runtime",
      "archive generation, physical deletion, or backup deletion ledger",
      "root-agent execution or updater apply",
      "authenticated browser experience",
    ],
  }, null, 2));
  console.log("PASS A→B v1.5-R/v1.6/v1.7/v1.8 isolated schema selftest");
} finally {
  await prisma.$disconnect();
}

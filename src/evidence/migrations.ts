import { readFileSync } from "node:fs";
import { join } from "node:path";

import type Database from "better-sqlite3";

const MIGRATIONS = [
  "001_create_evidence_records.sql",
  "002_create_authorization_grants.sql",
  "003_create_execution_records.sql",
  "004_create_mission_events.sql",
] as const;

export function migrate(database: Database.Database): void {
  const currentVersion = database.pragma("user_version", {
    simple: true,
  }) as number;

  for (const [index, relativePath] of MIGRATIONS.entries()) {
    const version = index + 1;
    if (version <= currentVersion) {
      continue;
    }

    const migrationPath = join(process.cwd(), "db", "migrations", relativePath);
    const sql = readFileSync(migrationPath, "utf8");
    database.transaction(() => {
      database.exec(sql);
      database.pragma(`user_version = ${version}`);
    })();
  }
}

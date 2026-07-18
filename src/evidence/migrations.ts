import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type Database from "better-sqlite3";

const MIGRATIONS = [
  "../../db/migrations/001_create_evidence_records.sql",
  "../../db/migrations/002_create_authorization_grants.sql",
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

    const migrationPath = fileURLToPath(new URL(relativePath, import.meta.url));
    const sql = readFileSync(migrationPath, "utf8");
    database.transaction(() => {
      database.exec(sql);
      database.pragma(`user_version = ${version}`);
    })();
  }
}

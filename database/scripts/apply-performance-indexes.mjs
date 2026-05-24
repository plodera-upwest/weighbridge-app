import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(__dirname, "../migrations/20260521090000_performance_indexes/migration.sql");
const result = spawnSync("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", migrationPath], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);

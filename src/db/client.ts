import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url && process.env.NODE_ENV !== "production") {
  console.warn(
    "[db] DATABASE_URL not set — using a placeholder; any query will fail at runtime. Copy .env.example to .env.",
  );
}

const connectionString =
  url ?? "postgres://placeholder:placeholder@localhost.invalid/placeholder";

// Single shared connection pool over the standard Postgres wire protocol, so
// the app runs against any Postgres — e.g. the self-hosted `db` container in
// docker-compose. The pool connects lazily (first query), so importing this at
// build time never opens a connection.
const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

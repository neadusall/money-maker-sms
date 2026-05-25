import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url && process.env.NODE_ENV !== "production") {
  console.warn(
    "[db] DATABASE_URL not set — using a placeholder; any query will fail at runtime. Copy .env.example to .env.",
  );
}

const connectionString =
  url ?? "postgres://placeholder:placeholder@localhost.invalid/placeholder";

export const db = drizzle(neon(connectionString), { schema });

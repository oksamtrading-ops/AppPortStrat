import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Used by the Prisma CLI (migrate/db execute/studio). Prefers the DIRECT
  // (non-pooler) connection — PgBouncer breaks migrations. The runtime client
  // builds its own pg adapter in src/lib/db/prisma.ts from DATABASE_URL.
  ...(process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL
    ? { datasource: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL } }
    : {}),
});

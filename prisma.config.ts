import "dotenv/config";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Used by the Prisma CLI (migrate/studio). The runtime client gets its own
  // adapter in src/lib/db/prisma.ts.
  adapter: async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — copy .env.example to .env and fill it in");
    }
    return new PrismaPg({ connectionString });
  },
});

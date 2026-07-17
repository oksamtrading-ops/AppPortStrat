import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),

  // ── Tenancy enforcement (CLAUDE.md non-negotiable) ────────────────────────
  // The raw Prisma client and generated client are only reachable inside the
  // data layer; app code must go through getScopedDb(ctx) / the admin door.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/db/prisma", "**/lib/db/prisma", "@/generated/prisma*", "**/generated/prisma/**"],
              message: "Import the scoped client via requireEngagementContext instead of the raw Prisma client.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^\\$(query|execute)Raw(Unsafe|Typed)?$/]",
          message: "Raw SQL bypasses tenancy scoping. The one sanctioned raw statement lives in src/lib/db/admin.ts.",
        },
        {
          selector: "TaggedTemplateExpression[tag.property.name=/^\\$(query|execute)Raw$/]",
          message: "Raw SQL bypasses tenancy scoping. The one sanctioned raw statement lives in src/lib/db/admin.ts.",
        },
      ],
    },
  },

  // ── Methodology purity (CLAUDE.md non-negotiable) ─────────────────────────
  // The scoring/disposition/filter/heat-map engines are pure TypeScript:
  // no framework, database, or Node imports — relative siblings only.
  {
    files: ["src/lib/methodology/**/*.ts"],
    ignores: ["src/lib/methodology/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^[^.]",
              message: "The methodology core is pure — no package or framework imports (relative siblings only).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;

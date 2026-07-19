import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RELATION_MAP_FOR_TEST } from "../guard";

/**
 * The guard's RELATION_MAP (used to re-check respondent include/select against
 * denied models — security review F2) is hand-authored pure data. This test
 * parses prisma/schema.prisma and fails if the map and the actual schema
 * relations diverge, so the map can never silently rot.
 */
function relationsFromSchema(): Record<string, Record<string, string>> {
  const schema = readFileSync(join(__dirname, "../../../../prisma/schema.prisma"), "utf8");
  const modelBlocks = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)];
  const modelNames = new Set(modelBlocks.map((m) => m[1]));

  const map: Record<string, Record<string, string>> = {};
  for (const [, name, body] of modelBlocks) {
    map[name] = {};
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
      // `<field>  <Type>[]?` … a relation is a field whose base type is a model.
      const match = trimmed.match(/^(\w+)\s+([A-Za-z0-9_]+)(\[\])?(\?)?/);
      if (!match) continue;
      const [, field, baseType] = match;
      if (modelNames.has(baseType)) map[name][field] = baseType;
    }
  }
  return map;
}

describe("RELATION_MAP stays in sync with the Prisma schema", () => {
  it("matches every model's relations exactly", () => {
    const actual = relationsFromSchema();
    // Compare as sorted JSON so field-order differences don't matter.
    const normalize = (m: Record<string, Record<string, string>>) =>
      Object.fromEntries(
        Object.keys(m)
          .sort()
          .map((model) => [
            model,
            Object.fromEntries(Object.keys(m[model]).sort().map((f) => [f, m[model][f]])),
          ]),
      );
    expect(normalize(RELATION_MAP_FOR_TEST)).toEqual(normalize(actual));
  });
});

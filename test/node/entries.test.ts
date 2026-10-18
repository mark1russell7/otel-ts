import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");

/**
 * The packages that the module graph of the source file `entry` imports at run
 * time. It follows the relative imports, and it leaves out `import type` and
 * `export type`, which the compiler removes.
 */
function runtimePackages(entry: string): string[] {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const files = [resolve(root, entry)];
  for (let file = files.pop(); file !== undefined; file = files.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
    for (const statement of source.statements) {
      const specifier =
        (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(statement) && !statement.isTypeOnly)
          ? statement.moduleSpecifier
          : undefined;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      if (specifier.text.startsWith(".")) {
        files.push(resolve(dirname(file), specifier.text.replace(/\.js$/, ".ts")));
      } else {
        packages.add(specifier.text);
      }
    }
  }
  return [...packages].sort();
}

const isAsyncBrowserContext = (name: string): boolean =>
  name === "async-browser-context" || name.startsWith("async-browser-context/");
const isZone = (name: string): boolean =>
  name === "zone.js" || name.startsWith("zone.js/") || name === "@opentelemetry/context-zone";

/** The package.json of otel-ts */
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  exports: Record<string, { types: string; import: string }>;
};

describe("the module graph of each entry", () => {
  it("@mark1russell7/otel-ts imports async-browser-context and not zone.js", () => {
    const packages = runtimePackages("src/index.ts");

    expect(packages).toContain("async-browser-context/opentelemetry");
    expect(packages.filter(isZone)).toEqual([]);
  });

  it("@mark1russell7/otel-ts/zone imports zone.js and not async-browser-context", () => {
    const packages = runtimePackages("src/zone.ts");

    expect(packages).toContain("@opentelemetry/context-zone");
    expect(packages.filter(isAsyncBrowserContext)).toEqual([]);
  });

  it("@mark1russell7/otel-ts/core imports no context library", () => {
    const packages = runtimePackages("src/core.ts");

    expect(packages.filter(isAsyncBrowserContext)).toEqual([]);
    expect(packages.filter(isZone)).toEqual([]);
  });

  it("the Node entries import no browser library", () => {
    for (const entry of ["src/node.ts", "src/node-testing.ts"]) {
      const packages = runtimePackages(entry);
      const browser = packages.filter(
        (name) => isAsyncBrowserContext(name) || isZone(name) || name.startsWith("@grafana/") || name.endsWith("-web"),
      );
      expect(browser, entry).toEqual([]);
    }
  });

  it("package.json exports each entry from its build output", () => {
    expect(manifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./zone": { types: "./dist/zone.d.ts", import: "./dist/zone.js" },
      "./core": { types: "./dist/core.d.ts", import: "./dist/core.js" },
      "./node": { types: "./dist/node.d.ts", import: "./dist/node.js" },
      "./node/testing": { types: "./dist/node-testing.d.ts", import: "./dist/node-testing.js" },
    });
  });
});

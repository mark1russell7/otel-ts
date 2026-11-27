import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The published manifest points at dist, and the release build makes dist only through the build script of the
 * root. Version 0.1.0 shipped without dist, because the root build did not start the build of this package.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const manifest = read(join(here, "..", "package.json"));
const root = read(join(here, "..", "..", "..", "package.json"));

/** This function gives each file path in a value of the manifest: a string, or the strings of an object. */
const targets = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value !== null && typeof value === "object" ? Object.values(value).flatMap(targets) : [];

describe("the published manifest", () => {
  const published = manifest["publishConfig"] as Record<string, unknown>;
  const scripts = manifest["scripts"] as Record<string, string>;
  const files = manifest["files"] as string[];

  it("is built by the build script of the root", () => {
    const build = (root["scripts"] as Record<string, string>)["build"] ?? "";
    expect(build).toMatch(/--filter "\.\/packages\/\*"/);
    expect(build).toMatch(/run build/);
    expect(scripts["build"]).toBe("tsc -p tsconfig.json");
  });

  it("points each entry point at a file that the build makes from a source file", () => {
    const entries = [published["main"], published["types"], published["exports"], published["bin"]].flatMap(targets).filter((path) => path !== "./package.json");
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toMatch(/^\.\/dist\/.+\.(js|d\.ts)$/);
      const source = entry.replace(/^\.\/dist\//, "src/").replace(/\.d\.ts$|\.js$/, ".ts");
      expect(existsSync(join(here, "..", source)), `${entry} has no source ${source}`).toBe(true);
    }
    expect(files).toContain("dist");
  });
});

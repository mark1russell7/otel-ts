import { readFileSync } from "node:fs";
import { createRequire, findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const rootPackage = fileURLToPath(new URL("../package.json", import.meta.url));

/** Node.js would select the native `AsyncLocalStorage`. This file is what a browser gets, as in the tests of the root. */
const asyncBrowserContext = dirname(createRequire(rootPackage).resolve("async-browser-context/package.json"));

/** The conditions of a browser. A key that is not here (`node`, `require`, `otel`) is a branch that a browser does not take. */
const browserConditions = new Set(["browser", "import", "default"]);

/** The file that a browser gets from one entry of an `imports` map, or undefined when no branch is for a browser. */
function browserTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  for (const [condition, branch] of Object.entries(entry)) {
    if (!browserConditions.has(condition)) continue;
    const target = browserTarget(branch);
    if (target !== undefined) return target;
  }
  return undefined;
}

/**
 * OpenTelemetry JS 3.x selects the files of a platform with a subpath import (`#platform`): the `node` branch comes before
 * the `default` branch, which is the browser. Vitest always resolves with the `node` condition, so without this plugin the
 * inlined exporters get their Node.js transport. The plugin resolves each `#` import of an OTel package to its browser branch.
 */
function otelBrowserPlatform(): Plugin {
  return {
    name: "otel-ts-site:otel-browser-platform",
    enforce: "pre",
    async resolveId(id, importer) {
      if (!id.startsWith("#") || importer === undefined || !/[\\/]@opentelemetry[\\/]/.test(importer)) return null;
      const manifest = findPackageJSON(pathToFileURL(importer.split("?")[0] ?? importer));
      if (manifest === undefined) return null;
      const imports = (JSON.parse(readFileSync(manifest, "utf8")) as { imports?: Record<string, unknown> }).imports;
      const target = browserTarget(imports?.[id]);
      // Vite resolves the relative target from the package folder, as it resolves each other file of the package.
      return target === undefined ? null : this.resolve(target, manifest, { skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [otelBrowserPlatform()],
  resolve: {
    alias: [
      { find: /^async-browser-context\/opentelemetry$/, replacement: join(asyncBrowserContext, "dist", "opentelemetry.js") },
      // The tests use the source of the package, so they need no build of the root.
      { find: /^@mark1russell7\/otel-ts$/, replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)) },
    ],
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    // Node.js would load the exporters with their `http` transport. The page must test the transport that a browser gets.
    server: { deps: { inline: [/@opentelemetry\/(exporter-[a-z-]*otlp|otlp)-/] } },
    setupFiles: ["../test/support/browser-globals.ts"],
  },
});

import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");

/**
 * The packages that the module graph of the source file `entry` imports at run
 * time. It follows the relative imports, and it leaves out `import type` and
 * `export type`, which the compiler removes.
 */
function runtimePackages(entry: string): string[] {
  return runtimeGraph(entry).packages;
}

/** The names of the source files that the module graph of the source file `entry` loads at run time, with `entry`. */
function runtimeFiles(entry: string): string[] {
  return runtimeGraph(entry).files;
}

/** The packages and the source files of the module graph of the source file `entry` at run time. */
function runtimeGraph(entry: string): { packages: string[]; files: string[] } {
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
  return { packages: [...packages].sort(), files: [...seen].map((file) => basename(file)).sort() };
}

const isAsyncBrowserContext = (name: string): boolean =>
  name === "async-browser-context" || name.startsWith("async-browser-context/");
const isZone = (name: string): boolean =>
  name === "zone.js" || name.startsWith("zone.js/") || name === "@opentelemetry/context-zone";

/** The package.json of otel-ts */
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  exports: Record<string, { types: string; import: string; default: string }>;
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
    for (const entry of ["src/node.ts", "src/node-context.ts", "src/node-export.ts", "src/node-testing.ts"]) {
      const packages = runtimePackages(entry);
      const browser = packages.filter(
        (name) => isAsyncBrowserContext(name) || isZone(name) || name.startsWith("@grafana/") || name.endsWith("-web"),
      );
      expect(browser, entry).toEqual([]);
    }
  });

  it("@mark1russell7/otel-ts/node/context imports no SDK of sdk-node, no exporter and no instrumentation", () => {
    // A small service imports this entry for the context only, so it must not load the SDK and the exporters
    expect(runtimePackages("src/node-context.ts")).toEqual([
      "@opentelemetry/api",
      "@opentelemetry/context-async-hooks",
      "@opentelemetry/core",
      "@opentelemetry/resources",
      "@opentelemetry/sdk-trace",
      "@opentelemetry/semantic-conventions",
    ]);
  });

  it("@mark1russell7/otel-ts/node/export imports the exporters, and no SDK of sdk-node and no instrumentation", () => {
    // A program that starts /node/context exports with this entry, so it must not bring the SDK that /node/context leaves out
    const packages = runtimePackages("src/node-export.ts");
    expect(packages).toContain("@opentelemetry/exporter-trace-otlp-proto");
    expect(packages).toContain("@opentelemetry/exporter-metrics-otlp-proto");
    expect(packages.filter((name) => name === "@opentelemetry/sdk-node" || name.startsWith("@opentelemetry/instrumentation"))).toEqual([]);
    // /node/context does not load the exporters
    expect(runtimeFiles("src/node-context.ts")).not.toContain("node-exporters.ts");
    // /node/context and /node do not load the metric exporters: the NodeSDK of /node takes the readers of the program
    expect(runtimeFiles("src/node-context.ts")).not.toContain("node-metric-exporters.ts");
    expect(runtimeFiles("src/node.ts")).not.toContain("node-metric-exporters.ts");
  });

  it("@mark1russell7/otel-ts/context imports @opentelemetry/api only", () => {
    // The libraries and the browser bundles of apps import this entry, so it must stay light (CONTEXT-DESIGN.md, D2)
    expect(runtimePackages("src/context.ts")).toEqual(["@opentelemetry/api"]);
  });

  it("@mark1russell7/otel-ts/incoming-span imports @opentelemetry/api only, and /node/context does not load it", () => {
    expect(runtimePackages("src/incoming-span.ts")).toEqual(["@opentelemetry/api"]);
    // Each service loads /node/context, so the span of the server stays out of it and out of /context.
    expect(runtimeFiles("src/node-context.ts")).not.toContain("incoming-span.ts");
    expect(runtimeFiles("src/node-context.ts")).not.toContain("span-run.ts");
  });

  it("@mark1russell7/otel-ts/lag imports lag and the API only, and no other entry imports lag", () => {
    // lag is an optional peer: only an app that imports this entry installs it (decision D7)
    expect(runtimePackages("src/lag.ts")).toEqual(["@mark1russell7/lag", "@opentelemetry/api"]);
    for (const entry of ["src/index.ts", "src/zone.ts", "src/core.ts", "src/context.ts", "src/node.ts", "src/node-context.ts", "src/node-export.ts", "src/node-testing.ts"]) {
      expect(runtimePackages(entry), entry).not.toContain("@mark1russell7/lag");
    }
  });

  it("@mark1russell7/otel-ts/pull imports the metrics SDK only", () => {
    // A lab run reads its metrics with this entry, so it must not start an SDK or load an exporter
    expect(runtimePackages("src/pull.ts")).toEqual(["@opentelemetry/sdk-metrics"]);
  });

  it("@mark1russell7/otel-ts/error imports the API and the plain-text helpers only", () => {
    // A page, a library and a service make an error record with no SDK, so it must stay light
    expect(runtimePackages("src/error-record.ts")).toEqual(["@mark1russell7/text", "@mark1russell7/text/redact", "@opentelemetry/api"]);
  });

  it("@mark1russell7/otel-ts/error-view imports the same packages as /error, and no framework", () => {
    // Each front end uses the view, so it must not bring a framework or an SDK
    expect(runtimePackages("src/error-view.ts")).toEqual(["@mark1russell7/text", "@mark1russell7/text/redact", "@opentelemetry/api"]);
  });

  it("@mark1russell7/otel-ts/call-trace imports the API only", () => {
    // A page with no SDK gives each call a trace context with it, so it must not bring an SDK
    expect(runtimePackages("src/call-trace.ts")).toEqual(["@opentelemetry/api"]);
  });

  it("package.json exports each entry from its build output", () => {
    expect(manifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js", default: "./dist/index.js" },
      "./zone": { types: "./dist/zone.d.ts", import: "./dist/zone.js", default: "./dist/zone.js" },
      "./core": { types: "./dist/core.d.ts", import: "./dist/core.js", default: "./dist/core.js" },
      "./context": { types: "./dist/context.d.ts", import: "./dist/context.js", default: "./dist/context.js" },
      "./incoming-span": { types: "./dist/incoming-span.d.ts", import: "./dist/incoming-span.js", default: "./dist/incoming-span.js" },
      "./node": { types: "./dist/node.d.ts", import: "./dist/node.js", default: "./dist/node.js" },
      "./node/context": { types: "./dist/node-context.d.ts", import: "./dist/node-context.js", default: "./dist/node-context.js" },
      "./node/export": { types: "./dist/node-export.d.ts", import: "./dist/node-export.js", default: "./dist/node-export.js" },
      "./node/testing": { types: "./dist/node-testing.d.ts", import: "./dist/node-testing.js", default: "./dist/node-testing.js" },
      "./lag": { types: "./dist/lag.d.ts", import: "./dist/lag.js", default: "./dist/lag.js" },
      "./pull": { types: "./dist/pull.d.ts", import: "./dist/pull.js", default: "./dist/pull.js" },
      "./error": { types: "./dist/error-record.d.ts", import: "./dist/error-record.js", default: "./dist/error-record.js" },
      "./error-view": { types: "./dist/error-view.d.ts", import: "./dist/error-view.js", default: "./dist/error-view.js" },
      "./call-trace": { types: "./dist/call-trace.d.ts", import: "./dist/call-trace.js", default: "./dist/call-trace.js" },
    });
  });
});

/** The package name of an import specifier, for example `@opentelemetry/api` for `@opentelemetry/api/x`. */
const packageOf = (specifier: string): string => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

/** The packages that the module graph of the source file `entry` imports, with `import type`: a program needs each one to type-check. */
function allPackages(entry: string): string[] {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const files = [resolve(root, entry)];
  for (let file = files.pop(); file !== undefined; file = files.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
    for (const statement of source.statements) {
      const specifier = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ? statement.moduleSpecifier : undefined;
      if (!specifier || !ts.isStringLiteral(specifier) || specifier.text.startsWith("node:")) continue;
      if (specifier.text.startsWith(".")) files.push(resolve(dirname(file), specifier.text.replace(/\.js$/, ".ts")));
      else packages.add(packageOf(specifier.text));
    }
  }
  return [...packages].sort();
}

/** The table of the README between the marks `entry-peers`: the packages that a program installs with each entry. */
function readmeTable(): Map<string, string[]> {
  const readme = readFileSync(resolve(root, "README.md"), "utf8").replace(/\r\n/g, "\n");
  const block = /<!-- entry-peers:start -->\n([\s\S]*?)<!-- entry-peers:end -->/.exec(readme)?.[1];
  if (block === undefined) throw new Error("README.md has no table between the marks entry-peers");
  const table = new Map<string, string[]>();
  for (const line of block.split("\n").slice(2)) {
    const cells = /^\| `([^`]+)` \| (.*) \|$/.exec(line);
    if (cells === null) continue;
    table.set(cells[1]!, cells[2] === "none" ? [] : [...cells[2]!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!));
  }
  return table;
}

describe("the packages of each entry", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    exports: Record<string, { import: string }>;
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
    peerDependenciesMeta: Record<string, { optional?: boolean }>;
  };
  const sourceOf = (entry: string): string => packageJson.exports[entry]!.import.replace("./dist/", "src/").replace(/\.js$/, ".ts");

  it("depends only on the API and the plain-text helpers, so a library that imports /context installs no SDK", () => {
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@mark1russell7/text", "@opentelemetry/api"]);
  });

  it("makes each other package an optional peer dependency", () => {
    for (const name of Object.keys(packageJson.peerDependencies)) expect(packageJson.peerDependenciesMeta[name]?.optional, name).toBe(true);
  });

  it("lists in the README, for each entry, the packages that its imports need beyond the dependencies", () => {
    const table = readmeTable();
    const dependencies = new Set(Object.keys(packageJson.dependencies));
    expect([...table.keys()]).toEqual(Object.keys(packageJson.exports).filter((entry) => entry !== "./package.json"));
    for (const entry of table.keys()) {
      expect(table.get(entry), entry).toEqual(allPackages(sourceOf(entry)).filter((name) => !dependencies.has(name)));
    }
  });

  it("has each package of the table as a peer dependency, and no other peer", () => {
    const peers = new Set([...readmeTable().values()].flat());
    expect(Object.keys(packageJson.peerDependencies).sort()).toEqual([...peers].sort());
  });
});

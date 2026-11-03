import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootPackage = fileURLToPath(new URL("../package.json", import.meta.url));

/** Node.js would select the native `AsyncLocalStorage`. This file is what a browser gets, as in the tests of the root. */
const asyncBrowserContext = dirname(createRequire(rootPackage).resolve("async-browser-context/package.json"));

export default defineConfig({
  resolve: {
    // The `browser` field of the OTel packages selects their browser files.
    mainFields: ["browser", "module", "main"],
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

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Browsers and Web Workers resolve `async-browser-context` without the `node`
 * export condition, so they get its browser runtime. Node.js loads the
 * dependencies of the tests with the `node` condition, which selects the
 * native `AsyncLocalStorage`. This alias gives the "browser runtime" project
 * the file that a browser gets.
 */
const asyncBrowserContext = dirname(
  createRequire(import.meta.url).resolve("async-browser-context/package.json"),
);

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: [
            {
              find: /^async-browser-context\/opentelemetry$/,
              replacement: join(asyncBrowserContext, "dist", "opentelemetry.js"),
            },
          ],
        },
        test: {
          name: "browser runtime",
          environment: "happy-dom",
          include: ["test/**/*.test.ts"],
          exclude: ["test/node/**"],
          setupFiles: ["test/support/browser-globals.ts"],
        },
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/node/**/*.test.ts"],
        },
      },
    ],
  },
});

import type { ContextManager } from "@opentelemetry/api";

/** The key of the global registry of @opentelemetry/api 1.x */
const registryKey = Symbol.for("opentelemetry.js.api.1");

/**
 * The context manager in the global registry of `@opentelemetry/api`.
 *
 * Since 1.10, the package has a CommonJS copy and an ES module copy. On
 * Node.js the SDK 2.x loads the CommonJS copy and the tests load the ES
 * module copy, so a spy on `context.setGlobalContextManager` of one copy
 * does not see a call through the other. Both copies keep their state in
 * one global object under this key, so the tests read the manager there.
 */
export function registeredContextManager(): ContextManager | undefined {
  const registry = (globalThis as Record<symbol, { context?: ContextManager } | undefined>)[
    registryKey
  ];
  return registry?.context;
}

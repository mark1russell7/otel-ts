/**
 * The main entry, `@mark1russell7/otel-ts`. It keeps the active span with
 * async-browser-context: the default `contextManager` is "async".
 *
 * async-browser-context patches `Promise.prototype.then`, the timers, the
 * event listeners and other callback APIs when this entry loads, also when
 * the app selects "stack". `@mark1russell7/otel-ts/core` patches nothing, and
 * `@mark1russell7/otel-ts/zone` uses zone.js.
 *
 * @packageDocumentation
 */
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import {
  createStackContextManager,
  type EntryContextManagers,
} from "./context-manager.js";
import { initWith } from "./init.js";
import type * as Types from "./types.js";

export * from "./common.js";

/** The context manager names of this entry: "async" (default) and "stack" */
export type ContextManagerOption = Types.ContextManagerOption<"async" | "stack">;

/** The configuration of `init()` in this entry */
export type OtelTsConfig = Types.OtelTsConfig<"async" | "stack">;

const managers: EntryContextManagers = {
  entry: "main",
  defaultName: "async",
  factories: {
    async: () => new AsyncContextManager(),
    stack: createStackContextManager,
  },
};

/**
 * Starts traces, metrics and logs. The default `contextManager` is "async".
 *
 * @throws For `contextManager: "zone"`: zone.js cannot share the page with
 * async-browser-context. Import `init` from `@mark1russell7/otel-ts/zone`.
 */
export function init(config?: OtelTsConfig): Types.OtelTsInstance {
  return initWith(managers, config);
}

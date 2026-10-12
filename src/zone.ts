/**
 * The zone.js entry, `@mark1russell7/otel-ts/zone`. The same API as
 * `@mark1russell7/otel-ts`, but it keeps the active span with zone.js: the
 * default `contextManager` is "zone".
 *
 * ```ts
 * import { init } from "@mark1russell7/otel-ts/zone";
 *
 * const otel = init();
 * ```
 *
 * zone.js (through `@opentelemetry/context-zone`) patches `Promise`, the
 * timers and the event listeners of the page when this entry loads. This
 * entry does not import async-browser-context: the two libraries cannot share
 * a page.
 *
 * @packageDocumentation
 */
import { ZoneContextManager } from "@opentelemetry/context-zone";
import {
  createStackContextManager,
  type EntryContextManagers,
} from "./context-manager.js";
import { initWith } from "./init.js";
import type * as Types from "./types.js";

export * from "./common.js";

/** The context manager names of this entry: "zone" (default) and "stack" */
export type ContextManagerOption = Types.ContextManagerOption<"zone" | "stack">;

/** The configuration of `init()` in this entry */
export type OtelTsConfig = Types.OtelTsConfig<"zone" | "stack">;

const managers: EntryContextManagers = {
  entry: "zone",
  defaultName: "zone",
  factories: {
    zone: () => new ZoneContextManager(),
    stack: createStackContextManager,
  },
};

/**
 * Starts traces, metrics and logs. The default `contextManager` is "zone".
 *
 * @throws For `contextManager: "async"`: async-browser-context cannot share
 * the page with zone.js. Import `init` from `@mark1russell7/otel-ts`.
 */
export function init(config?: OtelTsConfig): Types.OtelTsInstance {
  return initWith(managers, config);
}

/**
 * The core entry, `@mark1russell7/otel-ts/core`. The same API as
 * `@mark1russell7/otel-ts`, but it imports no context library and patches
 * nothing: the default `contextManager` is "stack". The app can also give its
 * own `ContextManager`.
 *
 * @packageDocumentation
 */
import {
  createStackContextManager,
  type EntryContextManagers,
} from "./context-manager.js";
import { initWith } from "./init.js";
import type * as Types from "./types.js";

export * from "./common.js";

/** The context manager names of this entry: only "stack" (default) */
export type ContextManagerOption = Types.ContextManagerOption<"stack">;

/** The configuration of `init()` in this entry */
export type OtelTsConfig = Types.OtelTsConfig<"stack">;

const managers: EntryContextManagers = {
  entry: "core",
  defaultName: "stack",
  factories: { stack: createStackContextManager },
};

/**
 * Starts traces, metrics and logs. The default `contextManager` is "stack".
 *
 * @throws For `contextManager: "async"` or `"zone"`: import `init` from
 * `@mark1russell7/otel-ts` or from `@mark1russell7/otel-ts/zone`.
 */
export function init(config?: OtelTsConfig): Types.OtelTsInstance {
  return initWith(managers, config);
}

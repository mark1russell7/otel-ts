/**
 * The core entry, `@mark1russell7/otel-ts/core`. The same API as
 * `@mark1russell7/otel-ts`, but it imports no context library and patches
 * nothing: the default `contextManager` is "stack". The app can also give its
 * own `ContextManager`.
 *
 * @packageDocumentation
 */
import { createStackContextManager, } from "./context-manager.js";
import { initWith } from "./init.js";
export * from "./common.js";
const managers = {
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
export function init(config) {
    return initWith(managers, config);
}
//# sourceMappingURL=core.js.map
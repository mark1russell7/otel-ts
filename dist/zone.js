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
import { createStackContextManager, } from "./context-manager.js";
import { initWith } from "./init.js";
export * from "./common.js";
const managers = {
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
export function init(config) {
    return initWith(managers, config);
}
//# sourceMappingURL=zone.js.map
import { getPageLifecycle } from "page-lifecycle-tracker";
import { hasDom } from "./env.js";
/**
 * Exports telemetry before the page can be frozen or discarded. The handlers
 * subscribe to the lifecycle tracker that the page shares
 * (`getPageLifecycle()` of page-lifecycle-tracker), in its `export` phase:
 *
 * - to `hidden`: flush. Happens on every tab switch, and the user may come
 *   back, so providers keep running.
 * - to `frozen` (a freeze, or `pagehide` into the back/forward cache): flush,
 *   because the page may be restored.
 * - to `terminated` (`pagehide` without `persisted`): shut down.
 *
 * A subscriber in the `export` phase runs after every subscriber in the
 * `observe` phase of the same transition, so values that monitoring libraries
 * record at the end of the page (on the same shared tracker) go out in that
 * flush, whatever order the scripts registered in. Before, otel-ts listened
 * to `pagehide` itself, and Chromium runs window listeners in registration
 * order: it shut down before monitors that registered later recorded.
 *
 * The tracker does not use `beforeunload` or `unload`: they can make the page
 * ineligible for the back/forward cache. Registers nothing where there is no
 * DOM (e.g. in a Web Worker).
 *
 * @returns A function that removes the subscription
 */
export function registerLifecycleHandlers(handlers) {
    if (!hasDom())
        return () => { };
    return getPageLifecycle().subscribe((transition) => {
        if (transition.to === "hidden" || transition.to === "frozen") {
            void handlers.flush({ transition });
        }
        else if (transition.to === "terminated") {
            void handlers.shutdown({ transition });
        }
    }, { phase: "export" });
}
//# sourceMappingURL=lifecycle.js.map
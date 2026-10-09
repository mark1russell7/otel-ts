import { hasDom } from "./env.js";
/**
 * Exports telemetry before the page can be frozen or discarded:
 *
 * - `visibilitychange` to hidden: flush. Happens on every tab switch, and the
 *   user may come back, so providers keep running.
 * - `pagehide` with `persisted`: the page is entering the back/forward cache
 *   and may be restored, so flush only.
 * - `pagehide` without `persisted`: the page is being discarded, so shut down.
 *
 * `beforeunload` and `unload` are deliberately not used: they can make the page
 * ineligible for the back/forward cache, and `beforeunload` also fires when the
 * user cancels the navigation.
 *
 * Each handler gets the event that started it, for the before-flush
 * listeners. Registers nothing where there is no DOM (e.g. in a Web Worker).
 *
 * @returns A function that removes the listeners
 */
export function registerLifecycleHandlers(handlers) {
    if (!hasDom())
        return () => { };
    const onVisibilityChange = (event) => {
        if (document.visibilityState === "hidden") {
            void handlers.flush({ event });
        }
    };
    const onPageHide = (event) => {
        if (event.persisted) {
            void handlers.flush({ event });
        }
        else {
            void handlers.shutdown({ event });
        }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", onPageHide);
    };
}
//# sourceMappingURL=lifecycle.js.map
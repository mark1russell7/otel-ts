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
 * Registers nothing where there is no DOM (e.g. in a Web Worker).
 *
 * @returns A function that removes the listeners
 */
export function registerLifecycleHandlers(handlers) {
    if (!hasDom())
        return () => { };
    const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
            void handlers.flush();
        }
    };
    const onPageHide = (event) => {
        if (event.persisted) {
            void handlers.flush();
        }
        else {
            void handlers.shutdown();
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
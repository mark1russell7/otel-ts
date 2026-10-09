import type { FlushCause } from "./types.js";
export interface LifecycleHandlers {
    /** Export pending telemetry; providers keep running */
    flush(cause: FlushCause): Promise<void>;
    /** Final flush, then stop all providers */
    shutdown(cause: FlushCause): Promise<void>;
}
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
export declare function registerLifecycleHandlers(handlers: LifecycleHandlers): () => void;
//# sourceMappingURL=lifecycle.d.ts.map
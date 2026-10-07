export type BeforeFlushListener = () => void;
export interface BeforeFlushListeners {
    /** Adds a listener. @returns A function that removes it */
    add(listener: BeforeFlushListener): () => void;
    /**
     * Calls every listener synchronously, in registration order. A listener
     * that throws does not stop the others; the first error is logged.
     */
    run(): void;
}
/**
 * Functions that run just before telemetry is flushed, so that values they
 * record (e.g. a page's final Web Vitals) go out in that flush. `init()`
 * runs them at the start of `forceFlush()` and `shutdown()`, which is also
 * what its page-hide handlers call. So they don't depend on the order in
 * which `pagehide` listeners run (which differs between browsers).
 */
export declare function createBeforeFlushListeners(): BeforeFlushListeners;
//# sourceMappingURL=before-flush.d.ts.map
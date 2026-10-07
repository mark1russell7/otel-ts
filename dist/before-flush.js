/**
 * Functions that run just before telemetry is flushed, so that values they
 * record (e.g. a page's final Web Vitals) go out in that flush. `init()`
 * runs them at the start of `forceFlush()` and `shutdown()`, which is also
 * what its page-hide handlers call. So they don't depend on the order in
 * which `pagehide` listeners run (which differs between browsers).
 */
export function createBeforeFlushListeners() {
    // Wrapped, so the same function can be added twice and removed once
    const entries = new Set();
    let running = false;
    let errorLogged = false;
    return {
        add(listener) {
            const entry = { listener };
            entries.add(entry);
            return () => {
                entries.delete(entry);
            };
        },
        run() {
            // A listener that flushes again must not start another round
            if (running)
                return;
            running = true;
            try {
                // A snapshot: listeners may add or remove listeners
                for (const { listener } of [...entries]) {
                    try {
                        listener();
                    }
                    catch (error) {
                        if (!errorLogged) {
                            errorLogged = true;
                            console.error("[otel-ts] An onBeforeFlush listener threw; telemetry is flushed anyway. Later listener errors are not logged.", error);
                        }
                    }
                }
            }
            finally {
                running = false;
            }
        },
    };
}
//# sourceMappingURL=before-flush.js.map
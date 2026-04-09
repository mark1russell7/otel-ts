export function registerShutdownHandlers(shutdownFn) {
    let shuttingDown = false;
    const flush = () => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        void shutdownFn();
    };
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            flush();
        }
    });
    window.addEventListener("beforeunload", flush);
}
//# sourceMappingURL=shutdown.js.map
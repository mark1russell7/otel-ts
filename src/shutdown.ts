export function registerShutdownHandlers(
  shutdownFn: () => Promise<void>,
): void {
  let shuttingDown = false;

  const flush = (): void => {
    if (shuttingDown) return;
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

/** Simulates the page being hidden or shown (tab switch, minimize, navigation). */
export function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Restores the environment's own `document.visibilityState`. */
export function resetVisibility(): void {
  Reflect.deleteProperty(document, "visibilityState");
}

/**
 * Simulates `pagehide`: `persisted` is true when the page enters the
 * back/forward cache, false when it is being discarded.
 */
export function hidePage(persisted: boolean): void {
  // happy-dom has no PageTransitionEvent
  const event = new Event("pagehide");
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

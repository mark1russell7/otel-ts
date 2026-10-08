/**
 * True in a page (`window` and `document` exist); false in Web Workers and
 * other runtimes without a DOM.
 */
export function hasDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

import { expect } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

/**
 * Starts the span "parent", lets `register` register a callback in it, and
 * ends the span. Then runs `outside`, outside every span. Gives the span, and
 * the active span that the callback saw when it ran.
 */
export async function activeSpanIn(
  register: (report: () => void) => void,
  outside?: () => void,
): Promise<{ parent: Span; seen: Span | undefined }> {
  let report!: () => void;
  const called = new Promise<Span | undefined>((resolve) => {
    report = () => resolve(trace.getActiveSpan());
  });
  const parent = trace
    .getTracer("test")
    .startActiveSpan("parent", (span) => {
      register(report);
      span.end();
      return span;
    });
  // The root context again
  expect(trace.getActiveSpan()).toBeUndefined();
  outside?.();
  return { parent, seen: await called };
}

/** A setTimeout callback, registered in the span */
export const inTimeout: Parameters<typeof activeSpanIn> = [
  (report) => setTimeout(report, 0),
];

/** A Promise.then callback, registered in the span */
export const inThen: Parameters<typeof activeSpanIn> = [
  (report) => {
    void Promise.resolve().then(report);
  },
];

/**
 * An event listener, registered in the span. The dispatch comes from the root
 * context, as a click of the user does.
 */
export function inListener(): Parameters<typeof activeSpanIn> {
  const element = document.createElement("button");
  return [
    (report) => element.addEventListener("refresh", report),
    () => element.dispatchEvent(new Event("refresh")),
  ];
}

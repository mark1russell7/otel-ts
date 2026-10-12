import { afterEach, describe, expect, it, vi } from "vitest";
import { context, propagation, trace, type Span } from "@opentelemetry/api";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import type { ContextManagerOption, OtelTsInstance } from "../src/index.js";
import { init } from "../src/init.js";
import { FakeExporter } from "./support/fake-exporter.js";

// Real providers and the real context managers; only the network layer is
// replaced. This project resolves async-browser-context to its browser
// runtime (vitest.config.ts), as a browser does.
vi.mock("@opentelemetry/exporter-trace-otlp-http", async () => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return { OTLPTraceExporter: FakeExporter };
});
vi.mock("@opentelemetry/exporter-metrics-otlp-http", async (importOriginal) => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return {
    ...(await importOriginal<
      typeof import("@opentelemetry/exporter-metrics-otlp-http")
    >()),
    OTLPMetricExporter: FakeExporter,
  };
});
vi.mock("@opentelemetry/exporter-logs-otlp-http", async () => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return { OTLPLogExporter: FakeExporter };
});

let otel: OtelTsInstance | undefined;

afterEach(async () => {
  await otel?.shutdown();
  otel = undefined;
  FakeExporter.instances.length = 0;
  trace.disable();
  context.disable();
  propagation.disable();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

/** Starts otel-ts with real tracing and the default instrumentations */
function start(contextManager?: ContextManagerOption): void {
  otel = init({ faro: false, metrics: false, logs: false, contextManager });
}

/**
 * Starts the span "parent", lets `register` register a callback in it, and
 * ends the span. Then runs `outside`, outside every span. Gives the span, and
 * the active span that the callback saw when it ran.
 */
async function activeSpanIn(
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

/** Registers `report` as a listener in the span, and dispatches outside it */
function listenerOf(
  element: HTMLElement,
): Parameters<typeof activeSpanIn> {
  return [
    (report) => element.addEventListener("refresh", report),
    () => element.dispatchEvent(new Event("refresh")),
  ];
}

describe("the default context manager", () => {
  it("is the AsyncContextManager of async-browser-context", () => {
    const registered = vi.spyOn(context, "setGlobalContextManager");

    start();

    expect(registered).toHaveBeenCalledOnce();
    expect(registered.mock.lastCall![0]).toBeInstanceOf(AsyncContextManager);
  });

  it("keeps the active span in a setTimeout callback", async () => {
    start();

    const { parent, seen } = await activeSpanIn((report) => setTimeout(report, 0));

    expect(seen).toBe(parent);
  });

  it("keeps the active span in a Promise.then callback", async () => {
    start();

    const { parent, seen } = await activeSpanIn((report) => {
      void Promise.resolve().then(report);
    });

    expect(seen).toBe(parent);
  });

  it("keeps the active span in an event listener", async () => {
    start();

    // A dispatch from the root context: the listener gets the span of the
    // addEventListener() call, as for a click of the user
    const { parent, seen } = await activeSpanIn(
      ...listenerOf(document.createElement("button")),
    );

    expect(seen).toBe(parent);
  });
});

describe('contextManager: "stack"', () => {
  it("registers the StackContextManager", () => {
    const registered = vi.spyOn(context, "setGlobalContextManager");

    start("stack");

    expect(registered.mock.lastCall![0]).toBeInstanceOf(StackContextManager);
  });

  it("loses the active span in a setTimeout callback", async () => {
    start("stack");

    const { seen } = await activeSpanIn((report) => setTimeout(report, 0));

    expect(seen).toBeUndefined();
  });

  it("loses the active span in a Promise.then callback", async () => {
    start("stack");

    const { seen } = await activeSpanIn((report) => {
      void Promise.resolve().then(report);
    });

    expect(seen).toBeUndefined();
  });

  it("loses the active span in an event listener", async () => {
    start("stack");

    const { seen } = await activeSpanIn(
      ...listenerOf(document.createElement("button")),
    );

    expect(seen).toBeUndefined();
  });
});

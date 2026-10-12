import { afterEach, describe, expect, it, vi } from "vitest";
import { context, propagation, trace, type Span } from "@opentelemetry/api";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import { init } from "../../src/index.js";
import type { OtelTsInstance } from "../../src/index.js";
import { FakeExporter } from "../support/fake-exporter.js";

// Node.js resolves async-browser-context with the `node` export condition:
// its context manager uses the native AsyncLocalStorage, and nothing patches
// the globals. Server-side rendering and Node tests of an app get this entry.
vi.mock("@opentelemetry/exporter-trace-otlp-http", async () => {
  const { FakeExporter } = await import("../support/fake-exporter.js");
  return { OTLPTraceExporter: FakeExporter };
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
});

function start(): void {
  // Node.js has no XMLHttpRequest to instrument
  otel = init({ metrics: false, logs: false, instrumentXhr: false });
}

describe("the default context manager on Node.js", () => {
  it("is the AsyncContextManager of the Node.js entry", () => {
    const registered = vi.spyOn(context, "setGlobalContextManager");

    start();

    expect(registered.mock.lastCall![0]).toBeInstanceOf(AsyncContextManager);
  });

  it("keeps the active span after a native await, without a transform", async () => {
    start();

    const { parent, seen } = await trace
      .getTracer("test")
      .startActiveSpan("parent", async (span) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const seen = trace.getActiveSpan();
        span.end();
        return { parent: span, seen };
      });

    expect(seen).toBe(parent);
  });

  it("keeps the active span in setTimeout and Promise.then callbacks", async () => {
    start();
    let parent!: Span;

    const seen = await new Promise<Array<Span | undefined>>((resolve) => {
      trace.getTracer("test").startActiveSpan("parent", (span) => {
        parent = span;
        void Promise.resolve()
          .then(() => trace.getActiveSpan())
          .then((inThen) => {
            setTimeout(() => resolve([inThen, trace.getActiveSpan()]), 0);
          });
        span.end();
      });
    });

    expect(seen).toEqual([parent, parent]);
  });

  it("flushes and shuts down", async () => {
    start();
    trace.getTracer("test").startSpan("work").end();

    await expect(otel!.forceFlush()).resolves.toBeUndefined();
    await expect(otel!.shutdown()).resolves.toBeUndefined();
  });
});

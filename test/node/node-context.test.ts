import { afterEach, describe, expect, it } from "vitest";
import { context, isSpanContextValid, propagation, trace } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import { SimpleSpanProcessor, type ReadableSpan, type SpanExporter } from "@opentelemetry/sdk-trace";
import { contextValue, defineContextKeys, withContext, withInternalCall } from "../../src/context.js";
import { contextRegistrationOwner } from "../../src/context-propagator.js";
import { startNodeContext, type NodeContext } from "../../src/node-context.js";
import { startNodeTelemetry } from "../../src/node.js";

let started: NodeContext | undefined;

afterEach(async () => {
  await started?.shutdown();
  started = undefined;
});

defineContextKeys({ "c.request.id": { cardinality: "high", propagate: "internal" } });

describe("startNodeContext", () => {
  it("gives each span a trace id with no span processor, and a child the trace of its parent", () => {
    started = startNodeContext({ env: {} });
    const tracer = trace.getTracer("t");
    const root = tracer.startSpan("root");
    expect(isSpanContextValid(root.spanContext())).toBe(true);
    const child = context.with(trace.setSpan(context.active(), root), () => tracer.startSpan("child"));
    expect(isSpanContextValid(child.spanContext())).toBe(true);
    expect(child.spanContext().traceId).toBe(root.spanContext().traceId);
    child.end();
    root.end();
  });

  it("keeps a context value after await, and sends the baggage only on an internal call", async () => {
    started = startNodeContext({ env: {} });

    const seen = await withContext({ "c.request.id": "r-1" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return contextValue("c.request.id");
    });
    expect(seen).toBe("r-1");

    const incoming = propagation.extract(context.active(), {
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      baggage: "c.request.id=r-2",
    });
    const plain: Record<string, string> = {};
    const internal: Record<string, string> = {};
    context.with(incoming, () => {
      propagation.inject(context.active(), plain);
      withInternalCall(() => propagation.inject(context.active(), internal));
    });
    expect(plain["traceparent"]).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-/);
    expect(plain["baggage"]).toBeUndefined();
    expect(internal["baggage"]).toBe("c.request.id=r-2");
  });

  it("gives the spans to its processors, with the resource of the service, and flushes them at the stop", async () => {
    const finished: ReadableSpan[] = [];
    const exporter: SpanExporter = {
      export: (spans, done) => {
        finished.push(...spans);
        done({ code: ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
    };
    started = startNodeContext({
      env: {},
      serviceName: "context-test",
      resourceAttributes: { "service.version": "1.2.3", "service.instance.id": "copy-2" },
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });

    trace.getTracer("context-test-scope").startSpan("one").end();
    await started.shutdown();
    started = undefined;

    expect(finished.map((span) => span.name)).toEqual(["one"]);
    const resource = finished[0]?.resource;
    await resource?.waitForAsyncAttributes?.();
    expect(resource?.attributes).toMatchObject({
      "service.name": "context-test",
      "service.version": "1.2.3",
      "service.instance.id": "copy-2",
    });
  });

  it("refuses a second registration, also by startNodeTelemetry(), and gives it back at the stop", async () => {
    const first = startNodeContext({ env: {} });
    expect(contextRegistrationOwner()).toBe("startNodeContext()");
    expect(() => startNodeContext({ env: {} })).toThrow(/registered already by startNodeContext\(\)/);
    expect(() => startNodeTelemetry({ env: {}, stopOnSignals: false })).toThrow(/registered already by startNodeContext\(\)/);

    await first.shutdown();
    await expect(first.shutdown()).resolves.toBeUndefined();
    expect(contextRegistrationOwner()).toBeUndefined();
    // The stop removes the tracer provider: a new span is the span of the API again
    expect(isSpanContextValid(trace.getTracer("t").startSpan("after").spanContext())).toBe(false);

    started = startNodeContext({ env: {} });
    expect(contextRegistrationOwner()).toBe("startNodeContext()");
  });
});

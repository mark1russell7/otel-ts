import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import { contextValue, defineContextKeys } from "../../src/context.js";
import { runInIncomingSpan } from "../../src/incoming-span.js";
import { ContextPropagator } from "../../src/context-propagator.js";

defineContextKeys({ "s.tenant": { cardinality: "low", propagate: "internal" } });

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

const spans = new InMemorySpanExporter();
const tracer = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] }).getTracer("server");

beforeAll(() => {
  context.setGlobalContextManager(new AsyncContextManager().enable());
  propagation.setGlobalPropagator(new ContextPropagator());
});

afterAll(() => {
  propagation.disable();
  context.disable();
});

beforeEach(() => spans.reset());

describe("runInIncomingSpan", () => {
  it("runs the handler in a SERVER span in the trace of the caller, with no baggage by default", async () => {
    const seen = await runInIncomingSpan(
      "POST /hooks/a",
      { traceparent: TRACEPARENT, baggage: "s.tenant=acme" },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { active: trace.getActiveSpan()?.spanContext(), tenant: contextValue("s.tenant") };
      },
      { tracer, attributes: { "url.path": "/hooks/a" } },
    );

    const [span] = spans.getFinishedSpans();
    expect(span?.name).toBe("POST /hooks/a");
    expect(span?.kind).toBe(SpanKind.SERVER);
    expect(span?.instrumentationScope.name).toBe("server");
    expect(span?.attributes).toEqual({ "url.path": "/hooks/a" });
    expect(span?.spanContext().traceId).toBe(TRACE_ID);
    expect(span?.parentSpanContext?.spanId).toBe(SPAN_ID);
    expect(span?.parentSpanContext?.isRemote).toBe(true);
    // The span is active in the handler, also after an await. The baggage of the caller is not trusted.
    expect(seen.active?.spanId).toBe(span?.spanContext().spanId);
    expect(seen.tenant).toBeUndefined();
  });

  it("keeps the baggage with trust all, and starts a new trace with trust none", () => {
    const headers = { traceparent: TRACEPARENT, baggage: "s.tenant=acme" };
    expect(runInIncomingSpan("trusted", headers, () => contextValue("s.tenant"), { tracer, trust: "all" })).toBe("acme");
    runInIncomingSpan("public", headers, () => undefined, { tracer, trust: "none" });

    const [trusted, open] = spans.getFinishedSpans();
    expect(trusted?.spanContext().traceId).toBe(TRACE_ID);
    expect(open?.spanContext().traceId).not.toBe(TRACE_ID);
    expect(open?.parentSpanContext).toBeUndefined();
  });

  it("starts a new trace when the caller sends no traceparent, and reads the Headers of Fetch", () => {
    runInIncomingSpan("none", {}, () => undefined, { tracer });
    runInIncomingSpan("fetch", new Headers({ Traceparent: TRACEPARENT }), () => undefined, { tracer });

    const [none, fetched] = spans.getFinishedSpans();
    expect(none?.parentSpanContext).toBeUndefined();
    expect(fetched?.spanContext().traceId).toBe(TRACE_ID);
  });

  it("gives an error of the handler the status ERROR, ends the span and passes the error through", async () => {
    expect(() =>
      runInIncomingSpan("sync", {}, () => {
        throw new Error("sync failure");
      }, { tracer }),
    ).toThrow("sync failure");
    await expect(runInIncomingSpan("async", {}, () => Promise.reject(new Error("async failure")), { tracer })).rejects.toThrow("async failure");

    const [sync, failed] = spans.getFinishedSpans();
    expect(sync?.status).toEqual({ code: SpanStatusCode.ERROR, message: "sync failure" });
    expect(failed?.status).toEqual({ code: SpanStatusCode.ERROR, message: "async failure" });
    expect(failed?.events.map((event) => event.name)).toEqual(["exception"]);
  });

  it("uses the global tracer of otel-ts when the options give no tracer", () => {
    expect(runInIncomingSpan("plain", { traceparent: TRACEPARENT }, () => 7)).toBe(7);
  });
});

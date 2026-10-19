import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { runInRemoteTrace } from "../src/trace-echo.js";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const PARENT_ID = "b7ad6b7169203331";
const TRACEPARENT = `00-${TRACE_ID}-${PARENT_ID}-01`;

describe("runInRemoteTrace", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    context.setGlobalContextManager(new StackContextManager().enable());
  });
  afterEach(() => {
    context.disable();
  });

  it("runs the function in a consumer span whose parent is the trace of the message", () => {
    const tracer = provider.getTracer("test");
    let active: string | undefined;
    const out = runInRemoteTrace(TRACEPARENT, () => {
      active = trace.getActiveSpan()?.spanContext().traceId;
      return 42;
    }, { tracer, name: "realtime.echo", attributes: { "app.collection": "notes" } });
    expect(out).toBe(42);
    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe("realtime.echo");
    expect(span?.kind).toBe(SpanKind.CONSUMER);
    expect(span?.spanContext().traceId).toBe(TRACE_ID);
    expect(span?.parentSpanContext?.spanId).toBe(PARENT_ID);
    expect(span?.attributes["app.collection"]).toBe("notes");
    expect(active).toBe(TRACE_ID);
  });

  it("only runs the function without a valid traceparent", () => {
    const tracer = provider.getTracer("test");
    expect(runInRemoteTrace(undefined, () => "plain", { tracer })).toBe("plain");
    expect(runInRemoteTrace("not-a-traceparent", () => "plain", { tracer })).toBe("plain");
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("marks the span as an error, and passes the error through", () => {
    const tracer = provider.getTracer("test");
    expect(() => runInRemoteTrace(TRACEPARENT, () => {
      throw new Error("the apply failed");
    }, { tracer })).toThrow("the apply failed");
    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events.some((event) => event.name === "exception")).toBe(true);
  });

  it("ends the span when the promise of the function settles", async () => {
    const tracer = provider.getTracer("test");
    let finish: (value: string) => void = () => undefined;
    const done = runInRemoteTrace(TRACEPARENT, () => new Promise<string>((resolve) => { finish = resolve; }), { tracer });
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    finish("applied");
    expect(await done).toBe("applied");
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    await expect(runInRemoteTrace(TRACEPARENT, () => Promise.reject(new Error("late")), { tracer })).rejects.toThrow("late");
    expect(exporter.getFinishedSpans()[1]?.status.code).toBe(SpanStatusCode.ERROR);
  });
});

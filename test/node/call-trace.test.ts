import { afterEach, describe, expect, it, vi } from "vitest";
import { createContextKey, defaultTextMapGetter, isSpanContextValid, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { TracerProvider } from "@opentelemetry/sdk-trace";
import { callTrace } from "../../src/call-trace.js";
import { errorRecord } from "../../src/error-record.js";

// These tests set no context manager and no SDK, as on a page with no SDK. The context of the call goes explicitly.
const W3C = new W3CTraceContextPropagator();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callTrace", () => {
  it("starts a new sampled trace when the context has no span", () => {
    const call = callTrace();
    expect(call.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(call.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(call.sampled).toBe(true);
    expect(call.traceparent).toBe(`00-${call.traceId}-${call.spanId}-01`);
    expect(call.headers).toEqual({ traceparent: call.traceparent });
    const span = trace.getSpanContext(call.context);
    expect(span && isSpanContextValid(span)).toBe(true);
    expect(trace.getSpan(call.context)?.isRecording()).toBe(false);
  });

  it("gives a new trace to each call", () => {
    const first = callTrace();
    const second = callTrace();
    expect(second.traceId).not.toBe(first.traceId);
    expect(second.spanId).not.toBe(first.spanId);
  });

  it("gives the record of a failed call the trace id that the server gets", () => {
    const call = callTrace();
    const server = trace.getSpanContext(W3C.extract(ROOT_CONTEXT, call.headers, defaultTextMapGetter));
    const record = errorRecord(new Error("HTTP 503"), { from: call.context });
    expect(server).toMatchObject({ traceId: call.traceId, spanId: call.spanId, traceFlags: TraceFlags.SAMPLED, isRemote: true });
    expect(record).toMatchObject({ traceId: call.traceId, spanId: call.spanId, sampled: true });
  });

  it("sets the flag NONE for an unsampled new trace", () => {
    const call = callTrace({ sampled: false });
    expect(call.sampled).toBe(false);
    expect(call.traceparent).toBe(`00-${call.traceId}-${call.spanId}-00`);
  });

  it("keeps the trace and the flags of a valid span in the context", () => {
    const span = new TracerProvider().getTracer("test").startSpan("page.read");
    const parent = trace.setSpan(ROOT_CONTEXT, span);
    const call = callTrace({ from: parent, sampled: false });
    expect(call.context).toBe(parent);
    expect(call).toMatchObject({ traceId: span.spanContext().traceId, spanId: span.spanContext().spanId, sampled: true });
    span.end();
  });

  it("keeps the other values of the context", () => {
    const key = createContextKey("call-trace test");
    const call = callTrace({ from: ROOT_CONTEXT.setValue(key, "kept") });
    expect(call.context.getValue(key)).toBe("kept");
  });

  it("never gives an id of only zeros", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(0) });
    const call = callTrace();
    expect(call.traceId).toBe(`${"0".repeat(31)}1`);
    expect(call.spanId).toBe(`${"0".repeat(15)}1`);
    expect(isSpanContextValid(trace.getSpanContext(call.context)!)).toBe(true);
  });

  it("uses Math.random when the platform has no Web Crypto", () => {
    vi.stubGlobal("crypto", undefined);
    const call = callTrace();
    expect(call.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(call.spanId).toMatch(/^[0-9a-f]{16}$/);
  });
});

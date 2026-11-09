import { describe, expect, it } from "vitest";
import { decodeFaro } from "./faro.ts";

const trace = { trace_id: "4bf92f3577b34da6a3ce929d0e0e4736", span_id: "00f067aa0ba902b7" };

describe("decodeFaro", () => {
  it("gives each kind of item, oldest first, with the IDs of its span", () => {
    const items = decodeFaro({
      meta: { app: { name: "otel-ts-demo" } },
      logs: [{ level: "info", message: "hello", timestamp: "2026-11-09T10:00:03.000Z" }],
      exceptions: [{ type: "Error", value: "The payment job failed", timestamp: "2026-11-09T10:00:01.000Z", trace }],
      events: [{ name: "order saved", timestamp: "2026-11-09T10:00:02.000Z", trace }],
      measurements: [{ type: "web-vitals", values: { lcp: 1234.5678 }, timestamp: "2026-11-09T10:00:00.000Z" }],
    });
    expect(items).toEqual([
      { kind: "measurement", text: "web-vitals: lcp 1235", timeMs: Date.parse("2026-11-09T10:00:00.000Z"), traceId: undefined, spanId: undefined },
      { kind: "exception", text: "Error: The payment job failed", timeMs: Date.parse("2026-11-09T10:00:01.000Z"), traceId: trace.trace_id, spanId: trace.span_id },
      { kind: "event", text: "order saved", timeMs: Date.parse("2026-11-09T10:00:02.000Z"), traceId: trace.trace_id, spanId: trace.span_id },
      { kind: "log", text: "info: hello", timeMs: Date.parse("2026-11-09T10:00:03.000Z"), traceId: undefined, spanId: undefined },
    ]);
  });

  it("names the domain of an event", () => {
    expect(decodeFaro({ events: [{ name: "click", domain: "browser", timestamp: "2026-11-09T10:00:00.000Z" }] })[0]?.text).toBe("browser: click");
  });

  it("gives no items for a body with only meta", () => {
    expect(decodeFaro({ meta: { session: { id: "abc" } } })).toEqual([]);
  });
});

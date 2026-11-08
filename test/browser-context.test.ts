import { afterEach, describe, expect, it, vi } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import type { ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { OtelTsConfig, OtelTsInstance } from "../src/index.js";
import { init } from "../src/index.js";
import { defineContextKeys, withContext, withInternalCall } from "../src/context.js";
import { FakeExporter, exportedTo } from "./support/fake-exporter.js";
import { resetVisibility } from "./support/page.js";

// C6 (docs/CONTEXT-DESIGN.md, sections 2, 4 and 5): init() registers the
// propagator of otel-ts, and its providers add the context keys. Real
// providers and processors; only the network layer is replaced.
vi.mock("@opentelemetry/exporter-trace-otlp-http", async () => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return { OTLPTraceExporter: FakeExporter };
});
vi.mock("@opentelemetry/exporter-metrics-otlp-http", async (importOriginal) => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return {
    ...(await importOriginal<typeof import("@opentelemetry/exporter-metrics-otlp-http")>()),
    OTLPMetricExporter: FakeExporter,
  };
});
vi.mock("@opentelemetry/exporter-logs-otlp-http", async () => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return { OTLPLogExporter: FakeExporter };
});

// No auto-instrumentation and no Faro: the tests make their own signals
const QUIET: OtelTsConfig = {
  faro: false,
  instrumentDocumentLoad: false,
  instrumentFetch: false,
  instrumentXhr: false,
  instrumentUserInteraction: false,
  instrumentLongTask: false,
};

defineContextKeys({
  "b.tenant": { cardinality: "low", propagate: "internal" },
  "b.user.id": { cardinality: "high", propagate: "internal" },
  "b.flag": { cardinality: "low", propagate: "none" },
});

let otel: OtelTsInstance | undefined;

afterEach(async () => {
  await otel?.shutdown();
  otel = undefined;
  FakeExporter.instances.length = 0;
  resetVisibility();
});

describe("the context of init() (C6)", () => {
  it("adds the context keys to each span and each log record, and keeps an attribute of the caller", async () => {
    otel = init({ ...QUIET, metrics: false });
    const tracer = trace.getTracer("otel-ts-browser-context");
    const logger = otel.getLogger("otel-ts-browser-context");

    withContext({ "b.tenant": "acme", "b.user.id": "u-1" }, () => {
      tracer.startSpan("keys").end();
      tracer.startSpan("own", { attributes: { "b.tenant": "set by the caller" } }).end();
      logger.emit({ body: "keys" });
    });
    await otel.forceFlush();

    const spans = exportedTo<ReadableSpan>("/v1/traces");
    expect(Object.fromEntries(spans.map((span) => [span.name, [span.attributes["b.tenant"], span.attributes["b.user.id"]]]))).toEqual({
      keys: ["acme", "u-1"],
      own: ["set by the caller", "u-1"],
    });
    const [record] = exportedTo<ReadableLogRecord>("/v1/logs");
    expect(record!.attributes).toMatchObject({ "b.tenant": "acme", "b.user.id": "u-1" });
    // The session processor stays
    expect(record!.attributes["session.id"]).toBe(otel.getSessionId());
  });

  it("removes each key of high cardinality from the metric attributes", async () => {
    otel = init({ ...QUIET, tracing: false, logs: false });
    const counter = otel.getMeter("otel-ts-browser-context").createCounter("b.calls");

    withContext({ "b.tenant": "acme", "b.user.id": "u-1" }, () => {
      counter.add(1, { "b.tenant": "acme", "b.user.id": "u-1", route: "/a" });
    });
    await otel.forceFlush();

    const point = exportedTo<ResourceMetrics>("/v1/metrics")
      .at(-1)
      ?.scopeMetrics.flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === "b.calls")?.dataPoints[0];
    expect(point?.attributes).toEqual({ "b.tenant": "acme", route: "/a" });
  });

  it("sends traceparent on each call, and the baggage only on an internal call", () => {
    otel = init({ ...QUIET, metrics: false, logs: false });
    const span = trace.getTracer("otel-ts-browser-context").startSpan("call");
    const plain: Record<string, string> = {};
    const internal: Record<string, string> = {};

    context.with(trace.setSpan(context.active(), span), () =>
      withContext({ "b.tenant": "acme", "b.flag": "on" }, () => {
        propagation.inject(context.active(), plain);
        withInternalCall(() => propagation.inject(context.active(), internal));
      }),
    );
    span.end();

    expect(plain["traceparent"]).toMatch(new RegExp(`^00-${span.spanContext().traceId}-`));
    expect(plain["baggage"]).toBeUndefined();
    // A key with propagate "none" never leaves the page
    expect(internal["baggage"]).toBe("b.tenant=acme");
  });

  it("refuses a second init() before the shutdown() of the first, and accepts it after", async () => {
    otel = init({ ...QUIET, metrics: false, logs: false });
    expect(() => init({ ...QUIET, metrics: false, logs: false })).toThrow(/registered already by init\(\)/);

    await otel.shutdown();
    // The shutdown removed the globals of the context
    expect(propagation.fields()).toEqual([]);
    otel = init({ ...QUIET, metrics: false, logs: false });
    expect(propagation.fields()).toEqual(expect.arrayContaining(["traceparent", "baggage"]));
  });

  it("registers nothing with tracing off, so a second init() is accepted", () => {
    otel = init({ ...QUIET, tracing: false, metrics: false, logs: false });
    const second = init({ ...QUIET, tracing: false, metrics: false, logs: false });
    void second.shutdown();
    expect(propagation.fields()).toEqual([]);
  });
});

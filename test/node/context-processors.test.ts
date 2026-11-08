import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { context } from "@opentelemetry/api";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import { defineContextKeys, withContext } from "../../src/context.js";
import {
  contextMetricView,
  createContextAttributesProcessor,
  createContextLogRecordProcessor,
  createContextSpanProcessor,
} from "../../src/context-processors.js";

defineContextKeys({
  "q.user.id": { cardinality: "high", propagate: "internal" },
  "q.tenant": { cardinality: "low", propagate: "internal" },
  "q.flag": { cardinality: "low", propagate: "none" },
});

beforeAll(() => {
  context.setGlobalContextManager(new AsyncContextManager().enable());
});

afterAll(() => {
  context.disable();
});

describe("createContextSpanProcessor", () => {
  it("sets each defined key of the context on each span, also after await, and keeps an attribute of the caller", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [createContextSpanProcessor(), new SimpleSpanProcessor(exporter)] });
    const tracer = provider.getTracer("test");

    await withContext({ "q.user.id": "u-1", "q.tenant": "acme", "q.flag": "on" }, async () => {
      await null;
      tracer.startSpan("one").end();
      tracer.startSpan("two", { attributes: { "q.tenant": "set by the caller" } }).end();
    });
    tracer.startSpan("outside").end();

    const spans = Object.fromEntries(exporter.getFinishedSpans().map((span) => [span.name, span.attributes]));
    await provider.shutdown();
    expect(spans["one"]).toEqual({ "q.user.id": "u-1", "q.tenant": "acme", "q.flag": "on" });
    expect(spans["two"]).toEqual({ "q.user.id": "u-1", "q.tenant": "set by the caller", "q.flag": "on" });
    expect(spans["outside"]).toEqual({});
  });
});

describe("createContextLogRecordProcessor", () => {
  it("sets each defined key of the context on each log record", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({ processors: [createContextLogRecordProcessor(), new SimpleLogRecordProcessor(exporter)] });
    const logger = provider.getLogger("test");

    await withContext({ "q.user.id": "u-2", "q.flag": "off" }, async () => {
      await null;
      logger.emit({ body: "inside" });
    });
    logger.emit({ body: "outside" });

    await provider.forceFlush();
    const records = exporter.getFinishedLogRecords().map((record) => [record.body, record.attributes]);
    await provider.shutdown();
    expect(records).toEqual([
      ["inside", { "q.user.id": "u-2", "q.flag": "off" }],
      ["outside", {}],
    ]);
  });
});

describe("contextMetricView", () => {
  it("removes each key of high cardinality from a metric, and keeps the others", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
    const provider = new MeterProvider({ readers: [reader], views: [contextMetricView()] });
    const counter = provider.getMeter("test").createCounter("requests");

    counter.add(1, { "q.user.id": "u-1", "q.tenant": "acme", route: "/a" });
    counter.add(1, { "q.user.id": "u-2", "q.tenant": "acme", route: "/a" });

    await reader.forceFlush();
    const points = exporter.getMetrics().flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics.flatMap((metric) => metric.dataPoints)));
    await provider.shutdown();
    // Two user ids, one series: the user id is not a dimension
    expect(points.map((point) => [point.attributes, point.value])).toEqual([[{ "q.tenant": "acme", route: "/a" }, 2]]);
  });

  it("gives the same object when nothing is removed, and reads a key defined later", () => {
    const processor = createContextAttributesProcessor();
    const incoming = { route: "/a", "q.late.id": "x" };

    expect(processor.process(incoming)).toBe(incoming);
    defineContextKeys({ "q.late.id": { cardinality: "high", propagate: "none" } });
    expect(processor.process(incoming)).toEqual({ route: "/a" });
  });
});

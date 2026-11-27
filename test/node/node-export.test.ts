import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metrics, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider } from "@opentelemetry/sdk-metrics";
import { defineContextKeys } from "../../src/context.js";
import { startNodeContext, type NodeContext } from "../../src/node-context.js";
import { exportMeterProvider, exportSpanProcessors } from "../../src/node-export.js";
import { metricReaderSettings } from "../../src/node-metric-exporters.js";
import { startStubCollector, type StubCollector } from "../../src/node-testing.js";

let started: NodeContext | undefined;

defineContextKeys({ "c.export.user": { cardinality: "high", propagate: "internal" } });
let collector: StubCollector | undefined;

afterEach(async () => {
  await started?.shutdown();
  started = undefined;
  await collector?.close();
  collector = undefined;
  vi.unstubAllEnvs();
});

describe("exportSpanProcessors", () => {
  it("gives no processor with no endpoint and no exporter", () => {
    expect(exportSpanProcessors({ env: {} })).toEqual([]);
  });

  it("gives no processor when OTEL_TRACES_EXPORTER is none", () => {
    expect(exportSpanProcessors({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318", OTEL_TRACES_EXPORTER: "none" } })).toEqual([]);
  });

  it("refuses an exporter name that it does not make", () => {
    expect(() => exportSpanProcessors({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318", OTEL_TRACES_EXPORTER: "zipkin" } })).toThrow(RangeError);
  });

  it("exports the spans of startNodeContext to the endpoint of the variables, and the stop flushes them", async () => {
    collector = await startStubCollector();
    // The OTLP exporter reads its endpoint from process.env. The stub collector reads OTLP/HTTP JSON.
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.endpoint);
    const env = { OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint, OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" };
    started = startNodeContext({ serviceName: "otel-ts-export-test", env: {}, spanProcessors: exportSpanProcessors({ env }) });

    trace.getTracer("otel-ts-export-scope").startSpan("work").end();
    await started.shutdown();
    started = undefined;

    expect(collector.spansByScope().get("otel-ts-export-scope")).toEqual(new Set(["work"]));
  });

  it("exports to the exporter of the options, also with no endpoint", async () => {
    collector = await startStubCollector();
    const exporter = new OTLPTraceExporter({ url: `${collector.endpoint}/v1/traces` });
    started = startNodeContext({ env: {}, spanProcessors: exportSpanProcessors({ env: {}, exporter }) });

    trace.getTracer("otel-ts-export-own").startSpan("own").end();
    await started.shutdown();
    started = undefined;

    expect(collector.spansByScope().get("otel-ts-export-own")).toEqual(new Set(["own"]));
  });
});

describe("exportMeterProvider", () => {
  const ENDPOINT = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318" };

  afterEach(() => {
    metrics.disable();
  });

  it("gives no meter provider with no endpoint and no exporter, or when OTEL_METRICS_EXPORTER is none", () => {
    expect(exportMeterProvider({ env: {} })).toBeUndefined();
    expect(exportMeterProvider({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: "" } })).toBeUndefined();
    expect(exportMeterProvider({ env: { ...ENDPOINT, OTEL_METRICS_EXPORTER: "none" } })).toBeUndefined();
  });

  it("refuses a bad variable at the call, before a reader exists", () => {
    expect(() => exportMeterProvider({ env: { ...ENDPOINT, OTEL_METRICS_EXPORTER: "prometheus" } })).toThrow(RangeError);
    expect(() => exportMeterProvider({ env: { ...ENDPOINT, OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "grpc" } })).toThrow(RangeError);
    for (const interval of ["0", "-5", "1.5", "soon"]) {
      expect(() => exportMeterProvider({ env: { ...ENDPOINT, OTEL_METRIC_EXPORT_INTERVAL: interval } }), interval).toThrow(RangeError);
    }
    expect(() => exportMeterProvider({ env: { ...ENDPOINT, OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION: "summary" } })).toThrow(RangeError);
  });

  it("reads the interval and the time limit of the variables, and keeps the time limit under the interval", () => {
    expect(metricReaderSettings({})).toEqual({ names: ["otlp"], protocol: "http/protobuf", intervalMs: 60_000, timeoutMs: 30_000 });
    expect(metricReaderSettings({ OTEL_METRIC_EXPORT_INTERVAL: "1000", OTEL_METRIC_EXPORT_TIMEOUT: "5000", OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" })).toEqual({
      names: ["otlp"],
      protocol: "http/json",
      intervalMs: 1000,
      timeoutMs: 1000,
    });
  });

  it("exports the metrics of the API to its exporter, with the resource of the service and no high-cardinality key, at the stop", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const meterProvider = exportMeterProvider({ env: {}, exporter });
    expect(meterProvider).toBeDefined();
    started = startNodeContext({ serviceName: "otel-ts-metrics-test", env: {}, ...(meterProvider ? { meterProvider } : {}) });

    metrics.getMeter("otel-ts-metrics-scope").createCounter("work.count").add(2, { "c.export.user": "u-1", route: "/a" });
    await started.shutdown();
    started = undefined;

    const [exported] = exporter.getMetrics().slice(-1);
    expect(exported?.resource.attributes["service.name"]).toBe("otel-ts-metrics-test");
    const scope = exported?.scopeMetrics.find((s) => s.scope.name === "otel-ts-metrics-scope");
    const point = scope?.metrics.find((m) => m.descriptor.name === "work.count")?.dataPoints[0];
    expect(point?.value).toBe(2);
    // the views of otel-ts remove the context key of high cardinality, as the entry /node does
    expect(point?.attributes).toEqual({ route: "/a" });
    // the stop removes the global meter provider of this call
    expect(metrics.getMeterProvider()).not.toBeInstanceOf(MeterProvider);
  });

  it("exports to the OTLP endpoint of the variables with OTLP/HTTP JSON", async () => {
    const bodies: string[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (req.url === "/v1/metrics") bodies.push(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      // The OTLP exporter reads its endpoint from process.env
      vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint);
      const env = { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" };
      const meterProvider = exportMeterProvider({ env });
      started = startNodeContext({ serviceName: "otel-ts-metrics-otlp", env: {}, ...(meterProvider ? { meterProvider } : {}) });
      metrics.getMeter("otel-ts-metrics-otlp-scope").createHistogram("work.duration", { unit: "s" }).record(0.25);
      await started.shutdown();
      started = undefined;

      expect(bodies.join("\n")).toContain("work.duration");
      expect(bodies.join("\n")).toContain("otel-ts-metrics-otlp");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("keeps a global meter provider that a part of the program set first", async () => {
    const own = new MeterProvider();
    expect(metrics.setGlobalMeterProvider(own)).toBe(true);
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const meterProvider = exportMeterProvider({ env: {}, exporter });
    started = startNodeContext({ env: {}, ...(meterProvider ? { meterProvider } : {}) });
    await started.shutdown();
    started = undefined;
    expect(metrics.getMeterProvider()).toBe(own);
    await own.shutdown();
  });

  it("a context with no meter provider leaves the meters of the API with no record", async () => {
    started = startNodeContext({ env: {} });
    expect(metrics.getMeterProvider()).not.toBeInstanceOf(MeterProvider);
    await started.shutdown();
    started = undefined;
  });
});

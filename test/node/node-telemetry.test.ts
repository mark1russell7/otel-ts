import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { logs } from "@opentelemetry/api-logs";
import type { LogRecordExporter } from "@opentelemetry/sdk-logs";
import { contextValue, defineContextKeys, withContext, withInternalCall } from "../../src/context.js";
import {
  AggregationTemporality,
  AggregationType,
  DataPointType,
  InMemoryMetricExporter,
  InstrumentType,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { metrics } from "@opentelemetry/api";
import { exporterNames, histogramAggregation, otlpProtocol } from "../../src/node-exporters.js";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExportResultCode } from "@opentelemetry/core";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { startNodeTelemetry, type NodeTelemetry } from "../../src/node.js";
import { startStubCollector, type StubCollector } from "../../src/node-testing.js";

let telemetry: NodeTelemetry | undefined;
let collector: StubCollector | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  await collector?.close();
  telemetry = undefined;
  collector = undefined;
});

describe("startNodeTelemetry", () => {
  it("registers the context with export off, and exports nothing", async () => {
    defineContextKeys({ "n.request.id": { cardinality: "high", propagate: "internal" } });
    telemetry = startNodeTelemetry({ env: {}, stopOnSignals: false });
    expect(telemetry.enabled).toBe(false);

    // AsyncLocalStorage keeps the value after await
    const seen = await withContext({ "n.request.id": "r-1" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return contextValue("n.request.id");
    });
    expect(seen).toBe("r-1");

    // The propagator of otel-ts: an incoming trace goes on, and the baggage goes only on an internal call
    const incoming = propagation.extract(context.active(), {
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      baggage: "n.request.id=r-2",
    });
    const plain: Record<string, string> = {};
    const internal: Record<string, string> = {};
    context.with(incoming, () => {
      propagation.inject(context.active(), plain);
      withInternalCall(() => propagation.inject(context.active(), internal));
    });
    expect(plain["traceparent"]).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-/);
    expect(plain["baggage"]).toBeUndefined();
    expect(internal["baggage"]).toBe("n.request.id=r-2");
  });

  it("refuses a second start before the stop of the first, and accepts it after", async () => {
    telemetry = startNodeTelemetry({ env: {}, stopOnSignals: false });
    expect(() => startNodeTelemetry({ env: {}, stopOnSignals: false })).toThrow(/registered already by startNodeTelemetry\(\)/);

    await telemetry.shutdown();
    telemetry = startNodeTelemetry({ env: {}, stopOnSignals: false });
    expect(telemetry.enabled).toBe(false);
  });

  it("adds the context keys to each span with export on, and keeps an attribute of the caller", async () => {
    defineContextKeys({ "n.tenant": { cardinality: "low", propagate: "internal" } });
    // An exporter that keeps its spans at the stop (InMemorySpanExporter clears them)
    const finished: ReadableSpan[] = [];
    const exporter: SpanExporter = {
      export: (spans, done) => {
        finished.push(...spans);
        done({ code: ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
    };
    telemetry = startNodeTelemetry({ enabled: true, env: {}, traceExporter: exporter, stopOnSignals: false });
    const tracer = trace.getTracer("otel-ts-node-context");

    withContext({ "n.tenant": "acme" }, () => {
      tracer.startSpan("keys").end();
      tracer.startSpan("own", { attributes: { "n.tenant": "set by the caller" } }).end();
    });
    await telemetry.shutdown();

    const spans = Object.fromEntries(finished.map((span) => [span.name, span.attributes["n.tenant"]]));
    expect(spans).toEqual({ keys: "acme", own: "set by the caller" });
  });

  it("keeps the histogram aggregation of the variable, with the metric views of the context", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
    telemetry = startNodeTelemetry({
      enabled: true,
      env: { OTEL_TRACES_EXPORTER: "none", OTEL_LOGS_EXPORTER: "none", OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION: "base2_exponential_bucket_histogram" },
      metricReaders: [reader],
      stopOnSignals: false,
    });
    metrics.getMeter("otel-ts-node-context").createHistogram("n.duration").record(5);

    await reader.forceFlush();
    const found = exporter.getMetrics().flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics)).find((m) => m.descriptor.name === "n.duration");
    expect(found?.dataPointType).toBe(DataPointType.EXPONENTIAL_HISTOGRAM);
  });

  it("adds the context keys to each log record with export on, and keeps an attribute of the caller", async () => {
    defineContextKeys({ "n.job.id": { cardinality: "high", propagate: "none" } });
    const finished: Array<[unknown, unknown]> = [];
    const logExporter: LogRecordExporter = {
      export: (records, done) => {
        finished.push(...records.map((record): [unknown, unknown] => [record.body, record.attributes["n.job.id"]]));
        done({ code: ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
    };
    telemetry = startNodeTelemetry({ enabled: true, env: { OTEL_TRACES_EXPORTER: "none" }, logExporter, stopOnSignals: false });
    const logger = logs.getLogger("otel-ts-node-context");

    await withContext({ "n.job.id": "j-1" }, async () => {
      await null;
      logger.emit({ body: "keys" });
      logger.emit({ body: "own", attributes: { "n.job.id": "set by the caller" } });
    });
    logger.emit({ body: "outside" });
    await telemetry.shutdown();

    expect(finished).toEqual([
      ["keys", "j-1"],
      ["own", "set by the caller"],
      ["outside", undefined],
    ]);
  });

  it("refuses an exporter name that it does not make, and keeps no registration", () => {
    expect(() => startNodeTelemetry({ enabled: true, env: { OTEL_TRACES_EXPORTER: "zipkin" }, stopOnSignals: false })).toThrow(
      /OTEL_TRACES_EXPORTER has "zipkin"/,
    );
    telemetry = startNodeTelemetry({ env: {}, stopOnSignals: false });
    expect(telemetry.enabled).toBe(false);
  });

  it("exports the spans to the collector of the endpoint", async () => {
    collector = await startStubCollector();
    telemetry = startNodeTelemetry({
      serviceName: "otel-ts-node-test",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint },
      traceExporter: new OTLPTraceExporter({ url: `${collector.endpoint}/v1/traces` }),
      stopOnSignals: false,
    });
    expect(telemetry.enabled).toBe(true);
    expect(telemetry.esmHook).toBe(false);

    trace.getTracer("otel-ts-node-test-scope").startSpan("work").end();
    await telemetry.shutdown(); // the stop flushes the spans

    expect(collector.exports).toBeGreaterThan(0);
    expect(collector.spansByScope().get("otel-ts-node-test-scope")).toEqual(new Set(["work"]));
    expect(collector.has(["otel-ts-node-test-scope"])).toBe(true);
    expect(collector.missing(["otel-ts-node-test-scope", "absent-scope"])).toEqual(["absent-scope"]);
  });

  it("does nothing at a second stop", async () => {
    collector = await startStubCollector();
    telemetry = startNodeTelemetry({
      enabled: true,
      env: {},
      traceExporter: new OTLPTraceExporter({ url: `${collector.endpoint}/v1/traces` }),
      stopOnSignals: false,
    });
    await telemetry.shutdown();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});

describe("startNodeTelemetry at SIGTERM and SIGINT", () => {
  const signals = ["SIGTERM", "SIGINT"] as const;
  let saved: Map<NodeJS.Signals, Array<(...args: unknown[]) => void>>;

  // The listeners of the test runner stay out of the count of the service's listeners
  beforeEach(() => {
    saved = new Map(signals.map((signal) => [signal, process.rawListeners(signal) as Array<(...args: unknown[]) => void>]));
    for (const signal of signals) process.removeAllListeners(signal);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const signal of signals) {
      process.removeAllListeners(signal);
      for (const listener of saved.get(signal) ?? []) process.on(signal, listener);
    }
  });

  /** Start the SDK with an exporter that records its stop, and a process.kill that does nothing */
  function start(): { stopped: () => boolean; kill: ReturnType<typeof vi.spyOn> } {
    let stopped = false;
    const exporter: SpanExporter = {
      export: (_spans, done) => done({ code: ExportResultCode.SUCCESS }),
      shutdown: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        stopped = true;
      },
    };
    telemetry = startNodeTelemetry({ enabled: true, env: {}, traceExporter: exporter });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    return { stopped: () => stopped, kill };
  }

  for (const signal of signals) {
    it(`flushes, then raises ${signal} again when the service has no listener of its own`, async () => {
      const { stopped, kill } = start();
      let stoppedBeforeKill = false;
      kill.mockImplementation(() => {
        stoppedBeforeKill = stopped();
        return true;
      });

      process.emit(signal, signal);

      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, signal));
      expect(kill).toHaveBeenCalledTimes(1);
      expect(stoppedBeforeKill).toBe(true);
      // The listener is gone, so the raised signal gets the default action of Node.js
      expect(process.listenerCount(signal)).toBe(0);
    });
  }

  it("flushes, and lets the listener of the service end the process", async () => {
    const own = vi.fn();
    process.once("SIGTERM", own);
    const { stopped, kill } = start();

    process.emit("SIGTERM", "SIGTERM");
    await telemetry?.shutdown(); // waits for the flush that the signal started

    expect(stopped()).toBe(true);
    expect(own).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  // Windows has no signals: there, process.kill() always ends the process
  it.skipIf(process.platform === "win32")("ends a service that has no listener at SIGTERM", async () => {
    // The built entry (CI builds before the tests): a child process cannot load the TypeScript source
    const entry = new URL("../../dist/node.js", import.meta.url).href;
    const service = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          `import { startNodeTelemetry } from ${JSON.stringify(entry)};`,
          "startNodeTelemetry({ enabled: true, env: {}, traceExporter: { export: (s, done) => done({ code: 0 }), shutdown: async () => {} } });",
          "setInterval(() => {}, 1000);",
          "console.log('ready');",
        ].join("\n"),
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const exit = once(service, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
    // "ready", or an exit when the service fails to start
    await Promise.race([once(service.stdout, "data"), exit]);
    service.kill("SIGTERM");
    const timeout = setTimeout(() => service.kill("SIGKILL"), 10_000);
    const [, signal] = await exit;
    clearTimeout(timeout);
    // Before, the service continued to run, and only SIGKILL ended it
    expect(signal).toBe("SIGTERM");
  }, 20_000);

  it("adds no listener when stopOnSignals is false", () => {
    telemetry = startNodeTelemetry({ enabled: true, env: {}, stopOnSignals: false });
    expect(signals.map((signal) => process.listenerCount(signal))).toEqual([0, 0]);
  });
});

describe("startStubCollector", () => {
  it("gives the scopes that are still missing when the time is up", async () => {
    collector = await startStubCollector();
    let pokes = 0;
    const missing = await collector.waitFor(["absent-scope"], {
      timeoutMs: 300,
      intervalMs: 50,
      poke: async () => {
        pokes++;
      },
    });
    expect(missing).toEqual(["absent-scope"]);
    expect(pokes).toBeGreaterThan(1);
  });

  it("answers an export that is not JSON, and counts it", async () => {
    collector = await startStubCollector();
    const res = await fetch(`${collector.endpoint}/v1/traces`, { method: "POST", body: "\u0000binary" });
    expect(res.status).toBe(200);
    expect(collector.exports).toBe(1);
    expect(collector.spansByScope().size).toBe(0);
  });
});

describe("the exporters of the OTEL_* variables", () => {
  it("gives otlp by default, nothing with none, and refuses another name", () => {
    expect(exporterNames("traces", {})).toEqual(["otlp"]);
    expect(exporterNames("logs", { OTEL_LOGS_EXPORTER: " Console , otlp,console" })).toEqual(["console", "otlp"]);
    expect(exporterNames("logs", { OTEL_LOGS_EXPORTER: "otlp,none" })).toEqual([]);
    expect(() => exporterNames("traces", { OTEL_TRACES_EXPORTER: "jaeger" })).toThrow(RangeError);
  });

  it("gives the protocol of the signal, then the general one, then http/protobuf, and refuses grpc", () => {
    expect(otlpProtocol("traces", {})).toBe("http/protobuf");
    expect(otlpProtocol("traces", { OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" })).toBe("http/json");
    expect(otlpProtocol("logs", { OTEL_EXPORTER_OTLP_PROTOCOL: "http/json", OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/protobuf" })).toBe("http/protobuf");
    expect(() => otlpProtocol("traces", { OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" })).toThrow(/For grpc, give the exporter/);
  });

  it("reads the histogram aggregation, and refuses a value it does not know", () => {
    const variable = "OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION";
    const exponential = histogramAggregation({ [variable]: "base2_exponential_bucket_histogram" });
    expect(exponential(InstrumentType.HISTOGRAM)).toEqual({ type: AggregationType.EXPONENTIAL_HISTOGRAM });
    expect(exponential(InstrumentType.COUNTER)).toEqual({ type: AggregationType.DEFAULT });
    for (const env of [{}, { [variable]: "explicit_bucket_histogram" }]) {
      expect(histogramAggregation(env)(InstrumentType.HISTOGRAM)).toEqual({ type: AggregationType.DEFAULT });
    }
    expect(() => histogramAggregation({ [variable]: "linear" })).toThrow(RangeError);
  });
});

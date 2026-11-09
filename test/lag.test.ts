import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { AllMonitorHandles, BrowserDepsOptions } from "@mark1russell7/lag";
import { init, type OtelTsInstance } from "../src/index.js";
import { lagDeps, type LagDeps } from "../src/lag.js";

// The instance of the last test of connect(): no tracing, metrics, logs or Faro, so no exporter starts
vi.mock("../src/faro.js", () => ({ setupFaro: vi.fn() }));

/** A reader that collects on demand */
class TestReader extends MetricReader {
  constructor() {
    super({ aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE });
  }
  protected override onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
  protected override onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** An instance of otel-ts on the SDK providers, with in-memory exporters */
function testInstance() {
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] });
  const logExporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter: logExporter })] });
  const reader = new TestReader();
  const meterProvider = new MeterProvider({ readers: [reader] });
  const listeners: Array<() => void> = [];
  const instance: Pick<OtelTsInstance, "getMeter" | "getLogger" | "onBeforeFlush"> = {
    getMeter: (name) => meterProvider.getMeter(name),
    getLogger: (name) => loggerProvider.getLogger(name),
    onBeforeFlush: (listener) => {
      const run = (): void => listener({});
      listeners.push(run);
      return () => listeners.splice(listeners.indexOf(run), 1);
    },
  };
  const flush = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return { instance, spanExporter, logExporter, reader, tracerProvider, flush };
}

let otel: OtelTsInstance | undefined;

afterEach(async () => {
  await otel?.shutdown();
  otel = undefined;
  trace.disable();
  context.disable();
  propagation.disable();
});

describe("lagDeps", () => {
  it("gives the meter of the instance, with the name lag", async () => {
    const { instance, reader } = testInstance();
    const lag = lagDeps(instance);
    lag.meter.createCounter("lag_test_counter", { unit: "1" }).add(2, { mode: "test" });
    lag.meter.createHistogram("lag_test_histogram", { unit: "ms" }).record(12);

    const { resourceMetrics } = await reader.collect();
    const [scope] = resourceMetrics.scopeMetrics;
    expect(scope?.scope.name).toBe("lag");
    expect(scope?.metrics.map((metric) => metric.descriptor.name).sort()).toEqual(["lag_test_counter", "lag_test_histogram"]);
  });

  it("gives the diagnostics and the events of lag as log records of the instance", () => {
    const { instance, logExporter } = testInstance();
    const lag = lagDeps(instance, { name: "lag-web" });
    lag.logger.log("warn", "DriftLag: the browser throttles the timers.", {});
    lag.events.emit("lag.long_task", { "lag.duration_ms": 120 });

    const [diagnostic, event] = logExporter.getFinishedLogRecords();
    expect(diagnostic?.instrumentationScope.name).toBe("lag-web");
    expect(diagnostic?.severityNumber).toBe(13);
    expect(diagnostic?.body).toContain("throttles the timers");
    expect(event?.eventName).toBe("lag.long_task");
    expect(event?.attributes).toEqual({ "lag.duration_ms": 120 });
  });

  it("gives the spans of the monitors to the tracer of the options, with their parent", () => {
    const { instance, spanExporter, tracerProvider } = testInstance();
    const lag = lagDeps(instance, { tracer: tracerProvider.getTracer("lag") });
    const view = lag.spans.start("lag.page_view", { startTime: 1_000 });
    lag.spans.record("lag.hang", { startTime: 1_100, endTime: 1_600, ...(view.identity ? { parent: view.identity } : {}) });
    view.end(2_000);

    const [hang, pageView] = spanExporter.getFinishedSpans();
    expect(hang?.name).toBe("lag.hang");
    expect(pageView?.name).toBe("lag.page_view");
    expect(hang?.spanContext().traceId).toBe(pageView?.spanContext().traceId);
    expect(hang?.parentSpanContext?.spanId).toBe(pageView?.spanContext().spanId);
  });

  it("connect() records the values of the monitors before each flush, until its remover runs", () => {
    const { instance, flush } = testInstance();
    const monitors = { flush: vi.fn() };
    const disconnect = lagDeps(instance).connect(monitors);
    flush();
    expect(monitors.flush).toHaveBeenCalledTimes(1);
    disconnect();
    flush();
    expect(monitors.flush).toHaveBeenCalledTimes(1);
  });

  it("connect() runs before the flush of a real instance", async () => {
    otel = init({ tracing: false, metrics: false, logs: false, faro: false });
    const monitors = { flush: vi.fn() };
    lagDeps(otel).connect(monitors);
    await otel.forceFlush();
    expect(monitors.flush).toHaveBeenCalledTimes(1);
  });

  it("fits the options of createBrowserDeps() and the monitors of setupAllMonitors()", () => {
    expectTypeOf<LagDeps>().toMatchTypeOf<Pick<BrowserDepsOptions, "meter" | "logger" | "events" | "spans">>();
    expectTypeOf<AllMonitorHandles>().toMatchTypeOf<Parameters<LagDeps["connect"]>[0]>();
    expectTypeOf<OtelTsInstance>().toMatchTypeOf<Parameters<typeof lagDeps>[0]>();
  });
});

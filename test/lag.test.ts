import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { captureTelemetry } from "@mark1russell7/rigor-testkit/otel";
import type { AllMonitorHandles, BrowserDepsOptions } from "@mark1russell7/lag";
import { init, type OtelTsInstance } from "../src/index.js";
import { lagDeps, type LagDeps } from "../src/lag.js";

// The instance of the last test of connect(): no tracing, metrics, logs or Faro, so no exporter starts
vi.mock("../src/faro.js", () => ({ setupFaro: vi.fn() }));

/** An instance of otel-ts on the providers of the capture of rigor-testkit */
function testInstance() {
  const capture = captureTelemetry();
  const listeners: Array<() => void> = [];
  const instance: Pick<OtelTsInstance, "getMeter" | "getLogger" | "onBeforeFlush"> = {
    getMeter: (name) => capture.meterProvider.getMeter(name),
    getLogger: (name) => capture.loggerProvider.getLogger(name),
    onBeforeFlush: (listener) => {
      const run = (): void => listener({});
      listeners.push(run);
      return () => listeners.splice(listeners.indexOf(run), 1);
    },
  };
  const flush = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return { instance, capture, flush };
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
    const { instance, capture } = testInstance();
    const lag = lagDeps(instance);
    lag.meter.createCounter("lag_test_counter", { unit: "1" }).add(2, { mode: "test" });
    lag.meter.createHistogram("lag_test_histogram", { unit: "ms" }).record(12);

    const { resourceMetrics } = await capture.metricReader.collect();
    const [scope] = resourceMetrics.scopeMetrics;
    expect(scope?.scope.name).toBe("lag");
    expect(scope?.metrics.map((metric) => metric.descriptor.name).sort()).toEqual(["lag_test_counter", "lag_test_histogram"]);
  });

  it("gives the diagnostics and the events of lag as log records of the instance", async () => {
    const { instance, capture } = testInstance();
    const lag = lagDeps(instance, { name: "lag-web" });
    lag.logger.log("warn", "DriftLag: the browser throttles the timers.", {});
    lag.events.emit("lag.long_task", { "lag.duration_ms": 120 });

    const [diagnostic, event] = await capture.logRecords();
    expect(diagnostic?.instrumentationScope.name).toBe("lag-web");
    expect(diagnostic?.severityNumber).toBe(13);
    expect(diagnostic?.body).toContain("throttles the timers");
    expect(event?.eventName).toBe("lag.long_task");
    expect(event?.attributes).toEqual({ "lag.duration_ms": 120 });
  });

  it("gives the spans of the monitors to the tracer of the options, with their parent", async () => {
    const { instance, capture } = testInstance();
    const lag = lagDeps(instance, { tracer: capture.tracerProvider.getTracer("lag") });
    const view = lag.spans.start("lag.page_view", { startTime: 1_000 });
    lag.spans.record("lag.hang", { startTime: 1_100, endTime: 1_600, ...(view.identity ? { parent: view.identity } : {}) });
    view.end(2_000);

    const [hang, pageView] = await capture.spans();
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { propagation, trace } from "@opentelemetry/api";
import type { OtelTsConfig, OtelTsInstance } from "../src/index.js";
import { init } from "../src/index.js";
import { contextRegistrationOwner } from "../src/context-propagator.js";
import { FakeExporter } from "./support/fake-exporter.js";

// A part of init() that fails after the claim of the context (weekly review
// of 2026-11-09, src/init.ts). The logs fail when the test sets the flag.
const failure = vi.hoisted(() => ({ logs: false }));
vi.mock("../src/logs.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/logs.js")>();
  return {
    ...real,
    setupLogs: (...args: Parameters<typeof real.setupLogs>) => {
      if (failure.logs) throw new Error("the logs did not start");
      return real.setupLogs(...args);
    },
  };
});
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

// No auto-instrumentation and no Faro
const QUIET: OtelTsConfig = {
  faro: false,
  instrumentDocumentLoad: false,
  instrumentFetch: false,
  instrumentXhr: false,
  instrumentUserInteraction: false,
  instrumentLongTask: false,
};

let otel: OtelTsInstance | undefined;

afterEach(async () => {
  failure.logs = false;
  await otel?.shutdown();
  otel = undefined;
  FakeExporter.instances.length = 0;
});

describe("init() that fails after the claim of the context", () => {
  it("gives back the claim and the globals of the context, so a next init() starts", async () => {
    failure.logs = true;
    expect(() => init(QUIET)).toThrow("the logs did not start");

    // Before, the claim stayed: each later init() threw "registered already by init()"
    expect(contextRegistrationOwner()).toBeUndefined();
    expect(propagation.fields()).toEqual([]);
    // The tracer provider that started is not the global one now
    expect(trace.getTracer("t").startSpan("s").spanContext().traceId).toBe("00000000000000000000000000000000");

    failure.logs = false;
    otel = init(QUIET);
    expect(contextRegistrationOwner()).toBe("init()");
    expect(propagation.fields()).toEqual(expect.arrayContaining(["traceparent", "baggage"]));
  });
});

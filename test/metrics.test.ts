import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AggregationTemporalityPreference,
  OTLPMetricExporter,
} from "@opentelemetry/exporter-metrics-otlp-http";
import type { OtelTsInstance } from "../src/index.js";
import { init } from "../src/init.js";

vi.mock("@opentelemetry/exporter-metrics-otlp-http", async (importOriginal) => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return {
    ...(await importOriginal<
      typeof import("@opentelemetry/exporter-metrics-otlp-http")
    >()),
    OTLPMetricExporter: vi.fn(FakeExporter),
  };
});

// Only metrics are under test; keep zone.js and Faro out
vi.mock("../src/tracing.js", () => ({ setupTracing: vi.fn() }));
vi.mock("../src/faro.js", () => ({ setupFaro: vi.fn() }));

describe("metricsTemporality", () => {
  let otel: OtelTsInstance | undefined;

  afterEach(async () => {
    await otel?.shutdown();
    otel = undefined;
    vi.clearAllMocks();
  });

  it("requests cumulative temporality by default", () => {
    otel = init({ tracing: false, logs: false, faro: false });

    expect(OTLPMetricExporter).toHaveBeenCalledOnce();
    expect(OTLPMetricExporter).toHaveBeenCalledWith({
      url: "http://localhost:4318/v1/metrics",
      temporalityPreference: AggregationTemporalityPreference.CUMULATIVE,
    });
  });

  it("requests delta temporality when configured", () => {
    otel = init({
      tracing: false,
      logs: false,
      faro: false,
      metricsTemporality: "delta",
    });

    expect(OTLPMetricExporter).toHaveBeenCalledOnce();
    expect(OTLPMetricExporter).toHaveBeenCalledWith({
      url: "http://localhost:4318/v1/metrics",
      temporalityPreference: AggregationTemporalityPreference.DELTA,
    });
  });
});

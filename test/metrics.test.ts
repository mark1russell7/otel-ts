import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AggregationTemporalityPreference,
  type OTLPMetricExporterOptions,
} from "@opentelemetry/exporter-metrics-otlp-http";
import {
  AggregationTemporality,
  DataPointType,
  type ExponentialHistogram,
  type MetricData,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import type { OtelTsConfig, OtelTsInstance } from "../src/index.js";
import { init } from "../src/init.js";

const exporter = vi.hoisted(() => ({
  /** Called with the options of every OTLPMetricExporter created */
  created: vi.fn<(options?: OTLPMetricExporterOptions) => void>(),
  exported: [] as ResourceMetrics[],
}));
const { exported } = exporter;

// The real OTLP exporter, including its temporality and aggregation
// selection, with the network delegate replaced by one that keeps the data.
// (A class wrapped in vi.fn() loses its prototype methods, so it isn't.)
vi.mock("@opentelemetry/exporter-metrics-otlp-http", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@opentelemetry/exporter-metrics-otlp-http")
    >();
  const { ExportResultCode } = await import("@opentelemetry/core");

  class InMemoryOTLPMetricExporter extends original.OTLPMetricExporterBase {
    constructor(config?: OTLPMetricExporterOptions) {
      super(
        {
          export(metrics, resultCallback) {
            exporter.exported.push(metrics);
            resultCallback({ code: ExportResultCode.SUCCESS });
          },
          forceFlush: () => Promise.resolve(),
          shutdown: () => Promise.resolve(),
        },
        config,
      );
      exporter.created(config);
    }
  }

  return { ...original, OTLPMetricExporter: InMemoryOTLPMetricExporter };
});

// Only metrics are under test; keep zone.js and Faro out
vi.mock("../src/tracing.js", () => ({ setupTracing: vi.fn() }));
vi.mock("../src/faro.js", () => ({ setupFaro: vi.fn() }));

let otel: OtelTsInstance | undefined;

function start(config?: OtelTsConfig): OtelTsInstance {
  otel = init({ tracing: false, logs: false, faro: false, ...config });
  return otel;
}

/** The named metric from the most recent export */
function lastExported(name: string): MetricData {
  const metric = exported
    .at(-1)
    ?.scopeMetrics.flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === name);
  if (!metric) throw new Error(`${name} was not exported`);
  return metric;
}

afterEach(async () => {
  await otel?.shutdown();
  otel = undefined;
  exported.length = 0;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("metricsTemporality", () => {
  it("requests cumulative temporality by default", () => {
    start();

    expect(exporter.created).toHaveBeenCalledOnce();
    expect(exporter.created).toHaveBeenCalledWith({
      url: "http://localhost:4318/v1/metrics",
      temporalityPreference: AggregationTemporalityPreference.CUMULATIVE,
    });
  });

  it("requests delta temporality when configured", () => {
    start({ metricsTemporality: "delta" });

    expect(exporter.created).toHaveBeenCalledOnce();
    expect(exporter.created).toHaveBeenCalledWith({
      url: "http://localhost:4318/v1/metrics",
      temporalityPreference: AggregationTemporalityPreference.DELTA,
    });
  });
});

describe("histogramAggregation", () => {
  async function recordAndExport(config?: OtelTsConfig): Promise<void> {
    const meter = start(config).getMeter("test");

    meter.createHistogram("test.duration", { unit: "ms" }).record(12);
    meter
      .createHistogram("test.advised", {
        unit: "ms",
        advice: { explicitBucketBoundaries: [10, 100] },
      })
      .record(12);
    meter.createCounter("test.count").add(3);

    await otel!.forceFlush();
  }

  it("exports explicit-bucket histograms by default", async () => {
    await recordAndExport();

    expect(lastExported("test.duration").dataPointType).toBe(
      DataPointType.HISTOGRAM,
    );
    // The instrument's advice still sets its boundaries
    const advised = lastExported("test.advised");
    expect(advised.dataPointType).toBe(DataPointType.HISTOGRAM);
    expect(advised.dataPoints[0]!.value).toMatchObject({
      buckets: { boundaries: [10, 100], counts: [0, 1, 0] },
    });
    expect(exporter.created.mock.calls[0]![0]).not.toHaveProperty(
      "aggregationPreference",
    );
  });

  it("exports base-2 exponential histograms when set to exponential", async () => {
    await recordAndExport({ histogramAggregation: "exponential" });

    for (const name of ["test.duration", "test.advised"]) {
      const histogram = lastExported(name);
      expect(histogram.dataPointType).toBe(DataPointType.EXPONENTIAL_HISTOGRAM);
      expect(histogram.aggregationTemporality).toBe(
        AggregationTemporality.CUMULATIVE,
      );

      const point = histogram.dataPoints[0]!.value as ExponentialHistogram;
      expect(point).toMatchObject({ count: 1, sum: 12, min: 12, max: 12 });
      expect(point.scale).toEqual(expect.any(Number));
      expect(point.positive.bucketCounts.reduce((a, b) => a + b, 0)).toBe(1);
    }
  });

  it("leaves other instruments alone when set to exponential", async () => {
    await recordAndExport({ histogramAggregation: "exponential" });

    const counter = lastExported("test.count");
    expect(counter.dataPointType).toBe(DataPointType.SUM);
    expect(counter.dataPoints[0]!.value).toBe(3);
  });

  it("keeps the requested temporality with exponential histograms", async () => {
    await recordAndExport({
      histogramAggregation: "exponential",
      metricsTemporality: "delta",
    });

    const histogram = lastExported("test.duration");
    expect(histogram.dataPointType).toBe(DataPointType.EXPONENTIAL_HISTOGRAM);
    expect(histogram.aggregationTemporality).toBe(AggregationTemporality.DELTA);
  });
});

describe("metricsExportIntervalMs", () => {
  async function exportsAfter(ms: number, config?: OtelTsConfig) {
    vi.useFakeTimers();
    start(config).getMeter("test").createCounter("test.count").add(1);

    await vi.advanceTimersByTimeAsync(ms - 1);
    const before = exported.length;
    await vi.advanceTimersByTimeAsync(1);

    return { before, after: exported.length };
  }

  it("exports every 15 seconds by default", async () => {
    expect(await exportsAfter(15_000)).toEqual({ before: 0, after: 1 });
  });

  it("exports at the configured interval", async () => {
    expect(
      await exportsAfter(5_000, { metricsExportIntervalMs: 5_000 }),
    ).toEqual({ before: 0, after: 1 });
  });
});

import type { Resource } from "@opentelemetry/resources";
import {
  AggregationType,
  InstrumentType,
  MeterProvider,
  PeriodicExportingMetricReader,
  type AggregationSelector,
} from "@opentelemetry/sdk-metrics";
import {
  AggregationTemporalityPreference,
  OTLPMetricExporter,
  type OTLPMetricExporterOptions,
} from "@opentelemetry/exporter-metrics-otlp-http";
import type { MetricsTemporality, ResolvedConfig } from "./types.js";

const TEMPORALITY_PREFERENCES: Record<
  MetricsTemporality,
  AggregationTemporalityPreference
> = {
  cumulative: AggregationTemporalityPreference.CUMULATIVE,
  delta: AggregationTemporalityPreference.DELTA,
};

/**
 * Base-2 exponential histograms for histogram instruments; every other
 * instrument keeps its default aggregation. Used as the exporter's
 * aggregation preference — the SDK's equivalent of
 * OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION=base2_exponential_bucket_histogram —
 * rather than a View, so it stays the default that any View can override,
 * and there are no overlapping Views producing duplicate streams.
 */
const selectExponentialHistograms: AggregationSelector = (
  instrumentType,
) =>
  instrumentType === InstrumentType.HISTOGRAM
    ? { type: AggregationType.EXPONENTIAL_HISTOGRAM }
    : { type: AggregationType.DEFAULT };

export function setupMetrics(
  resource: Resource,
  config: ResolvedConfig,
): MeterProvider {
  const options: OTLPMetricExporterOptions = {
    url: `${config.endpoint}/v1/metrics`,
    temporalityPreference: TEMPORALITY_PREFERENCES[config.metricsTemporality],
  };

  if (config.histogramAggregation === "exponential") {
    options.aggregationPreference = selectExponentialHistograms;
  }

  const exporter = new OTLPMetricExporter(options);

  return new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: config.metricsExportIntervalMs,
      }),
    ],
  });
}

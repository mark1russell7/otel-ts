import type { Resource } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  AggregationTemporalityPreference,
  OTLPMetricExporter,
} from "@opentelemetry/exporter-metrics-otlp-http";
import type { MetricsTemporality, ResolvedConfig } from "./types.js";

const TEMPORALITY_PREFERENCES: Record<
  MetricsTemporality,
  AggregationTemporalityPreference
> = {
  cumulative: AggregationTemporalityPreference.CUMULATIVE,
  delta: AggregationTemporalityPreference.DELTA,
};

export function setupMetrics(
  resource: Resource,
  config: ResolvedConfig,
): MeterProvider {
  const exporter = new OTLPMetricExporter({
    url: `${config.endpoint}/v1/metrics`,
    temporalityPreference: TEMPORALITY_PREFERENCES[config.metricsTemporality],
  });

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

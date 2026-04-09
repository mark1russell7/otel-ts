import type { Resource } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import type { ResolvedConfig } from "./types.js";

export function setupMetrics(
  resource: Resource,
  config: ResolvedConfig,
): MeterProvider {
  const exporter = new OTLPMetricExporter({
    url: `${config.endpoint}/v1/metrics`,
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

/**
 * The metric readers of a service that starts the context with `startNodeContext()` (docs/CONTEXT-DESIGN.md,
 * section 4). Only the entry `/node/export` loads this module. The NodeSDK of the entry `/node` takes the readers
 * of the program, so the entry `/node` does not load the metric exporters.
 */
import { OTLPMetricExporter as JsonMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPMetricExporter as ProtobufMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { ConsoleMetricExporter, PeriodicExportingMetricReader, type MetricReader, type PushMetricExporter } from "@opentelemetry/sdk-metrics";
import { exporterNames, otlpProtocol, type ExporterName, type OtlpProtocol } from "./node-exporters.js";

type Env = Readonly<Record<string, string | undefined>>;

/** The settings of the metric readers, from the variables */
export interface MetricReaderSettings {
  /** The exporters of `OTEL_METRICS_EXPORTER` */
  readonly names: readonly ExporterName[];
  /** The protocol of `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL`, else of `OTEL_EXPORTER_OTLP_PROTOCOL` */
  readonly protocol: OtlpProtocol;
  /** The time between two exports, from `OTEL_METRIC_EXPORT_INTERVAL`. Default: 60000 ms. */
  readonly intervalMs: number;
  /** The time limit of one export, from `OTEL_METRIC_EXPORT_TIMEOUT`. Default: 30000 ms, and never more than the interval. */
  readonly timeoutMs: number;
}

/** A variable of milliseconds: a whole number over 0. An empty variable is not set. Another value is an error. */
function millis(env: Env, variable: string, fallback: number): number {
  const raw = env[variable]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${variable} has "${raw}": otel-ts takes a whole number of milliseconds over 0`);
  return value;
}

/** Read and check the settings of the metric readers. Each bad value is an error here, before a reader exists. */
export function metricReaderSettings(env: Env): MetricReaderSettings {
  const intervalMs = millis(env, "OTEL_METRIC_EXPORT_INTERVAL", 60_000);
  return {
    names: exporterNames("metrics", env),
    protocol: otlpProtocol("metrics", env),
    intervalMs,
    // The reader refuses a time limit over the interval
    timeoutMs: Math.min(millis(env, "OTEL_METRIC_EXPORT_TIMEOUT", 30_000), intervalMs),
  };
}

/**
 * The metric readers: one periodic reader for `exporter`, or for each exporter of the settings. An OTLP exporter
 * reads its endpoint, headers, timeout and temporality from `process.env`. Each call makes new readers, because a
 * reader belongs to one meter provider.
 */
export function nodeMetricReaders(settings: MetricReaderSettings, exporter?: PushMetricExporter): MetricReader[] {
  const exporters: PushMetricExporter[] = exporter
    ? [exporter]
    : settings.names.map((name) =>
        name === "console" ? new ConsoleMetricExporter() : settings.protocol === "http/json" ? new JsonMetricExporter() : new ProtobufMetricExporter(),
      );
  return exporters.map(
    (each) => new PeriodicExportingMetricReader({ exporter: each, exportIntervalMillis: settings.intervalMs, exportTimeoutMillis: settings.timeoutMs }),
  );
}

/**
 * The entry `@mark1russell7/otel-ts/node/export`: the span processors and the meter provider that export the spans
 * and the metrics of a program that starts the context with `startNodeContext()` of the entry `/node/context`, with
 * no SDK of `@opentelemetry/sdk-node`.
 *
 * The processors are those of the entry `/node`: the context processor, then one processor for each exporter of
 * `OTEL_TRACES_EXPORTER`, with the protocol of `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` or `OTEL_EXPORTER_OTLP_PROTOCOL`.
 * This entry loads the exporters. Thus a program that exports only with an endpoint imports it with `import()`
 * when `OTEL_EXPORTER_OTLP_ENDPOINT` has a value:
 *
 * ```ts no-run
 * import { startNodeContext } from "@mark1russell7/otel-ts/node/context";
 *
 * const exporting = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ? await import("@mark1russell7/otel-ts/node/export") : undefined;
 * const meterProvider = exporting?.exportMeterProvider();
 * const telemetry = startNodeContext({
 *   serviceName: "my-tool",
 *   spanProcessors: exporting?.exportSpanProcessors() ?? [],
 *   ...(meterProvider ? { meterProvider } : {}),
 * });
 * // The work of the program, then:
 * await telemetry.shutdown();
 * ```
 *
 * @packageDocumentation
 */
import { MeterProvider, type PushMetricExporter } from "@opentelemetry/sdk-metrics";
import type { SpanExporter, SpanProcessor } from "@opentelemetry/sdk-trace";
import { contextMetricViews } from "./context-processors.js";
import { histogramAggregation, nodeSpanProcessors } from "./node-exporters.js";
import { metricReaderSettings, nodeMetricReaders } from "./node-metric-exporters.js";
import type { NodeMeterProviderFactory } from "./node-meter.js";

/** The options of `exportSpanProcessors()` */
export interface ExportSpanOptions {
  /**
   * The environment of `OTEL_EXPORTER_OTLP_ENDPOINT`, of the exporter names and of the protocols. Default:
   * `process.env`. An OTLP exporter reads its endpoint, headers and timeout from `process.env`, not from this object.
   */
  env?: NodeJS.ProcessEnv;
  /** The trace exporter. With it, the processors export to it, also with no endpoint. Default: the exporters of the variables. */
  exporter?: SpanExporter;
}

/**
 * The span processors that export the spans, for the option `spanProcessors` of `startNodeContext()`. With no
 * value in `OTEL_EXPORTER_OTLP_ENDPOINT` and no `exporter`, it gives no processor, as the entry `/node` exports
 * nothing then. `OTEL_TRACES_EXPORTER=none` also gives no processor. The `shutdown()` of the context flushes them.
 */
export function exportSpanProcessors(options: ExportSpanOptions = {}): SpanProcessor[] {
  const env = options.env ?? process.env;
  if (options.exporter === undefined && !env["OTEL_EXPORTER_OTLP_ENDPOINT"]) return [];
  return nodeSpanProcessors(env, options.exporter);
}

/** The options of `exportMeterProvider()` */
export interface ExportMetricOptions {
  /**
   * The environment of `OTEL_EXPORTER_OTLP_ENDPOINT`, of the exporter names, of the protocols, of the export interval
   * and of the histogram aggregation. Default: `process.env`. An OTLP exporter reads its endpoint, headers, timeout
   * and temporality from `process.env`, not from this object.
   */
  env?: NodeJS.ProcessEnv;
  /** The metric exporter. With it, the meter provider exports to it, also with no endpoint. Default: the exporters of the variables. */
  exporter?: PushMetricExporter;
}

/**
 * The meter provider that exports the metrics, for the option `meterProvider` of `startNodeContext()`. It has the
 * resource of the spans, the views of the entry `/node` (no attribute of a context key with `cardinality: "high"`,
 * and the histograms of `OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION`), and one periodic reader for each
 * exporter of `OTEL_METRICS_EXPORTER`. A reader exports each `OTEL_METRIC_EXPORT_INTERVAL` ms (default 60000).
 *
 * With no value in `OTEL_EXPORTER_OTLP_ENDPOINT` and no `exporter`, it gives `undefined`, and the meters of the API
 * record nothing. `OTEL_METRICS_EXPORTER=none` also gives `undefined`. A bad variable is an error here. The
 * `shutdown()` of the context exports the last values.
 */
export function exportMeterProvider(options: ExportMetricOptions = {}): NodeMeterProviderFactory | undefined {
  const env = options.env ?? process.env;
  if (options.exporter === undefined && !env["OTEL_EXPORTER_OTLP_ENDPOINT"]) return undefined;
  const settings = metricReaderSettings(env);
  if (options.exporter === undefined && settings.names.length === 0) return undefined;
  const aggregation = histogramAggregation(env);
  return (resource) => new MeterProvider({ resource, readers: nodeMetricReaders(settings, options.exporter), views: contextMetricViews(aggregation) });
}

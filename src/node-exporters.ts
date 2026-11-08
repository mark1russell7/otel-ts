/**
 * The span and log processors of a Node service (docs/CONTEXT-DESIGN.md, section 4).
 *
 * The NodeSDK makes its processors from the `OTEL_*` variables, but it has no
 * public way to add a processor to them. So otel-ts makes them: the context
 * processor of C3 first, then one processor for each exporter that the
 * variables name. The sampler and the metric readers stay those of the SDK.
 */
import { OTLPLogExporter as JsonLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPLogExporter as ProtobufLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter as JsonTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as ProtobufTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  SimpleLogRecordProcessor,
  type LogRecordExporter,
  type LogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { AggregationType, InstrumentType, type AggregationSelector } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor, type SpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createContextLogRecordProcessor, createContextSpanProcessor, defaultAggregation } from "./context-processors.js";

type Env = Readonly<Record<string, string | undefined>>;

/** A signal that has processors */
export type OtlpSignal = "traces" | "logs";
/** An exporter name of `OTEL_TRACES_EXPORTER` and `OTEL_LOGS_EXPORTER` that otel-ts makes */
export type ExporterName = "otlp" | "console";
/** An OTLP protocol that otel-ts sends */
export type OtlpProtocol = "http/protobuf" | "http/json";

/**
 * The exporters of `OTEL_<SIGNAL>_EXPORTER`, a list with commas. Default:
 * `otlp`. With `none` in the list: no exporter. Another name is an error.
 */
export function exporterNames(signal: OtlpSignal, env: Env): ExporterName[] {
  const variable = `OTEL_${signal.toUpperCase()}_EXPORTER`;
  const names = [...new Set((env[variable] ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean))];
  if (names.length === 0) return ["otlp"];
  if (names.includes("none")) return [];
  for (const name of names) {
    if (name !== "otlp" && name !== "console") throw new RangeError(`${variable} has "${name}": otel-ts makes "otlp", "console" or "none"`);
  }
  return names as ExporterName[];
}

/**
 * The protocol of `OTEL_EXPORTER_OTLP_<SIGNAL>_PROTOCOL`, else of
 * `OTEL_EXPORTER_OTLP_PROTOCOL`. Default: `http/protobuf`, as the SDK.
 */
export function otlpProtocol(signal: OtlpSignal, env: Env): OtlpProtocol {
  const variable = `OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_PROTOCOL`;
  const value = (env[variable] ?? env["OTEL_EXPORTER_OTLP_PROTOCOL"] ?? "http/protobuf").trim();
  if (value === "http/protobuf" || value === "http/json") return value;
  throw new RangeError(`the OTLP protocol of ${signal} is "${value}": otel-ts sends "http/protobuf" or "http/json". For grpc, give the exporter in the options.`);
}

/**
 * The aggregation of `OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION`:
 * `explicit_bucket_histogram` (default) or `base2_exponential_bucket_histogram`.
 * Another value is an error.
 */
export function histogramAggregation(env: Env): AggregationSelector {
  const variable = "OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION";
  const value = (env[variable] ?? "").trim().toLowerCase();
  if (value === "" || value === "explicit_bucket_histogram") return defaultAggregation;
  if (value === "base2_exponential_bucket_histogram") {
    return (type) => (type === InstrumentType.HISTOGRAM ? { type: AggregationType.EXPONENTIAL_HISTOGRAM } : { type: AggregationType.DEFAULT });
  }
  throw new RangeError(`${variable} has "${value}": otel-ts makes "explicit_bucket_histogram" or "base2_exponential_bucket_histogram"`);
}

/**
 * The span processors: the context processor, then a processor for `exporter`,
 * or for each exporter of the variables. No exporter gives no processor.
 * An OTLP exporter reads its endpoint, headers and timeout from `process.env`.
 */
export function nodeSpanProcessors(env: Env, exporter?: SpanExporter): SpanProcessor[] {
  const exporting: SpanProcessor[] = exporter
    ? [new BatchSpanProcessor(exporter)]
    : exporterNames("traces", env).map((name) =>
        name === "console"
          ? new SimpleSpanProcessor(new ConsoleSpanExporter())
          : new BatchSpanProcessor(otlpProtocol("traces", env) === "http/json" ? new JsonTraceExporter() : new ProtobufTraceExporter()),
      );
  return exporting.length > 0 ? [createContextSpanProcessor(), ...exporting] : [];
}

/**
 * The log record processors: the context processor, then a processor for
 * `exporter`, or for each exporter of the variables. No exporter gives no processor.
 * An OTLP exporter reads its endpoint, headers and timeout from `process.env`.
 */
export function nodeLogRecordProcessors(env: Env, exporter?: LogRecordExporter): LogRecordProcessor[] {
  const exporting: LogRecordProcessor[] = exporter
    ? [new BatchLogRecordProcessor({ exporter })]
    : exporterNames("logs", env).map((name) =>
        name === "console"
          ? new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() })
          : new BatchLogRecordProcessor({ exporter: otlpProtocol("logs", env) === "http/json" ? new JsonLogExporter() : new ProtobufLogExporter() }),
      );
  return exporting.length > 0 ? [createContextLogRecordProcessor(), ...exporting] : [];
}

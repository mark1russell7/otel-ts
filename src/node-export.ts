/**
 * The entry `@mark1russell7/otel-ts/node/export`: the span processors that export the spans of a program that
 * starts the context with `startNodeContext()` of the entry `/node/context`, with no SDK of `@opentelemetry/sdk-node`.
 *
 * The processors are those of the entry `/node`: the context processor, then one processor for each exporter of
 * `OTEL_TRACES_EXPORTER`, with the protocol of `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` or `OTEL_EXPORTER_OTLP_PROTOCOL`.
 * This entry loads the exporters. Thus a program that exports only with an endpoint imports it with `import()`
 * when `OTEL_EXPORTER_OTLP_ENDPOINT` has a value:
 *
 * ```ts no-run
 * import { startNodeContext } from "@mark1russell7/otel-ts/node/context";
 *
 * const spanProcessors = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
 *   ? (await import("@mark1russell7/otel-ts/node/export")).exportSpanProcessors()
 *   : [];
 * const telemetry = startNodeContext({ serviceName: "my-tool", spanProcessors });
 * // The work of the program, then:
 * await telemetry.shutdown();
 * ```
 *
 * @packageDocumentation
 */
import type { SpanExporter, SpanProcessor } from "@opentelemetry/sdk-trace";
import { nodeSpanProcessors } from "./node-exporters.js";

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

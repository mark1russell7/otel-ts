/**
 * The entry `@mark1russell7/otel-ts/incoming-span`: the span of the server for an incoming call, in the trace of
 * its caller (docs/CONTEXT-DESIGN.md, section 5).
 *
 * This entry depends on `@opentelemetry/api` only. It is not in `/context`, because `/node/context` loads `/context`
 * in each service. Thus only a program that imports this entry pays for its code.
 *
 * @packageDocumentation
 */
import { SpanKind, trace, type Attributes, type Tracer } from "@opentelemetry/api";
import { incomingContext, type IncomingContextOptions, type IncomingHeaders } from "./context.js";
import { runInSpan } from "./span-run.js";

/** The options of `runInIncomingSpan` */
export interface IncomingSpanOptions extends IncomingContextOptions {
  /** The attributes of the span at its start, for example `http.request.method` and `url.path`. */
  readonly attributes?: Attributes;
  /** The tracer of the span, for example `trace.getTracer("my-service")`. Default: the global tracer `@mark1russell7/otel-ts`. */
  readonly tracer?: Tracer;
}

/**
 * This function runs the handler of an incoming call in a span of the server. The span is of the kind SERVER, and its
 * parent is the context of `incomingContext(headers, options)`. Thus with the default trust "trace", the span continues
 * the trace of the `traceparent` header of the caller, and it takes no baggage. With no valid `traceparent`, the span
 * starts a new trace. It is for a route that no instrumentation of the framework covers, for example a raw route of
 * `node:http` or a handler of a Fetch `Request`.
 *
 * The span ends when `fn` returns, or when the promise of `fn` settles. An error of `fn` sets the status of the span to
 * ERROR, and passes through.
 *
 * @example
 * ```ts
 * const answer = await runInIncomingSpan(`POST ${path}`, req.headers, () => handle(body), {
 *   tracer: trace.getTracer("my-service"),
 *   attributes: { "http.request.method": "POST", "url.path": path },
 * });
 * ```
 */
export function runInIncomingSpan<T>(name: string, headers: IncomingHeaders, fn: () => T, options: IncomingSpanOptions = {}): T {
  const parent = incomingContext(headers, options.trust === undefined ? {} : { trust: options.trust });
  const tracer = options.tracer ?? trace.getTracer("@mark1russell7/otel-ts");
  const span = tracer.startSpan(name, { kind: SpanKind.SERVER, ...(options.attributes ? { attributes: options.attributes } : {}) }, parent);
  return runInSpan(span, parent, fn);
}

export type { IncomingContextOptions, IncomingHeaders, IncomingTrust } from "./context.js";

/**
 * The trace of a write, carried to its echo. A write ends its request, and a
 * change stream (or another queue) reports the change later, without the
 * context of the request. The write handler keeps the trace context of the
 * write for some seconds, keyed by what the echo can name (for example the
 * collection and the id). The handler of the echo takes it, and the clients
 * then apply the echo in the trace of the write.
 *
 * @packageDocumentation
 */
import {
  context,
  defaultTextMapGetter,
  isSpanContextValid,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Tracer,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

/** The W3C propagator of this module: it reads the traceparent also when no global propagator is set. */
const W3C = new W3CTraceContextPropagator();

/**
 * The remote parent of a W3C `traceparent`, or undefined when the value is not a valid traceparent. The check is
 * `isSpanContextValid` of `@opentelemetry/api`: a trace id or a span id of only zeros is not valid.
 */
function remoteParent(traceparent: unknown): Context | undefined {
  if (typeof traceparent !== "string") return undefined;
  const parent = W3C.extract(ROOT_CONTEXT, { traceparent }, defaultTextMapGetter);
  const spanContext = trace.getSpanContext(parent);
  return spanContext && isSpanContextValid(spanContext) ? parent : undefined;
}

/**
 * The W3C trace context to pass on: the context of the active span when the
 * SDK operates, else the `traceparent` header of the request. The header comes
 * back in the W3C form of version `00`.
 */
export function outgoingTraceparent(header: unknown): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const parent = remoteParent(carrier["traceparent"]) ?? remoteParent(header);
  const spanContext = parent && trace.getSpanContext(parent);
  if (!spanContext) return undefined;
  // Not W3C.inject: in core 2.12 it writes the flags 0x10 to 0xff with three digits ("0ff").
  const flags = (spanContext.traceFlags & 0xff).toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/** A store of the trace contexts of the writes, until their echoes arrive */
export interface TraceEcho {
  /** Keep the trace of a write to (`scope`, `id`). It ignores an empty trace. */
  remember(scope: string, id: unknown, traceparent: string | undefined, now?: number): void;
  /** The trace of the write that caused this echo, one time. Undefined when none or expired. */
  take(scope: string, id: unknown, now?: number): string | undefined;
  /** The count of the kept traces */
  readonly size: number;
}

/** A trace-echo store: each trace lives `ttlMs` (default 10 s), `maxEntries` at most (default 10,000). */
export function createTraceEcho(options: { ttlMs?: number; maxEntries?: number } = {}): TraceEcho {
  const ttl = options.ttlMs ?? 10_000;
  const max = options.maxEntries ?? 10_000;
  const pending = new Map<string, { traceparent: string; at: number }>();
  const keyOf = (scope: string, id: unknown): string => `${scope}\u0000${String(id)}`;
  /** Drop the expired entries, and when the store is full, the oldest half */
  const sweep = (now: number): void => {
    for (const [k, v] of pending) if (now - v.at > ttl) pending.delete(k);
    if (pending.size >= max) {
      let drop = Math.floor(pending.size / 2);
      for (const k of pending.keys()) {
        if (drop-- <= 0) break;
        pending.delete(k);
      }
    }
  };
  return {
    remember(scope, id, traceparent, now = Date.now()) {
      if (!traceparent) return;
      if (pending.size >= max) sweep(now);
      pending.set(keyOf(scope, id), { traceparent, at: now });
    },
    take(scope, id, now = Date.now()) {
      const key = keyOf(scope, id);
      const hit = pending.get(key);
      if (!hit) return undefined;
      pending.delete(key);
      return now - hit.at <= ttl ? hit.traceparent : undefined;
    },
    get size() {
      return pending.size;
    },
  };
}

/** The options of `runInRemoteTrace` */
export interface RemoteTraceOptions {
  /** The name of the span. Default: `remote.apply`. */
  name?: string;
  /** The attributes of the span, for example the collection and the kind of the change. */
  attributes?: Attributes;
  /** The tracer of the span. Default: the global tracer `@mark1russell7/otel-ts`. */
  tracer?: Tracer;
}

/**
 * The other end of the trace echo: run `fn` inside the trace that a message
 * carries. A message (for example a change on a live connection) can carry the
 * `traceparent` of the write that caused it. This function starts a consumer
 * span whose parent is that trace, and runs `fn` with the span active. Thus one
 * trace shows the action, the write, the server and each client that applies
 * the change. Without a valid `traceparent`, it only runs `fn`.
 *
 * The span ends when `fn` returns, or when the promise of `fn` settles. An
 * error of `fn` sets the status of the span to ERROR, and passes through.
 *
 * @example
 * ```ts
 * socket.onChange((msg) => runInRemoteTrace(msg.traceparent, () => store.apply(msg), {
 *   name: "realtime.echo",
 *   attributes: { "app.collection": msg.collection },
 * }));
 * ```
 */
export function runInRemoteTrace<T>(traceparent: string | undefined, fn: () => T, options: RemoteTraceOptions = {}): T {
  const parent = remoteParent(traceparent);
  if (!parent) return fn();
  const tracer = options.tracer ?? trace.getTracer("@mark1russell7/otel-ts");
  const span = tracer.startSpan(options.name ?? "remote.apply", { kind: SpanKind.CONSUMER, ...(options.attributes ? { attributes: options.attributes } : {}) }, parent);
  const fail = (error: unknown): void => {
    span.recordException(error instanceof Error ? error : String(error));
    span.setStatus({ code: SpanStatusCode.ERROR });
  };
  let result: T;
  try {
    result = context.with(trace.setSpan(parent, span), fn);
  } catch (error) {
    fail(error);
    span.end();
    throw error;
  }
  if (result && typeof (result as { then?: unknown }).then === "function") {
    return (result as unknown as Promise<unknown>).then(
      (value) => {
        span.end();
        return value;
      },
      (error: unknown) => {
        fail(error);
        span.end();
        throw error;
      },
    ) as T;
  }
  span.end();
  return result;
}

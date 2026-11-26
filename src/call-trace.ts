/**
 * The trace context of one outgoing call, also on a page with no SDK.
 *
 * A page with no SDK has no active span. So a call of the page sends no `traceparent`, and the record of a failed call
 * has no trace id. `callTrace()` gives the call a trace context: the active span when the SDK operates, else new
 * random ids in a span that does not record. The caller sends `headers` with the request, so the server joins the same
 * trace. On a failure, the caller gives `context` to `errorRecord()` or `reportError()` of `@mark1russell7/otel-ts/error`.
 * The record then has the trace id that the server got.
 *
 * A context manager is not necessary: the caller passes `context` explicitly. This module depends on
 * `@opentelemetry/api` only.
 *
 * @packageDocumentation
 */
import { context as api, isSpanContextValid, trace, TraceFlags, type Context, type SpanContext } from "@opentelemetry/api";

/** The trace context of one outgoing call */
export interface CallTrace {
  /** The context of the call: give it as `from` to `errorRecord()` or `reportError()`. */
  readonly context: Context;
  /** The trace id, 32 hex digits */
  readonly traceId: string;
  /** The span id that the server gets as its parent, 16 hex digits */
  readonly spanId: string;
  /** True when the trace is sampled. A server with a parent-based sampler then records its span. */
  readonly sampled: boolean;
  /** The W3C `traceparent` of the call, in the form of version `00` */
  readonly traceparent: string;
  /** The headers to add to the request: only `traceparent`. The call sends no baggage. */
  readonly headers: Readonly<{ traceparent: string }>;
}

/** The options of `callTrace()` */
export interface CallTraceOptions {
  /** The context of the call. Default: the active context. A valid span in it gives the trace of the call. */
  readonly from?: Context;
  /**
   * The sampled flag of a new trace. Default: true, so that the server records the trace of a call that fails. It
   * has no effect when `from` has a valid span: the call then keeps the flags of that span.
   */
  readonly sampled?: boolean;
}

/** `length` random bytes as hex, from the Web Crypto API of the platform, else from `Math.random` */
function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  // An id of only zeros is not valid (W3C trace context). The chance is 2^-64 or less, but the id must stay valid.
  if (bytes.every((byte) => byte === 0)) bytes[length - 1] = 1;
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The trace of a call in `context`, with the ids of `span` */
function traceOf(context: Context, span: SpanContext): CallTrace {
  const flags = (span.traceFlags & 0xff).toString(16).padStart(2, "0");
  const traceparent = `00-${span.traceId}-${span.spanId}-${flags}`;
  return {
    context,
    traceId: span.traceId,
    spanId: span.spanId,
    sampled: (span.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED,
    traceparent,
    headers: { traceparent },
  };
}

/**
 * The trace context of one outgoing call. With a valid span in `from` (the SDK operates), the call is in the trace of
 * that span. Else the call starts a new trace with random ids, in a span that does not record. The context keys and
 * the baggage of `from` stay in `context`.
 *
 * ```ts
 * const call = callTrace();
 * const response = await fetch("/map", { headers: call.headers });
 * if (!response.ok) reportError(new Error(`HTTP ${response.status}`), { from: call.context });
 * ```
 */
export function callTrace(options: CallTraceOptions = {}): CallTrace {
  const from = options.from ?? api.active();
  const active = trace.getSpanContext(from);
  if (active !== undefined && isSpanContextValid(active)) return traceOf(from, active);
  const span: SpanContext = {
    traceId: randomHex(16),
    spanId: randomHex(8),
    traceFlags: (options.sampled ?? true) ? TraceFlags.SAMPLED : TraceFlags.NONE,
  };
  return traceOf(trace.setSpanContext(from, span), span);
}

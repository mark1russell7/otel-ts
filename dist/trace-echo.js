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
import { context, defaultTextMapGetter, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
/** The W3C propagator of runInRemoteTrace: it reads the traceparent also when no global propagator is set. */
const W3C = new W3CTraceContextPropagator();
const TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
/**
 * The W3C trace context to pass on: the context of the active span when the
 * SDK operates, else the `traceparent` header of the request.
 */
export function outgoingTraceparent(header) {
    const carrier = {};
    propagation.inject(context.active(), carrier);
    const value = carrier["traceparent"] ?? (typeof header === "string" ? header : undefined);
    return value && TRACEPARENT.test(value) ? value : undefined;
}
/** A trace-echo store: each trace lives `ttlMs` (default 10 s), `maxEntries` at most (default 10,000). */
export function createTraceEcho(options = {}) {
    const ttl = options.ttlMs ?? 10_000;
    const max = options.maxEntries ?? 10_000;
    const pending = new Map();
    const keyOf = (scope, id) => `${scope}\u0000${String(id)}`;
    /** Drop the expired entries, and when the store is full, the oldest half */
    const sweep = (now) => {
        for (const [k, v] of pending)
            if (now - v.at > ttl)
                pending.delete(k);
        if (pending.size >= max) {
            let drop = Math.floor(pending.size / 2);
            for (const k of pending.keys()) {
                if (drop-- <= 0)
                    break;
                pending.delete(k);
            }
        }
    };
    return {
        remember(scope, id, traceparent, now = Date.now()) {
            if (!traceparent)
                return;
            if (pending.size >= max)
                sweep(now);
            pending.set(keyOf(scope, id), { traceparent, at: now });
        },
        take(scope, id, now = Date.now()) {
            const key = keyOf(scope, id);
            const hit = pending.get(key);
            if (!hit)
                return undefined;
            pending.delete(key);
            return now - hit.at <= ttl ? hit.traceparent : undefined;
        },
        get size() {
            return pending.size;
        },
    };
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
export function runInRemoteTrace(traceparent, fn, options = {}) {
    if (!traceparent || !TRACEPARENT.test(traceparent))
        return fn();
    const parent = W3C.extract(ROOT_CONTEXT, { traceparent }, defaultTextMapGetter);
    const tracer = options.tracer ?? trace.getTracer("@mark1russell7/otel-ts");
    const span = tracer.startSpan(options.name ?? "remote.apply", { kind: SpanKind.CONSUMER, ...(options.attributes ? { attributes: options.attributes } : {}) }, parent);
    const fail = (error) => {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
    };
    let result;
    try {
        result = context.with(trace.setSpan(parent, span), fn);
    }
    catch (error) {
        fail(error);
        span.end();
        throw error;
    }
    if (result && typeof result.then === "function") {
        return result.then((value) => {
            span.end();
            return value;
        }, (error) => {
            fail(error);
            span.end();
            throw error;
        });
    }
    span.end();
    return result;
}
//# sourceMappingURL=trace-echo.js.map
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
import { type Attributes, type Tracer } from "@opentelemetry/api";
/**
 * The W3C trace context to pass on: the context of the active span when the
 * SDK operates, else the `traceparent` header of the request.
 */
export declare function outgoingTraceparent(header: unknown): string | undefined;
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
export declare function createTraceEcho(options?: {
    ttlMs?: number;
    maxEntries?: number;
}): TraceEcho;
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
export declare function runInRemoteTrace<T>(traceparent: string | undefined, fn: () => T, options?: RemoteTraceOptions): T;
//# sourceMappingURL=trace-echo.d.ts.map
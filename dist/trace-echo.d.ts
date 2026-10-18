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
//# sourceMappingURL=trace-echo.d.ts.map
/** A stand-in OTLP/HTTP collector */
export interface StubCollector {
    /** The endpoint for `OTEL_EXPORTER_OTLP_ENDPOINT`, for example http://127.0.0.1:43211 */
    readonly endpoint: string;
    /** The count of the trace exports that arrived */
    readonly exports: number;
    /** The span names of each instrumentation scope, for example "@opentelemetry/instrumentation-http" */
    spansByScope(): Map<string, Set<string>>;
    /** True when each of these scopes has one span or more */
    has(scopes: readonly string[]): boolean;
    /** The scopes of a list that have no span */
    missing(scopes: readonly string[]): string[];
    /** Wait until each scope has spans, `timeoutMs` at most (default 20 s). It gives the scopes that are still missing. */
    waitFor(scopes: readonly string[], options?: {
        timeoutMs?: number;
        intervalMs?: number;
        poke?: () => Promise<unknown>;
    }): Promise<string[]>;
    close(): Promise<void>;
}
/** Start a stand-in OTLP/HTTP collector on a free port of 127.0.0.1 */
export declare function startStubCollector(): Promise<StubCollector>;
//# sourceMappingURL=node-testing.d.ts.map
export interface OtelTsConfig {
    /** OTLP HTTP endpoint. Default: "http://localhost:4318" */
    endpoint?: string;
    /** Service name for resource identification. Default: "frontend-app" */
    serviceName?: string;
    /** Service version. Default: "0.0.0" */
    serviceVersion?: string;
    /** Additional resource attributes */
    resourceAttributes?: Record<string, string>;
    /** Enable tracing. Default: true */
    tracing?: boolean;
    /** Propagate trace context to these origins. Default: all origins */
    propagateTraceHeaderCorsUrls?: Array<string | RegExp>;
    /** Enable metrics. Default: true */
    metrics?: boolean;
    /** Metrics export interval in ms. Default: 60000 */
    metricsExportIntervalMs?: number;
    /** Enable logs. Default: true */
    logs?: boolean;
    /** Enable document-load instrumentation. Default: true */
    instrumentDocumentLoad?: boolean;
    /** Enable fetch instrumentation. Default: true */
    instrumentFetch?: boolean;
    /** Enable XMLHttpRequest instrumentation. Default: true */
    instrumentXhr?: boolean;
    /** Enable user-interaction instrumentation. Default: true */
    instrumentUserInteraction?: boolean;
    /** Enable long-task instrumentation. Default: true */
    instrumentLongTask?: boolean;
    /** Enable Grafana Faro integration. Default: true */
    faro?: boolean;
    /** Faro collector URL. Omit for local OTLP-only mode. */
    faroCollectorUrl?: string;
    /** Faro app name. Defaults to serviceName. */
    faroAppName?: string;
    /** Enable session tracking. Default: true */
    sessionTracking?: boolean;
    /** Enable console debug output. Default: false */
    debug?: boolean;
}
export interface ResolvedConfig {
    endpoint: string;
    serviceName: string;
    serviceVersion: string;
    resourceAttributes: Record<string, string>;
    tracing: boolean;
    propagateTraceHeaderCorsUrls: Array<string | RegExp>;
    metrics: boolean;
    metricsExportIntervalMs: number;
    logs: boolean;
    instrumentDocumentLoad: boolean;
    instrumentFetch: boolean;
    instrumentXhr: boolean;
    instrumentUserInteraction: boolean;
    instrumentLongTask: boolean;
    faro: boolean;
    faroCollectorUrl: string | undefined;
    faroAppName: string | undefined;
    sessionTracking: boolean;
    debug: boolean;
}
export interface OtelTsInstance {
    /** Shut down all providers, flush pending telemetry */
    shutdown(): Promise<void>;
    /** Get the current session ID */
    getSessionId(): string;
    /** Get a named Meter for creating instruments (histograms, gauges, counters) */
    getMeter(name: string): import("@opentelemetry/api").Meter;
    /** Get a named Logger for emitting log records */
    getLogger(name: string): import("@opentelemetry/api-logs").Logger;
}
//# sourceMappingURL=types.d.ts.map
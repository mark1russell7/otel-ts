export type MetricsTemporality = "cumulative" | "delta";
/** How histogram instruments aggregate their measurements */
export type HistogramAggregation = "explicit" | "exponential";
export interface OtelTsConfig {
    /** OTLP HTTP endpoint. Default: "http://localhost:4318" */
    endpoint?: string;
    /** Service name for resource identification. Default: "frontend-app" */
    serviceName?: string;
    /** Service version. Default: "0.0.0" */
    serviceVersion?: string;
    /**
     * Sets the `service.instance.id` resource attribute, which Prometheus and
     * Mimir turn into the `instance` label. Every SDK instance must have its
     * own value, or many browsers write to the same metric series.
     * Default: a new random UUID v4 for every `init()` call (see
     * `createInstanceId()`), shared by the metrics, logs and traces resources.
     * Never persisted, never derived from the session ID.
     */
    serviceInstanceId?: string;
    /** Additional resource attributes */
    resourceAttributes?: Record<string, string>;
    /** Enable tracing. Default: true */
    tracing?: boolean;
    /** Propagate trace context to these origins. Default: all origins */
    propagateTraceHeaderCorsUrls?: Array<string | RegExp>;
    /** Enable metrics. Default: true */
    metrics?: boolean;
    /**
     * Metrics export interval in ms. Default: 15000. Telemetry is also flushed
     * whenever the page is hidden.
     */
    metricsExportIntervalMs?: number;
    /**
     * Aggregation temporality requested from the OTLP metrics exporter.
     * "cumulative" exports running totals; "delta" exports counters and
     * histograms as the change since the previous export (up-down counters stay
     * cumulative). Default: "cumulative"
     */
    metricsTemporality?: MetricsTemporality;
    /**
     * Aggregation for histogram instruments.
     * "explicit": explicit-bucket histograms, with the boundaries from the
     * instrument's advice or the SDK defaults. Every backend stores these.
     * "exponential": base-2 exponential histograms, for every histogram
     * instrument (advice boundaries are ignored). Mimir stores each one as a
     * single native-histogram series; this needs native-histogram ingestion
     * turned on (`native_histograms_ingestion_enabled`), or the data is lost.
     * Default: "explicit"
     */
    histogramAggregation?: HistogramAggregation;
    /** Enable logs. Default: true */
    logs?: boolean;
    /** Enable document-load instrumentation. Default: true. Needs a DOM. */
    instrumentDocumentLoad?: boolean;
    /** Enable fetch instrumentation. Default: true */
    instrumentFetch?: boolean;
    /** Enable XMLHttpRequest instrumentation. Default: true */
    instrumentXhr?: boolean;
    /** Enable user-interaction instrumentation. Default: true. Needs a DOM. */
    instrumentUserInteraction?: boolean;
    /** Enable long-task instrumentation. Default: true */
    instrumentLongTask?: boolean;
    /**
     * Enable Grafana Faro integration. Default: true. Faro starts only when
     * `faroCollectorUrl` is set and there is a DOM.
     */
    faro?: boolean;
    /**
     * Faro collector URL. Faro has nowhere to send data without it, so it does
     * not start. Omit for local OTLP-only mode.
     */
    faroCollectorUrl?: string;
    /** Faro app name. Defaults to serviceName. */
    faroAppName?: string;
    /**
     * Enable session tracking. Default: true. The session ID lives in
     * sessionStorage (in memory where there is none) and rotates after 30
     * minutes without activity. When false, each `init()` call gets a new
     * random session ID that is not stored.
     *
     * The session ID is set as the `session.id` attribute of every log record
     * and span, never on the resource.
     */
    sessionTracking?: boolean;
    /** Enable console debug output. Default: false */
    debug?: boolean;
}
export interface ResolvedConfig {
    endpoint: string;
    serviceName: string;
    serviceVersion: string;
    serviceInstanceId: string;
    resourceAttributes: Record<string, string>;
    tracing: boolean;
    propagateTraceHeaderCorsUrls: Array<string | RegExp>;
    metrics: boolean;
    metricsExportIntervalMs: number;
    metricsTemporality: MetricsTemporality;
    histogramAggregation: HistogramAggregation;
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
/** What started a flush */
export interface FlushCause {
    /**
     * The page event that started the flush: `visibilitychange` (the page is
     * hidden) or `pagehide`. Undefined for a call of `forceFlush()` or
     * `shutdown()`.
     */
    readonly event?: Event;
}
export interface OtelTsInstance {
    /**
     * Flush pending telemetry and shut down all providers. Runs once; later
     * calls return the same promise.
     */
    shutdown(): Promise<void>;
    /**
     * Export pending telemetry now; providers keep running. Also runs
     * automatically whenever the page is hidden.
     */
    forceFlush(): Promise<void>;
    /**
     * Register a function that runs synchronously just before each flush:
     * every page hide, the shutdown when the page is discarded, and every
     * manual `forceFlush()` or `shutdown()`. Values it records go out in that
     * flush, whatever order the page's `pagehide` listeners run in (Chromium
     * runs window listeners in registration order). Listeners run in
     * registration order; one that throws doesn't stop the others or the
     * flush, and only the first error is logged. They don't run after
     * shutdown, and a returned promise isn't awaited.
     *
     * The listener gets the cause of the flush. For a page hide it has the
     * `visibilitychange` or `pagehide` event, so a listener can handle that
     * event before the flush even when its own listener of that event would
     * run too late, as in Chromium.
     *
     * @returns A function that removes the listener
     */
    onBeforeFlush(listener: (cause: FlushCause) => void): () => void;
    /**
     * Get the current session ID: the value the next log record or span gets.
     * Counts as activity, like emitting a log record or starting a span.
     */
    getSessionId(): string;
    /** Get a named Meter for creating instruments (histograms, gauges, counters) */
    getMeter(name: string): import("@opentelemetry/api").Meter;
    /** Get a named Logger for emitting log records */
    getLogger(name: string): import("@opentelemetry/api-logs").Logger;
}
//# sourceMappingURL=types.d.ts.map
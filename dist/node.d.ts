import { type NodeSDKConfiguration } from "@opentelemetry/sdk-node";
export { outgoingTraceparent, createTraceEcho, type TraceEcho } from "./trace-echo.js";
/** The configuration of `startNodeTelemetry()` */
export interface NodeTelemetryOptions {
    /** The service name. Default: `OTEL_SERVICE_NAME`, else "node-service". */
    serviceName?: string;
    /**
     * The `import.meta.url` of the module that calls this function. The loader
     * hook resolves from it, so it is the instance of the service's
     * instrumentations. Without it, no loader hook is registered.
     */
    importMetaUrl?: string;
    /** The instrumentations, from the dependencies of the service */
    instrumentations?: NodeSDKConfiguration["instrumentations"];
    /** The trace exporter. Default: the exporter that the SDK makes from the `OTEL_*` variables. */
    traceExporter?: NodeSDKConfiguration["traceExporter"];
    /** The metric readers. Default: none. */
    metricReaders?: NodeSDKConfiguration["metricReaders"];
    /** On or off. Default: on when `OTEL_EXPORTER_OTLP_ENDPOINT` has a value. */
    enabled?: boolean;
    /** Stop the SDK (and flush) at SIGTERM and SIGINT. Default: true. */
    stopOnSignals?: boolean;
    /** The environment. Default: `process.env`. */
    env?: NodeJS.ProcessEnv;
}
/** The result of `startNodeTelemetry()` */
export interface NodeTelemetry {
    /** True when the SDK started */
    readonly enabled: boolean;
    /** True when the loader hook was registered */
    readonly esmHook: boolean;
    /** Stop the SDK and flush the spans and metrics. It does nothing when the SDK did not start. */
    shutdown(): Promise<void>;
}
/** Start OpenTelemetry for a Node service: the loader hook first, then the SDK. */
export declare function startNodeTelemetry(options?: NodeTelemetryOptions): NodeTelemetry;
//# sourceMappingURL=node.d.ts.map
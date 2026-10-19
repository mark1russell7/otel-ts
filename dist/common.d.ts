/**
 * The API that each entry exports, except `init()` and the types of its
 * configuration: `@mark1russell7/otel-ts`, `@mark1russell7/otel-ts/zone` and
 * `@mark1russell7/otel-ts/core` each export their own.
 */
export type { ContextManagerName, FlushCause, HistogramAggregation, MetricsTemporality, OtelTsInstance, } from "./types.js";
export { createInstanceId } from "./id.js";
export { getOrCreateSessionId } from "./session.js";
export { runInRemoteTrace, type RemoteTraceOptions } from "./trace-echo.js";
export { DEFAULT_METRICS_EXPORT_INTERVAL_MS, DEFAULT_OTLP_ENDPOINT, DEFAULT_SERVICE_NAME, DEFAULT_SERVICE_VERSION, } from "./constants.js";
//# sourceMappingURL=common.d.ts.map
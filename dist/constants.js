export const DEFAULT_OTLP_ENDPOINT = "http://localhost:4318";
export const DEFAULT_SERVICE_NAME = "frontend-app";
export const DEFAULT_SERVICE_VERSION = "0.0.0";
export const DEFAULT_METRICS_EXPORT_INTERVAL_MS = 15_000;
export const SESSION_STORAGE_KEY = "otel_session_id";
export const SESSION_TTL_MS = 30 * 60 * 1000;
/**
 * Semantic-conventions `session.id`. It has Development status, so the
 * stable `@opentelemetry/semantic-conventions` entry point does not export it.
 */
export const ATTR_SESSION_ID = "session.id";
//# sourceMappingURL=constants.js.map
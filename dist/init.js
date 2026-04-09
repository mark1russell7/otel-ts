import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import { buildResource } from "./resource.js";
import { getOrCreateSessionId } from "./session.js";
import { setupTracing } from "./tracing.js";
import { setupMetrics } from "./metrics.js";
import { setupLogs } from "./logs.js";
import { setupFaro } from "./faro.js";
import { registerShutdownHandlers } from "./shutdown.js";
import { DEFAULT_OTLP_ENDPOINT, DEFAULT_SERVICE_NAME, DEFAULT_SERVICE_VERSION, SESSION_TTL_MS, } from "./constants.js";
function resolveConfig(config = {}) {
    return {
        endpoint: config.endpoint ?? DEFAULT_OTLP_ENDPOINT,
        serviceName: config.serviceName ?? DEFAULT_SERVICE_NAME,
        serviceVersion: config.serviceVersion ?? DEFAULT_SERVICE_VERSION,
        resourceAttributes: config.resourceAttributes ?? {},
        tracing: config.tracing ?? true,
        propagateTraceHeaderCorsUrls: config.propagateTraceHeaderCorsUrls ?? [/.*/],
        metrics: config.metrics ?? true,
        metricsExportIntervalMs: config.metricsExportIntervalMs ?? 60_000,
        logs: config.logs ?? true,
        instrumentDocumentLoad: config.instrumentDocumentLoad ?? true,
        instrumentFetch: config.instrumentFetch ?? true,
        instrumentXhr: config.instrumentXhr ?? true,
        instrumentUserInteraction: config.instrumentUserInteraction ?? true,
        instrumentLongTask: config.instrumentLongTask ?? true,
        faro: config.faro ?? true,
        faroCollectorUrl: config.faroCollectorUrl,
        faroAppName: config.faroAppName,
        sessionTracking: config.sessionTracking ?? true,
        debug: config.debug ?? false,
    };
}
export function init(config) {
    const resolved = resolveConfig(config);
    const sessionId = resolved.sessionTracking
        ? getOrCreateSessionId(SESSION_TTL_MS)
        : crypto.randomUUID();
    const resource = buildResource(resolved, sessionId);
    const providers = [];
    if (resolved.tracing) {
        providers.push(setupTracing(resource, resolved));
    }
    const meterProvider = resolved.metrics
        ? setupMetrics(resource, resolved)
        : new MeterProvider();
    providers.push(meterProvider);
    const loggerProvider = resolved.logs
        ? setupLogs(resource, resolved)
        : new LoggerProvider();
    providers.push(loggerProvider);
    if (resolved.faro) {
        setupFaro(resolved);
    }
    const shutdownAll = async () => {
        await Promise.allSettled(providers.map((p) => p.shutdown()));
    };
    registerShutdownHandlers(shutdownAll);
    if (resolved.debug) {
        console.log("[otel-ts] Initialized", {
            endpoint: resolved.endpoint,
            serviceName: resolved.serviceName,
            sessionId,
            tracing: resolved.tracing,
            metrics: resolved.metrics,
            logs: resolved.logs,
            faro: resolved.faro,
        });
    }
    return {
        shutdown: shutdownAll,
        getSessionId: () => sessionId,
        getMeter: (name) => meterProvider.getMeter(name),
        getLogger: (name) => loggerProvider.getLogger(name),
    };
}
//# sourceMappingURL=init.js.map
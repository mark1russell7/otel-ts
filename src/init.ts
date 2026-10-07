import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import type { OtelTsConfig, OtelTsInstance, ResolvedConfig } from "./types.js";
import { buildResource } from "./resource.js";
import { createSessionTracker } from "./session.js";
import type { SessionIdReader } from "./session-processors.js";
import { createInstanceId, randomUuid } from "./id.js";
import { setupTracing } from "./tracing.js";
import { setupMetrics } from "./metrics.js";
import { setupLogs } from "./logs.js";
import { setupFaro } from "./faro.js";
import { registerLifecycleHandlers } from "./lifecycle.js";
import { createBeforeFlushListeners } from "./before-flush.js";
import { hasDom } from "./env.js";
import {
  DEFAULT_METRICS_EXPORT_INTERVAL_MS,
  DEFAULT_OTLP_ENDPOINT,
  DEFAULT_SERVICE_NAME,
  DEFAULT_SERVICE_VERSION,
  SESSION_TTL_MS,
} from "./constants.js";

function resolveConfig(config: OtelTsConfig = {}): ResolvedConfig {
  return {
    endpoint: config.endpoint ?? DEFAULT_OTLP_ENDPOINT,
    serviceName: config.serviceName ?? DEFAULT_SERVICE_NAME,
    serviceVersion: config.serviceVersion ?? DEFAULT_SERVICE_VERSION,
    // A new writer identity for every init(). An empty string would map to
    // an empty `instance` label, which is the same as none, so replace it too.
    serviceInstanceId: config.serviceInstanceId || createInstanceId(),
    resourceAttributes: config.resourceAttributes ?? {},
    tracing: config.tracing ?? true,
    propagateTraceHeaderCorsUrls: config.propagateTraceHeaderCorsUrls ?? [/.*/],
    metrics: config.metrics ?? true,
    metricsExportIntervalMs:
      config.metricsExportIntervalMs ?? DEFAULT_METRICS_EXPORT_INTERVAL_MS,
    metricsTemporality: config.metricsTemporality ?? "cumulative",
    histogramAggregation: config.histogramAggregation ?? "explicit",
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

/** Session IDs for this instance: tracked and rotated, or one fixed ID */
function createSessionIdReader(sessionTracking: boolean): SessionIdReader {
  if (sessionTracking) return createSessionTracker(SESSION_TTL_MS);

  const sessionId = randomUuid();
  return () => sessionId;
}

export function init(config?: OtelTsConfig): OtelTsInstance {
  const resolved = resolveConfig(config);

  // Read again for every log record and span, so they follow rotations
  const getSessionId = createSessionIdReader(resolved.sessionTracking);

  // Start or resume the session now: a page load counts as activity
  const sessionId = getSessionId();

  // One resource, so metrics, logs and traces share the service.instance.id
  const resource = buildResource(resolved);
  const providers: Array<{
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
  }> = [];

  if (resolved.tracing) {
    providers.push(setupTracing(resource, resolved, getSessionId));
  }

  const meterProvider = resolved.metrics
    ? setupMetrics(resource, resolved)
    : new MeterProvider();

  providers.push(meterProvider);

  const loggerProvider = resolved.logs
    ? setupLogs(resource, resolved, getSessionId)
    : new LoggerProvider();

  providers.push(loggerProvider);

  // Faro instruments the page (errors, web vitals, views) and needs a DOM.
  // Without a collector URL it has nowhere to send data and logs an error.
  const faroUrl =
    resolved.faro && hasDom() ? resolved.faroCollectorUrl : undefined;

  if (faroUrl) {
    setupFaro(resolved, faroUrl);
  }

  // Run synchronously before every flush (page hide, shutdown, manual), so
  // values they record are in it whatever order pagehide listeners run in
  const beforeFlush = createBeforeFlushListeners();
  let shutdownPromise: Promise<void> | undefined;

  const forceFlush = async (): Promise<void> => {
    // Shut-down providers can't flush; wait for their final flush instead
    if (shutdownPromise) return shutdownPromise;
    beforeFlush.run();
    await Promise.allSettled(providers.map((p) => p.forceFlush()));
  };

  const shutdown = (): Promise<void> => {
    if (!shutdownPromise) {
      beforeFlush.run();
      // ??= in case a listener called shutdown() itself
      shutdownPromise ??= (async () => {
        removeLifecycleHandlers();
        await Promise.allSettled(providers.map((p) => p.shutdown()));
      })();
    }
    return shutdownPromise;
  };

  const removeLifecycleHandlers = registerLifecycleHandlers({
    flush: forceFlush,
    shutdown,
  });

  if (resolved.debug) {
    console.log("[otel-ts] Initialized", {
      endpoint: resolved.endpoint,
      serviceName: resolved.serviceName,
      serviceInstanceId: resolved.serviceInstanceId,
      sessionId,
      tracing: resolved.tracing,
      metrics: resolved.metrics,
      logs: resolved.logs,
      faro: Boolean(faroUrl),
    });
  }

  return {
    shutdown,
    forceFlush,
    onBeforeFlush: (listener) => beforeFlush.add(listener),
    getSessionId,
    getMeter: (name: string) => meterProvider.getMeter(name),
    getLogger: (name: string) => loggerProvider.getLogger(name),
  };
}

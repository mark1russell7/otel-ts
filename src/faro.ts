import { context, trace } from "@opentelemetry/api";
import {
  initializeFaro,
  getWebInstrumentations,
  type Faro,
} from "@grafana/faro-web-sdk";
import type { ResolvedConfig } from "./types.js";

/**
 * Starts Faro, sending to `url`. Without a URL (or transports) Faro has
 * nowhere to send data and logs an error, so `init()` skips it then.
 *
 * Faro sends the errors, the logs, the Web Vitals and the views. otel-ts
 * keeps the traces: Faro gets no tracer provider and no fetch or XHR
 * instrumentation of its own, so each request has one span, and one context
 * manager holds the context. Faro reads the active span of that context, so
 * an error or a log of Faro has the trace and the span of its call.
 */
export function setupFaro(config: ResolvedConfig, url: string): Faro {
  const faro = initializeFaro({
    url,
    app: {
      name: config.faroAppName ?? config.serviceName,
      version: config.serviceVersion,
    },
    instrumentations: getWebInstrumentations({
      captureConsole: true,
      enablePerformanceInstrumentation: true,
      enableContentSecurityPolicyInstrumentation: true,
    }),
  });

  faro.api.initOTEL(trace, context);

  return faro;
}

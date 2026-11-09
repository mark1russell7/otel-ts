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
  const before = globalThis.fetch;
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
  keepFetchOriginal(before);

  return faro;
}

type WrappedFetch = typeof fetch & { __original?: typeof fetch };

/**
 * The OTLP exporters send with `fetch.__original` when it exists, so an
 * export makes no fetch span. The request monitor of Faro (user actions,
 * navigation, frustration) replaces `fetch` with a wrapper without
 * `__original`. Then each export made a span, and that span was exported
 * again. This gives the wrapper of Faro the `__original` of the fetch that
 * it replaced.
 */
function keepFetchOriginal(before: WrappedFetch | undefined): void {
  const after = globalThis.fetch as WrappedFetch | undefined;
  if (!before || !after || after === before) return;
  if (typeof before.__original !== "function") return;
  if (typeof after.__original === "function") return;
  after.__original = before.__original;
}

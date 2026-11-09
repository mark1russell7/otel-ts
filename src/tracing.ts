import type { Resource } from "@opentelemetry/resources";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import type { ContextManager } from "@opentelemetry/api";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getWebAutoInstrumentations } from "@opentelemetry/auto-instrumentations-web";
import { LongTaskInstrumentation } from "@opentelemetry/instrumentation-long-task";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import type { ResolvedConfig } from "./types.js";
import { hasDom } from "./env.js";
import { createContextSpanProcessor } from "./context-processors.js";
import { ContextPropagator } from "./context-propagator.js";
import {
  createSessionSpanProcessor,
  type SessionIdReader,
} from "./session-processors.js";

export function setupTracing(
  resource: Resource,
  config: ResolvedConfig,
  getSessionId: SessionIdReader,
  contextManager: ContextManager,
  /** The URL of the Faro collector, when Faro starts */
  faroUrl?: string,
): WebTracerProvider {
  // Document-load and user-interaction need a DOM; skip them in Web Workers
  const dom = hasDom();

  const exporter = new OTLPTraceExporter({
    url: `${config.endpoint}/v1/traces`,
  });

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [
      createSessionSpanProcessor(getSessionId),
      // The context keys (docs/CONTEXT-DESIGN.md), before the export too
      createContextSpanProcessor(),
      new BatchSpanProcessor(exporter),
    ],
  });

  // The propagator of otel-ts: `traceparent` on each call that the
  // instrumentations permit, `baggage` only on an internal call
  provider.register({ contextManager, propagator: new ContextPropagator() });

  // The sends of Faro to its collector are telemetry, not calls of the app
  const ignoreUrls = faroUrl ? [faroUrl] : [];

  registerInstrumentations({
    instrumentations: [
      getWebAutoInstrumentations({
        "@opentelemetry/instrumentation-document-load": {
          enabled: config.instrumentDocumentLoad && dom,
        },
        "@opentelemetry/instrumentation-fetch": {
          enabled: config.instrumentFetch,
          propagateTraceHeaderCorsUrls: config.propagateTraceHeaderCorsUrls,
          ignoreUrls,
        },
        "@opentelemetry/instrumentation-xml-http-request": {
          enabled: config.instrumentXhr,
          propagateTraceHeaderCorsUrls: config.propagateTraceHeaderCorsUrls,
          ignoreUrls,
        },
        "@opentelemetry/instrumentation-user-interaction": {
          enabled: config.instrumentUserInteraction && dom,
        },
      }),
      ...(config.instrumentLongTask
        ? [new LongTaskInstrumentation()]
        : []),
    ],
  });

  return provider;
}

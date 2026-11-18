import type { Resource } from "@opentelemetry/resources";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { context, propagation, trace, type ContextManager } from "@opentelemetry/api";
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
): TracerProvider {
  // Document-load and user-interaction need a DOM; skip them in Web Workers
  const dom = hasDom();

  const exporter = new OTLPTraceExporter({
    url: `${config.endpoint}/v1/traces`,
  });

  const provider = new TracerProvider({
    resource,
    spanProcessors: [
      createSessionSpanProcessor(getSessionId),
      // The context keys (docs/CONTEXT-DESIGN.md), before the export too
      createContextSpanProcessor(),
      new BatchSpanProcessor({ exporter }),
    ],
  });

  // OpenTelemetry JS 3.x has no register() on the provider: the global
  // tracer provider, the enabled context manager, and the propagator of
  // otel-ts (`traceparent` on each call that the instrumentations permit,
  // `baggage` only on an internal call)
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(contextManager.enable());
  propagation.setGlobalPropagator(new ContextPropagator());

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

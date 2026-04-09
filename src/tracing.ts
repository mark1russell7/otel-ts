import type { Resource } from "@opentelemetry/resources";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { getWebAutoInstrumentations } from "@opentelemetry/auto-instrumentations-web";
import { LongTaskInstrumentation } from "@opentelemetry/instrumentation-long-task";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import type { ResolvedConfig } from "./types.js";

export function setupTracing(
  resource: Resource,
  config: ResolvedConfig,
): WebTracerProvider {
  const exporter = new OTLPTraceExporter({
    url: `${config.endpoint}/v1/traces`,
  });

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  registerInstrumentations({
    instrumentations: [
      getWebAutoInstrumentations({
        "@opentelemetry/instrumentation-document-load": {
          enabled: config.instrumentDocumentLoad,
        },
        "@opentelemetry/instrumentation-fetch": {
          enabled: config.instrumentFetch,
          propagateTraceHeaderCorsUrls: config.propagateTraceHeaderCorsUrls,
        },
        "@opentelemetry/instrumentation-xml-http-request": {
          enabled: config.instrumentXhr,
          propagateTraceHeaderCorsUrls: config.propagateTraceHeaderCorsUrls,
        },
        "@opentelemetry/instrumentation-user-interaction": {
          enabled: config.instrumentUserInteraction,
        },
      }),
      ...(config.instrumentLongTask
        ? [new LongTaskInstrumentation()]
        : []),
    ],
  });

  return provider;
}

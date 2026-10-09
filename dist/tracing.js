import { StackContextManager, WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { getWebAutoInstrumentations } from "@opentelemetry/auto-instrumentations-web";
import { LongTaskInstrumentation } from "@opentelemetry/instrumentation-long-task";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { hasDom } from "./env.js";
import { createSessionSpanProcessor, } from "./session-processors.js";
/** The context manager for the `contextManager` option */
export function createContextManager(option) {
    if (option === "zone")
        return new ZoneContextManager();
    if (option === "stack")
        return new StackContextManager();
    return option;
}
export function setupTracing(resource, config, getSessionId) {
    // Document-load and user-interaction need a DOM; skip them in Web Workers
    const dom = hasDom();
    const exporter = new OTLPTraceExporter({
        url: `${config.endpoint}/v1/traces`,
    });
    const provider = new WebTracerProvider({
        resource,
        spanProcessors: [
            createSessionSpanProcessor(getSessionId),
            new BatchSpanProcessor(exporter),
        ],
    });
    provider.register({
        contextManager: createContextManager(config.contextManager),
    });
    registerInstrumentations({
        instrumentations: [
            getWebAutoInstrumentations({
                "@opentelemetry/instrumentation-document-load": {
                    enabled: config.instrumentDocumentLoad && dom,
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
//# sourceMappingURL=tracing.js.map
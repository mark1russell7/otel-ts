/**
 * The Node.js entry, `@mark1russell7/otel-ts/node`: OpenTelemetry for a Node
 * service, with the order that an ES module service needs.
 *
 * Load the module that calls `startNodeTelemetry()` with `node --import`,
 * before the service: the instrumentations patch `http`, `express` and the
 * database drivers when those modules load. In an ES module service, the
 * require hook does not see a package that an ES module imports. The loader
 * hook of OpenTelemetry (`@opentelemetry/instrumentation/hook.mjs`) patches
 * those imports. `startNodeTelemetry()` registers it before the SDK starts.
 *
 * The SDK, the exporters and the instrumentations come from the dependencies
 * of the service (the OpenTelemetry packages must have one version line), so
 * `@opentelemetry/sdk-node` is a peer dependency of this entry.
 *
 * @packageDocumentation
 */
import { register } from "node:module";
import { NodeSDK } from "@opentelemetry/sdk-node";
export { outgoingTraceparent, createTraceEcho, runInRemoteTrace } from "./trace-echo.js";
/** Start OpenTelemetry for a Node service: the loader hook first, then the SDK. */
export function startNodeTelemetry(options = {}) {
    const env = options.env ?? process.env;
    const enabled = options.enabled ?? !!env["OTEL_EXPORTER_OTLP_ENDPOINT"];
    if (!enabled)
        return { enabled: false, esmHook: false, shutdown: async () => { } };
    let esmHook = false;
    if (options.importMetaUrl) {
        register("@opentelemetry/instrumentation/hook.mjs", options.importMetaUrl);
        esmHook = true;
    }
    const sdk = new NodeSDK({
        serviceName: options.serviceName ?? env["OTEL_SERVICE_NAME"] ?? "node-service",
        ...(options.traceExporter ? { traceExporter: options.traceExporter } : {}),
        ...(options.metricReaders ? { metricReaders: options.metricReaders } : {}),
        ...(options.instrumentations ? { instrumentations: options.instrumentations } : {}),
    });
    sdk.start();
    let stopped = false;
    const shutdown = async () => {
        if (stopped)
            return;
        stopped = true;
        await sdk.shutdown().catch(() => {
            // a flush that fails at the stop loses its spans, and nothing else
        });
    };
    if (options.stopOnSignals ?? true) {
        process.once("SIGTERM", () => void shutdown());
        process.once("SIGINT", () => void shutdown());
    }
    return { enabled: true, esmHook, shutdown };
}
//# sourceMappingURL=node.js.map
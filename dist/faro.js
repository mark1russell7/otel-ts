import { initializeFaro, getWebInstrumentations, } from "@grafana/faro-web-sdk";
import { TracingInstrumentation } from "@grafana/faro-web-tracing";
export function setupFaro(config) {
    return initializeFaro({
        app: {
            name: config.faroAppName ?? config.serviceName,
            version: config.serviceVersion,
        },
        instrumentations: [
            ...getWebInstrumentations({
                captureConsole: true,
                enablePerformanceInstrumentation: true,
                enableContentSecurityPolicyInstrumentation: true,
            }),
            new TracingInstrumentation(),
        ],
        ...(config.faroCollectorUrl ? { url: config.faroCollectorUrl } : {}),
    });
}
//# sourceMappingURL=faro.js.map
import { MeterProvider, PeriodicExportingMetricReader, } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
export function setupMetrics(resource, config) {
    const exporter = new OTLPMetricExporter({
        url: `${config.endpoint}/v1/metrics`,
    });
    return new MeterProvider({
        resource,
        readers: [
            new PeriodicExportingMetricReader({
                exporter,
                exportIntervalMillis: config.metricsExportIntervalMs,
            }),
        ],
    });
}
//# sourceMappingURL=metrics.js.map
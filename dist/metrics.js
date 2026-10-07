import { MeterProvider, PeriodicExportingMetricReader, } from "@opentelemetry/sdk-metrics";
import { AggregationTemporalityPreference, OTLPMetricExporter, } from "@opentelemetry/exporter-metrics-otlp-http";
const TEMPORALITY_PREFERENCES = {
    cumulative: AggregationTemporalityPreference.CUMULATIVE,
    delta: AggregationTemporalityPreference.DELTA,
};
export function setupMetrics(resource, config) {
    const exporter = new OTLPMetricExporter({
        url: `${config.endpoint}/v1/metrics`,
        temporalityPreference: TEMPORALITY_PREFERENCES[config.metricsTemporality],
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
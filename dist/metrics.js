import { AggregationType, InstrumentType, MeterProvider, PeriodicExportingMetricReader, } from "@opentelemetry/sdk-metrics";
import { AggregationTemporalityPreference, OTLPMetricExporter, } from "@opentelemetry/exporter-metrics-otlp-http";
const TEMPORALITY_PREFERENCES = {
    cumulative: AggregationTemporalityPreference.CUMULATIVE,
    delta: AggregationTemporalityPreference.DELTA,
};
/**
 * Base-2 exponential histograms for histogram instruments; every other
 * instrument keeps its default aggregation. Used as the exporter's
 * aggregation preference — the SDK's equivalent of
 * OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION=base2_exponential_bucket_histogram —
 * rather than a View, so it stays the default that any View can override,
 * and there are no overlapping Views producing duplicate streams.
 */
const selectExponentialHistograms = (instrumentType) => instrumentType === InstrumentType.HISTOGRAM
    ? { type: AggregationType.EXPONENTIAL_HISTOGRAM }
    : { type: AggregationType.DEFAULT };
export function setupMetrics(resource, config) {
    const options = {
        url: `${config.endpoint}/v1/metrics`,
        temporalityPreference: TEMPORALITY_PREFERENCES[config.metricsTemporality],
    };
    if (config.histogramAggregation === "exponential") {
        options.aggregationPreference = selectExponentialHistograms;
    }
    const exporter = new OTLPMetricExporter(options);
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
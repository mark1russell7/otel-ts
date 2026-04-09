import { LoggerProvider, BatchLogRecordProcessor, } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
export function setupLogs(resource, config) {
    const exporter = new OTLPLogExporter({
        url: `${config.endpoint}/v1/logs`,
    });
    return new LoggerProvider({
        resource,
        processors: [new BatchLogRecordProcessor(exporter)],
    });
}
//# sourceMappingURL=logs.js.map
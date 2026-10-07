import { LoggerProvider, BatchLogRecordProcessor, } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { createSessionLogRecordProcessor, } from "./session-processors.js";
export function setupLogs(resource, config, getSessionId) {
    const exporter = new OTLPLogExporter({
        url: `${config.endpoint}/v1/logs`,
    });
    return new LoggerProvider({
        resource,
        processors: [
            // Before the exporting processor, so every exported record has it
            createSessionLogRecordProcessor(getSessionId),
            new BatchLogRecordProcessor(exporter),
        ],
    });
}
//# sourceMappingURL=logs.js.map
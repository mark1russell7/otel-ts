import type { Resource } from "@opentelemetry/resources";
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import type { ResolvedConfig } from "./types.js";

export function setupLogs(
  resource: Resource,
  config: ResolvedConfig,
): LoggerProvider {
  const exporter = new OTLPLogExporter({
    url: `${config.endpoint}/v1/logs`,
  });

  return new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(exporter)],
  });
}

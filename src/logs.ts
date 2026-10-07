import type { Resource } from "@opentelemetry/resources";
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import type { ResolvedConfig } from "./types.js";
import {
  createSessionLogRecordProcessor,
  type SessionIdReader,
} from "./session-processors.js";

export function setupLogs(
  resource: Resource,
  config: ResolvedConfig,
  getSessionId: SessionIdReader,
): LoggerProvider {
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

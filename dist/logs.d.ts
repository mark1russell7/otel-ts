import type { Resource } from "@opentelemetry/resources";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import type { ResolvedConfig } from "./types.js";
import { type SessionIdReader } from "./session-processors.js";
export declare function setupLogs(resource: Resource, config: ResolvedConfig, getSessionId: SessionIdReader): LoggerProvider;
//# sourceMappingURL=logs.d.ts.map
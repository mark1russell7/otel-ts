import type { Resource } from "@opentelemetry/resources";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import type { ContextManager } from "@opentelemetry/api";
import type { ResolvedConfig } from "./types.js";
import { type SessionIdReader } from "./session-processors.js";
export declare function setupTracing(resource: Resource, config: ResolvedConfig, getSessionId: SessionIdReader, contextManager: ContextManager): WebTracerProvider;
//# sourceMappingURL=tracing.d.ts.map
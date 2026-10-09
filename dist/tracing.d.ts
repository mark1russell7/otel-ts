import type { Resource } from "@opentelemetry/resources";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import type { ContextManager } from "@opentelemetry/api";
import type { ContextManagerOption, ResolvedConfig } from "./types.js";
import { type SessionIdReader } from "./session-processors.js";
/** The context manager for the `contextManager` option */
export declare function createContextManager(option: ContextManagerOption): ContextManager;
export declare function setupTracing(resource: Resource, config: ResolvedConfig, getSessionId: SessionIdReader): WebTracerProvider;
//# sourceMappingURL=tracing.d.ts.map
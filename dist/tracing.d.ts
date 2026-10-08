import type { Resource } from "@opentelemetry/resources";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import type { ResolvedConfig } from "./types.js";
import { type SessionIdReader } from "./session-processors.js";
export declare function setupTracing(resource: Resource, config: ResolvedConfig, getSessionId: SessionIdReader): WebTracerProvider;
//# sourceMappingURL=tracing.d.ts.map
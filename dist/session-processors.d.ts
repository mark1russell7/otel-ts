import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
/** Returns the current session ID; called once per log record or span */
export type SessionIdReader = () => string;
/** Sets `session.id` on each log record as it is emitted */
export declare function createSessionLogRecordProcessor(getSessionId: SessionIdReader): LogRecordProcessor;
/** Sets `session.id` on each span as it starts */
export declare function createSessionSpanProcessor(getSessionId: SessionIdReader): SpanProcessor;
//# sourceMappingURL=session-processors.d.ts.map
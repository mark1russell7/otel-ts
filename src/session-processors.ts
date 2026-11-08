import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SESSION_ID } from "./constants.js";
import { createAttributesLogRecordProcessor, createAttributesSpanProcessor } from "./context-processors.js";

/** Returns the current session ID; called once per log record or span */
export type SessionIdReader = () => string;

/*
 * The OpenTelemetry Browser SDK's session-processor pattern: `session.id` is
 * an attribute of each log record and span, read as the record is created,
 * not a resource attribute. Resources are fixed for the life of a provider,
 * so a resource `session.id` goes stale when the session rotates, and on the
 * metrics resource it inflates Prometheus `target_info`.
 *
 * A `session.id` the caller set explicitly (e.g. on a `session.end` event
 * for the previous session) is kept.
 *
 * These are a case of the processors of the context keys
 * (context-processors.ts), with the session as the source of the value.
 */

/** Sets `session.id` on each log record as it is emitted */
export function createSessionLogRecordProcessor(
  getSessionId: SessionIdReader,
): LogRecordProcessor {
  return createAttributesLogRecordProcessor(() => ({ [ATTR_SESSION_ID]: getSessionId() }));
}

/** Sets `session.id` on each span as it starts */
export function createSessionSpanProcessor(
  getSessionId: SessionIdReader,
): SpanProcessor {
  return createAttributesSpanProcessor(() => ({ [ATTR_SESSION_ID]: getSessionId() }));
}

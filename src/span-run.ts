/**
 * The run of a function in a span that is already started: the one rule of `runInRemoteTrace` and
 * `runInIncomingSpan`. This module is internal. No entry exports it.
 *
 * @packageDocumentation
 */
import { context, SpanStatusCode, trace, type Context, type Span } from "@opentelemetry/api";

/**
 * This function runs `fn` with `span` active in `parent`, and ends the span. The span ends when `fn` returns, or when
 * the promise of `fn` settles. An error of `fn` sets the status of the span to ERROR, records the error and passes through.
 */
export function runInSpan<T>(span: Span, parent: Context, fn: () => T): T {
  const fail = (error: unknown): void => {
    span.recordException(error instanceof Error ? error : String(error));
    span.setStatus({ code: SpanStatusCode.ERROR, ...(error instanceof Error ? { message: error.message } : {}) });
  };
  let result: T;
  try {
    result = context.with(trace.setSpan(parent, span), fn);
  } catch (error) {
    fail(error);
    span.end();
    throw error;
  }
  if (result && typeof (result as { then?: unknown }).then === "function") {
    return (result as unknown as Promise<unknown>).then(
      (value) => {
        span.end();
        return value;
      },
      (error: unknown) => {
        fail(error);
        span.end();
        throw error;
      },
    ) as T;
  }
  span.end();
  return result;
}

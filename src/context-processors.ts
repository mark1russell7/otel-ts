/**
 * The processors of the context keys (docs/CONTEXT-DESIGN.md, section 4).
 *
 * - Each span and each log record gets the value of each defined context key
 *   of its context, as an attribute.
 * - A metric gets no attribute of a key with `cardinality: "high"`: one time
 *   series for each user id would fill the store.
 *
 * The `session.id` processors (session-processors.ts) are a case of the same
 * two processors. This file imports only types of the SDK packages.
 */
import { context, type Attributes, type Context } from "@opentelemetry/api";
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { IAttributesProcessor, ViewOptions } from "@opentelemetry/sdk-metrics";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { contextKeyRule, contextValues } from "./context.js";

/** The attributes to add to a record that starts in the context `from` */
export type ContextAttributesReader = (from: Context) => Readonly<Record<string, string>>;

/** Sets the attributes of `read` on each span as it starts. An attribute that the caller set is kept. */
export function createAttributesSpanProcessor(read: ContextAttributesReader): SpanProcessor {
  return {
    onStart(span, parentContext) {
      for (const [key, value] of Object.entries(read(parentContext))) {
        if (span.attributes[key] === undefined) span.setAttribute(key, value);
      }
    },
    onEnd() {},
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

/** Sets the attributes of `read` on each log record as it is emitted. An attribute that the caller set is kept. */
export function createAttributesLogRecordProcessor(read: ContextAttributesReader): LogRecordProcessor {
  return {
    onEmit(logRecord, from) {
      for (const [key, value] of Object.entries(read(from ?? context.active()))) {
        if (logRecord.attributes[key] === undefined) logRecord.setAttribute(key, value);
      }
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

/** Sets the value of each defined context key on each span */
export function createContextSpanProcessor(): SpanProcessor {
  return createAttributesSpanProcessor(contextValues);
}

/** Sets the value of each defined context key on each log record */
export function createContextLogRecordProcessor(): LogRecordProcessor {
  return createAttributesLogRecordProcessor(contextValues);
}

/**
 * Removes each attribute of a defined key with `cardinality: "high"` from a
 * measurement. It reads the rules at each measurement, so a key defined after
 * the start of the meter provider is removed too.
 */
export function createContextAttributesProcessor(): IAttributesProcessor {
  return {
    process(incoming: Attributes): Attributes {
      let result: Attributes | undefined;
      for (const key of Object.keys(incoming)) {
        if (contextKeyRule(key)?.cardinality !== "high") continue;
        result ??= { ...incoming };
        delete result[key];
      }
      return result ?? incoming;
    },
  };
}

/**
 * The view for each instrument that removes the keys of high cardinality.
 * Give it as the only view of the meter provider: a second view that matches
 * an instrument makes a second stream of it.
 */
export function contextMetricView(): ViewOptions {
  return { instrumentName: "*", attributesProcessors: [createContextAttributesProcessor()] };
}

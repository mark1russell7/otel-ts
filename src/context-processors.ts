/**
 * The processors of the context keys (docs/CONTEXT-DESIGN.md, section 4).
 *
 * - Each span and each log record gets the value of each defined context key
 *   of its context, as an attribute.
 * - A metric gets no attribute of a key with `cardinality: "high"`: one time
 *   series for each user id would fill the store.
 *
 * The `session.id` processors (session-processors.ts) are a case of the same
 * two processors. Of the SDK packages, this file loads only sdk-metrics, which
 * each entry that uses it loads already.
 */
import { context, type Attributes, type Context } from "@opentelemetry/api";
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import {
  AggregationType,
  InstrumentType,
  type AggregationSelector,
  type IAttributesProcessor,
  type ViewOptions,
} from "@opentelemetry/sdk-metrics";
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

/** The default aggregation of each instrument type, as the SDK's default reader */
export const defaultAggregation: AggregationSelector = () => ({ type: AggregationType.DEFAULT });

/**
 * The views that remove the keys of high cardinality: one view for each
 * instrument type, so each instrument matches one view.
 *
 * The aggregation of a view replaces the aggregation preference of each
 * reader (sdk-metrics, `MeterSharedState`). So the views take the aggregation
 * of each instrument type from `aggregation`: give the preference that the
 * reader would have, for example base-2 exponential histograms.
 *
 * Give these as the only views of the meter provider: a second view that
 * matches an instrument makes a second stream of it.
 */
export function contextMetricViews(aggregation: AggregationSelector = defaultAggregation): ViewOptions[] {
  const processor = createContextAttributesProcessor();
  return Object.values(InstrumentType).map((instrumentType) => ({
    instrumentType,
    attributesProcessors: [processor],
    aggregation: aggregation(instrumentType),
  }));
}

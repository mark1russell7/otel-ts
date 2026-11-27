/**
 * The rows of an OTLP/HTTP JSON export: each span, log record and metric point as one row of the store. The
 * functions read only the parts of OTLP that the store keeps. They make no request and open no file.
 *
 * OTLP JSON gives the ids of a trace and a span in hex, and each time in nanoseconds as a string. A time of today
 * is past 2^53, so each time stays a `bigint`.
 */

/** A value of an attribute, in the JSON of OTLP */
export interface AnyValue {
  readonly stringValue?: string;
  readonly boolValue?: boolean;
  readonly intValue?: string | number;
  readonly doubleValue?: number;
  readonly arrayValue?: { readonly values?: readonly AnyValue[] };
  readonly kvlistValue?: { readonly values?: readonly KeyValue[] };
  readonly bytesValue?: string;
}

/** An attribute, in the JSON of OTLP */
export interface KeyValue {
  readonly key: string;
  readonly value?: AnyValue;
}

/** A resource, in the JSON of OTLP */
export interface OtlpResource {
  readonly attributes?: readonly KeyValue[];
}

/** A time in nanoseconds since the epoch, as OTLP JSON gives it */
export type Nanos = string | number | undefined;

/** A span, in the JSON of OTLP */
export interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind?: number;
  readonly startTimeUnixNano?: Nanos;
  readonly endTimeUnixNano?: Nanos;
  readonly attributes?: readonly KeyValue[];
  readonly status?: { readonly code?: number; readonly message?: string };
}

/** A log record, in the JSON of OTLP */
export interface OtlpLogRecord {
  readonly timeUnixNano?: Nanos;
  readonly observedTimeUnixNano?: Nanos;
  readonly severityNumber?: number;
  readonly body?: AnyValue;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly attributes?: readonly KeyValue[];
}

/** A point of a sum or a gauge, in the JSON of OTLP */
export interface OtlpNumberPoint {
  readonly timeUnixNano?: Nanos;
  readonly attributes?: readonly KeyValue[];
  readonly asDouble?: number;
  readonly asInt?: string | number;
}

/** A point of a histogram, in the JSON of OTLP */
export interface OtlpHistogramPoint {
  readonly timeUnixNano?: Nanos;
  readonly attributes?: readonly KeyValue[];
  readonly count?: string | number;
  readonly sum?: number;
  readonly explicitBounds?: readonly number[];
  readonly bucketCounts?: readonly (string | number)[];
}

/** A metric, in the JSON of OTLP. The store keeps sums, gauges and histograms. */
export interface OtlpMetric {
  readonly name: string;
  readonly sum?: { readonly dataPoints?: readonly OtlpNumberPoint[] };
  readonly gauge?: { readonly dataPoints?: readonly OtlpNumberPoint[] };
  readonly histogram?: { readonly dataPoints?: readonly OtlpHistogramPoint[] };
}

/** The body of an export of traces, in the JSON of OTLP */
export interface TracesExport {
  readonly resourceSpans?: readonly { readonly resource?: OtlpResource; readonly scopeSpans?: readonly { readonly spans?: readonly OtlpSpan[] }[] }[];
}

/** The body of an export of logs, in the JSON of OTLP */
export interface LogsExport {
  readonly resourceLogs?: readonly { readonly resource?: OtlpResource; readonly scopeLogs?: readonly { readonly logRecords?: readonly OtlpLogRecord[] }[] }[];
}

/** The body of an export of metrics, in the JSON of OTLP */
export interface MetricsExport {
  readonly resourceMetrics?: readonly { readonly resource?: OtlpResource; readonly scopeMetrics?: readonly { readonly metrics?: readonly OtlpMetric[] }[] }[];
}

/** The value of an attribute in the store */
export type Value = string | number | boolean | null | readonly Value[] | { readonly [key: string]: Value };

/** A span as a row of the store */
export interface SpanRow {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentId: string | null;
  readonly service: string;
  readonly name: string;
  /** The kind of OTLP: 1 internal, 2 server, 3 client, 4 producer, 5 consumer, or null when it is not given */
  readonly kind: number | null;
  readonly startNs: bigint;
  readonly endNs: bigint;
  /** The status code of OTLP: 0 unset, 1 ok, 2 error */
  readonly status: number;
  /** The attributes, as JSON text */
  readonly attributes: string;
}

/** A log record as a row of the store */
export interface LogRow {
  readonly timeNs: bigint;
  readonly service: string;
  readonly severity: number | null;
  readonly body: string | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly attributes: string;
}

/** A metric point as a row of the store */
export interface PointRow {
  readonly timeNs: bigint;
  readonly service: string;
  readonly metric: string;
  readonly attributes: string;
  /** The value of a sum or a gauge, or the sum of a histogram */
  readonly value: number | null;
  /** The count and the buckets of a histogram, as JSON text, or null for a sum or a gauge */
  readonly histogram: string | null;
}

/** The service name of a resource without `service.name`, as in the SDK of OpenTelemetry */
export const UNKNOWN_SERVICE = "unknown_service";

/** This error tells that a body is not an export of OTLP JSON. The receiver answers it with 400. */
export class OtlpShapeError extends Error {
  override readonly name = "OtlpShapeError";
}

/** This function gives the value of an attribute of OTLP JSON. */
export const valueOf = (value: AnyValue | undefined): Value => {
  if (value === undefined || value === null) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.arrayValue !== undefined) return (value.arrayValue.values ?? []).map(valueOf);
  if (value.kvlistValue !== undefined) return attributesOf(value.kvlistValue.values);
  if (value.bytesValue !== undefined) return value.bytesValue;
  return null;
};

/** This function gives the attributes of OTLP JSON as one object. */
export const attributesOf = (list: readonly KeyValue[] = []): { readonly [key: string]: Value } =>
  Object.fromEntries(list.map(({ key, value }) => [key, valueOf(value)]));

const serviceOf = (resource: OtlpResource | undefined): string => {
  const name = attributesOf(resource?.attributes)["service.name"];
  return typeof name === "string" && name !== "" ? name : UNKNOWN_SERVICE;
};

const ns = (text: Nanos, what: string): bigint => {
  if (text === undefined || text === "") return 0n;
  try {
    return BigInt(text);
  } catch {
    throw new OtlpShapeError(`${what} is not a time in nanoseconds: ${String(text)}`);
  }
};

const HEX = /^[0-9a-f]*$/i;
const id = (text: string | undefined, what: string): string | null => {
  if (text === undefined || text === "") return null;
  if (!HEX.test(text)) throw new OtlpShapeError(`${what} is not hex: ${text}`);
  return text.toLowerCase();
};

const list = <T>(value: readonly T[] | undefined, what: string): readonly T[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new OtlpShapeError(`${what} is not a list`);
  return value;
};

/** This function gives a row for each span of an export of traces. */
export const spanRows = (body: TracesExport): SpanRow[] => {
  const rows: SpanRow[] = [];
  for (const { resource, scopeSpans } of list(body.resourceSpans, "resourceSpans")) {
    const service = serviceOf(resource);
    for (const { spans } of list(scopeSpans, "scopeSpans"))
      for (const span of list(spans, "spans")) {
        const traceId = id(span.traceId, "traceId");
        const spanId = id(span.spanId, "spanId");
        if (traceId === null || spanId === null) throw new OtlpShapeError("a span has no traceId or no spanId");
        rows.push({
          traceId,
          spanId,
          parentId: id(span.parentSpanId, "parentSpanId"),
          service,
          name: String(span.name ?? ""),
          kind: span.kind ?? null,
          startNs: ns(span.startTimeUnixNano, "startTimeUnixNano"),
          endNs: ns(span.endTimeUnixNano, "endTimeUnixNano"),
          status: span.status?.code ?? 0,
          attributes: JSON.stringify(attributesOf(span.attributes)),
        });
      }
  }
  return rows;
};

/** This function gives a row for each log record of an export of logs. A record without a time gets its observed time. */
export const logRows = (body: LogsExport): LogRow[] => {
  const rows: LogRow[] = [];
  for (const { resource, scopeLogs } of list(body.resourceLogs, "resourceLogs")) {
    const service = serviceOf(resource);
    for (const { logRecords } of list(scopeLogs, "scopeLogs"))
      for (const log of list(logRecords, "logRecords")) {
        const text = valueOf(log.body);
        const time = ns(log.timeUnixNano, "timeUnixNano");
        rows.push({
          timeNs: time === 0n ? ns(log.observedTimeUnixNano, "observedTimeUnixNano") : time,
          service,
          severity: log.severityNumber ?? null,
          body: text === null ? null : typeof text === "string" ? text : JSON.stringify(text),
          traceId: id(log.traceId, "traceId"),
          spanId: id(log.spanId, "spanId"),
          attributes: JSON.stringify(attributesOf(log.attributes)),
        });
      }
  }
  return rows;
};

/** This function gives a row for each point of a sum, a gauge or a histogram of an export of metrics. */
export const pointRows = (body: MetricsExport): PointRow[] => {
  const rows: PointRow[] = [];
  for (const { resource, scopeMetrics } of list(body.resourceMetrics, "resourceMetrics")) {
    const service = serviceOf(resource);
    for (const { metrics } of list(scopeMetrics, "scopeMetrics"))
      for (const metric of list(metrics, "metrics")) {
        const numbers = [...list(metric.sum?.dataPoints, "sum.dataPoints"), ...list(metric.gauge?.dataPoints, "gauge.dataPoints")];
        for (const point of numbers)
          rows.push({
            timeNs: ns(point.timeUnixNano, "timeUnixNano"),
            service,
            metric: metric.name,
            attributes: JSON.stringify(attributesOf(point.attributes)),
            value: point.asDouble ?? (point.asInt === undefined ? null : Number(point.asInt)),
            histogram: null,
          });
        for (const point of list(metric.histogram?.dataPoints, "histogram.dataPoints"))
          rows.push({
            timeNs: ns(point.timeUnixNano, "timeUnixNano"),
            service,
            metric: metric.name,
            attributes: JSON.stringify(attributesOf(point.attributes)),
            value: point.sum ?? null,
            histogram: JSON.stringify({ count: Number(point.count ?? 0), explicitBounds: point.explicitBounds ?? [], bucketCounts: (point.bucketCounts ?? []).map(Number) }),
          });
      }
  }
  return rows;
};

/**
 * The decoders of the OTLP/JSON bodies that the exporters of `init()` give. They hold no state and no DOM, so a test can
 * examine them. The page shows the output of these decoders, and each span record keeps its raw OTLP object.
 */

/** The value of an OTLP attribute, after the decode. */
export type AttributeValue = string | number | boolean | readonly AttributeValue[] | undefined;

/** A record of attributes. */
export type Attributes = Readonly<Record<string, AttributeValue>>;

/** The three signals of OTLP. */
export type Signal = "traces" | "metrics" | "logs";

interface OtlpValue {
  readonly stringValue?: string;
  readonly intValue?: string | number;
  readonly doubleValue?: number;
  readonly boolValue?: boolean;
  readonly arrayValue?: { readonly values?: readonly OtlpValue[] };
}

interface OtlpKeyValue {
  readonly key: string;
  readonly value?: OtlpValue;
}

interface OtlpEvent {
  readonly name: string;
  readonly timeUnixNano: string | number;
  readonly attributes?: readonly OtlpKeyValue[];
}

interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind?: number;
  readonly startTimeUnixNano: string | number;
  readonly endTimeUnixNano: string | number;
  readonly attributes?: readonly OtlpKeyValue[];
  readonly events?: readonly OtlpEvent[];
  readonly status?: { readonly code?: number; readonly message?: string };
}

interface OtlpScope {
  readonly name?: string;
}

interface OtlpResource {
  readonly attributes?: readonly OtlpKeyValue[];
}

interface OtlpPoint {
  readonly attributes?: readonly OtlpKeyValue[];
  readonly asInt?: string | number;
  readonly asDouble?: number;
  readonly count?: string | number;
  readonly sum?: number;
  readonly min?: number;
  readonly max?: number;
  readonly bucketCounts?: readonly (string | number)[];
  readonly explicitBounds?: readonly number[];
  readonly scale?: number;
  readonly positive?: { readonly offset?: number; readonly bucketCounts?: readonly (string | number)[] };
}

interface OtlpData {
  readonly dataPoints?: readonly OtlpPoint[];
  readonly aggregationTemporality?: number;
}

interface OtlpMetric {
  readonly name: string;
  readonly unit?: string;
  readonly sum?: OtlpData;
  readonly gauge?: OtlpData;
  readonly histogram?: OtlpData;
  readonly exponentialHistogram?: OtlpData;
}

interface OtlpLog {
  readonly timeUnixNano?: string | number;
  readonly observedTimeUnixNano?: string | number;
  readonly severityNumber?: number;
  readonly severityText?: string;
  readonly body?: OtlpValue;
  readonly attributes?: readonly OtlpKeyValue[];
  readonly traceId?: string;
  readonly spanId?: string;
}

/** The body of an export to `/v1/traces`, `/v1/metrics` or `/v1/logs`. */
export interface OtlpBody {
  readonly resourceSpans?: readonly { readonly resource?: OtlpResource; readonly scopeSpans?: readonly { readonly scope?: OtlpScope; readonly spans?: readonly OtlpSpan[] }[] }[];
  readonly resourceMetrics?: readonly { readonly resource?: OtlpResource; readonly scopeMetrics?: readonly { readonly scope?: OtlpScope; readonly metrics?: readonly OtlpMetric[] }[] }[];
  readonly resourceLogs?: readonly { readonly resource?: OtlpResource; readonly scopeLogs?: readonly { readonly scope?: OtlpScope; readonly logRecords?: readonly OtlpLog[] }[] }[];
}

/** One span of an export. */
export interface SpanRecord {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  /** The name of the span kind, in lower case. */
  readonly kind: string;
  readonly scope: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly status: "unset" | "ok" | "error";
  readonly attributes: Attributes;
  readonly events: readonly { readonly name: string; readonly timeMs: number; readonly attributes: Attributes }[];
  readonly resource: Attributes;
  /** The OTLP object of the span, as it left the package. */
  readonly raw: unknown;
}

/** One data point of a metric of an export. */
export interface MetricRecord {
  readonly name: string;
  readonly unit: string;
  readonly type: "sum" | "gauge" | "histogram" | "exponential histogram";
  readonly temporality: "delta" | "cumulative" | "none";
  readonly scope: string;
  readonly attributes: Attributes;
  /** The value of a sum or a gauge, and the sum of a histogram. */
  readonly value: number;
  /** The count of a histogram. */
  readonly count: number | undefined;
  /** The buckets of a histogram: the upper limit and the count. The last limit of an explicit histogram is `Infinity`. */
  readonly buckets: readonly { readonly limit: number; readonly count: number }[];
  readonly resource: Attributes;
}

/** One log record of an export. */
export interface LogRecord {
  readonly timeMs: number;
  readonly severity: string;
  readonly severityNumber: number;
  readonly body: string;
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
  readonly scope: string;
  readonly attributes: Attributes;
  readonly resource: Attributes;
}

const SPAN_KINDS = ["unspecified", "internal", "server", "client", "producer", "consumer"];

/** This function gives a time of OTLP in milliseconds. Each OTLP time is a string of nanoseconds. */
export function nanosToMs(value: string | number | undefined): number {
  return value === undefined ? 0 : Number(value) / 1e6;
}

/** This function gives the JavaScript value of an OTLP value. */
export function decodeValue(value: OtlpValue | undefined): AttributeValue {
  if (value === undefined) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.arrayValue !== undefined) return (value.arrayValue.values ?? []).map(decodeValue);
  return undefined;
}

/** This function gives a record of an OTLP attribute list. */
export function decodeAttributes(list: readonly OtlpKeyValue[] | undefined): Attributes {
  return Object.fromEntries((list ?? []).map(({ key, value }) => [key, decodeValue(value)]));
}

/** This function gives the spans of a body of `/v1/traces`. */
export function decodeSpans(body: OtlpBody): SpanRecord[] {
  return (body.resourceSpans ?? []).flatMap((group) => {
    const resource = decodeAttributes(group.resource?.attributes);
    return (group.scopeSpans ?? []).flatMap((scoped) =>
      (scoped.spans ?? []).map((span) => ({
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId === undefined || span.parentSpanId === "" ? undefined : span.parentSpanId,
        name: span.name,
        kind: SPAN_KINDS[span.kind ?? 0] ?? "unspecified",
        scope: scoped.scope?.name ?? "",
        startMs: nanosToMs(span.startTimeUnixNano),
        endMs: nanosToMs(span.endTimeUnixNano),
        status: span.status?.code === 2 ? ("error" as const) : span.status?.code === 1 ? ("ok" as const) : ("unset" as const),
        attributes: decodeAttributes(span.attributes),
        events: (span.events ?? []).map((event) => ({ name: event.name, timeMs: nanosToMs(event.timeUnixNano), attributes: decodeAttributes(event.attributes) })),
        resource,
        raw: span,
      })),
    );
  });
}

/** This function gives the upper limit and the count of each bucket of a histogram point. */
function bucketsOf(point: OtlpPoint): { limit: number; count: number }[] {
  if (point.positive?.bucketCounts) {
    // The bucket at index i of an exponential histogram ends at base^(offset + i + 1), and base is 2^(2^-scale).
    const base = 2 ** (2 ** -(point.scale ?? 0));
    const offset = point.positive.offset ?? 0;
    return point.positive.bucketCounts.map((count, index) => ({ limit: base ** (offset + index + 1), count: Number(count) }));
  }
  const bounds = point.explicitBounds ?? [];
  return (point.bucketCounts ?? []).map((count, index) => ({ limit: bounds[index] ?? Number.POSITIVE_INFINITY, count: Number(count) }));
}

function temporalityOf(data: OtlpData | undefined): MetricRecord["temporality"] {
  if (data?.aggregationTemporality === 1) return "delta";
  if (data?.aggregationTemporality === 2) return "cumulative";
  return "none";
}

/** This function gives the data points of a body of `/v1/metrics`. */
export function decodeMetrics(body: OtlpBody): MetricRecord[] {
  return (body.resourceMetrics ?? []).flatMap((group) => {
    const resource = decodeAttributes(group.resource?.attributes);
    return (group.scopeMetrics ?? []).flatMap((scoped) =>
      (scoped.metrics ?? []).flatMap((metric) => {
        const shapes = [
          ["sum", metric.sum],
          ["gauge", metric.gauge],
          ["histogram", metric.histogram],
          ["exponential histogram", metric.exponentialHistogram],
        ] as const;
        return shapes.flatMap(([type, data]) =>
          (data?.dataPoints ?? []).map((point) => ({
            name: metric.name,
            unit: metric.unit ?? "",
            type,
            temporality: temporalityOf(data),
            scope: scoped.scope?.name ?? "",
            attributes: decodeAttributes(point.attributes),
            value: point.sum ?? Number(point.asInt ?? point.asDouble ?? 0),
            count: point.count === undefined ? undefined : Number(point.count),
            buckets: bucketsOf(point),
            resource,
          })),
        );
      }),
    );
  });
}

/** This function gives the log records of a body of `/v1/logs`. */
export function decodeLogs(body: OtlpBody): LogRecord[] {
  return (body.resourceLogs ?? []).flatMap((group) => {
    const resource = decodeAttributes(group.resource?.attributes);
    return (group.scopeLogs ?? []).flatMap((scoped) =>
      (scoped.logRecords ?? []).map((record) => ({
        timeMs: nanosToMs(record.timeUnixNano ?? record.observedTimeUnixNano),
        severity: record.severityText ?? "",
        severityNumber: record.severityNumber ?? 0,
        body: String(decodeValue(record.body) ?? ""),
        traceId: record.traceId === undefined || record.traceId === "" ? undefined : record.traceId,
        spanId: record.spanId === undefined || record.spanId === "" ? undefined : record.spanId,
        scope: scoped.scope?.name ?? "",
        attributes: decodeAttributes(record.attributes),
        resource,
      })),
    );
  });
}

/** This function gives the count of the records of a body: its spans, its data points or its log records. */
export function recordCount(signal: Signal, body: OtlpBody): number {
  if (signal === "traces") return decodeSpans(body).length;
  if (signal === "metrics") return decodeMetrics(body).length;
  return decodeLogs(body).length;
}

/** One row of a waterfall: a span and its depth in the tree of the trace. */
export interface WaterfallRow {
  readonly span: SpanRecord;
  readonly depth: number;
}

/**
 * This function gives the rows of the waterfall of a trace. A child follows its parent, and siblings go in the order of
 * their start. A span whose parent is not in the list starts a tree at depth 0: for example, a span with a parent in
 * another process, or a span whose parent has not left the batch yet.
 */
export function waterfallRows(spans: readonly SpanRecord[]): WaterfallRow[] {
  const ids = new Set(spans.map((span) => span.spanId));
  const children = new Map<string | undefined, SpanRecord[]>();
  for (const span of [...spans].sort((a, b) => a.startMs - b.startMs)) {
    const parent = span.parentSpanId !== undefined && ids.has(span.parentSpanId) ? span.parentSpanId : undefined;
    children.set(parent, [...(children.get(parent) ?? []), span]);
  }
  const rows: WaterfallRow[] = [];
  const walk = (parent: string | undefined, depth: number): void => {
    for (const span of children.get(parent) ?? []) {
      rows.push({ span, depth });
      walk(span.spanId, depth + 1);
    }
  };
  walk(undefined, 0);
  return rows;
}

/** This function gives the position of a span bar, in percent of the width of the trace. */
export function barPosition(span: SpanRecord, startMs: number, endMs: number): { left: number; width: number } {
  const total = Math.max(endMs - startMs, 0.001);
  const left = Math.min(Math.max(((span.startMs - startMs) / total) * 100, 0), 100);
  const width = (Math.max(span.endMs - span.startMs, 0) / total) * 100;
  return { left, width: Math.min(width, 100 - left) };
}

/** This function gives a number of milliseconds as a short text. */
export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 10) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}

/** This function gives a number of bytes as a short text. */
export function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
}

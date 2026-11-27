/** The bodies of OTLP JSON for the tests */
import type { LogsExport, MetricsExport, TracesExport } from "./otlp.ts";

/** A time in milliseconds as OTLP JSON gives it: nanoseconds in a string */
export const nanos = (ms: number): string => (BigInt(ms) * 1_000_000n).toString();

/** A trace id of 32 hex digits from a number */
export const traceId = (n: number): string => n.toString(16).padStart(32, "0");
/** A span id of 16 hex digits from a number */
export const spanId = (n: number): string => n.toString(16).padStart(16, "0");

/** The options of one span of `traces` */
export interface SpanSpec {
  readonly trace: number;
  readonly span: number;
  readonly parent?: number;
  readonly name?: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly error?: boolean;
  readonly service?: string;
}

/** This function gives an export of traces with one resource for each service. */
export const traces = (spans: readonly SpanSpec[]): TracesExport => {
  const byService = new Map<string, SpanSpec[]>();
  for (const span of spans) byService.set(span.service ?? "api", [...(byService.get(span.service ?? "api") ?? []), span]);
  return {
    resourceSpans: [...byService].map(([service, list]) => ({
      resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
      scopeSpans: [
        {
          spans: list.map((span) => ({
            traceId: traceId(span.trace),
            spanId: spanId(span.span),
            ...(span.parent === undefined ? {} : { parentSpanId: spanId(span.parent) }),
            name: span.name ?? "GET /",
            kind: 2,
            startTimeUnixNano: nanos(span.startMs),
            endTimeUnixNano: nanos(span.startMs + span.durationMs),
            attributes: [{ key: "http.response.status_code", value: { intValue: span.error === true ? "500" : "200" } }],
            status: { code: span.error === true ? 2 : 0 },
          })),
        },
      ],
    })),
  };
};

/** This function gives an export of logs of the service `api`. */
export const logs = (records: readonly { readonly timeMs: number; readonly severity: number; readonly body: string; readonly trace?: number }[]): LogsExport => ({
  resourceLogs: [
    {
      resource: { attributes: [{ key: "service.name", value: { stringValue: "api" } }] },
      scopeLogs: [
        {
          logRecords: records.map((record) => ({
            timeUnixNano: nanos(record.timeMs),
            severityNumber: record.severity,
            body: { stringValue: record.body },
            ...(record.trace === undefined ? {} : { traceId: traceId(record.trace), spanId: spanId(1) }),
          })),
        },
      ],
    },
  ],
});

/** This function gives an export of metrics with one sum and one histogram of the service `api`. */
export const metrics = (timeMs: number): MetricsExport => ({
  resourceMetrics: [
    {
      resource: { attributes: [{ key: "service.name", value: { stringValue: "api" } }] },
      scopeMetrics: [
        {
          metrics: [
            { name: "requests", sum: { dataPoints: [{ timeUnixNano: nanos(timeMs), asInt: "7", attributes: [{ key: "route", value: { stringValue: "/" } }] }] } },
            {
              name: "duration",
              histogram: { dataPoints: [{ timeUnixNano: nanos(timeMs), count: "3", sum: 0.6, explicitBounds: [0.1, 1], bucketCounts: ["1", "2", "0"] }] },
            },
          ],
        },
      ],
    },
  ],
});

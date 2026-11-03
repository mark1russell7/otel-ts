import { describe, expect, it } from "vitest";
import { barPosition, decodeLogs, decodeMetrics, decodeSpans, formatBytes, formatMs, recordCount, waterfallRows } from "./otlp.ts";
import type { OtlpBody, SpanRecord } from "./otlp.ts";

const resource = { attributes: [{ key: "service.name", value: { stringValue: "demo" } }] };

const span = (spanId: string, parentSpanId: string | undefined, startMs: number, endMs: number) => ({
  traceId: "t",
  spanId,
  ...(parentSpanId === undefined ? {} : { parentSpanId }),
  name: spanId,
  kind: 3,
  startTimeUnixNano: String(startMs * 1e6),
  endTimeUnixNano: String(endMs * 1e6),
  attributes: [{ key: "http.status_code", value: { intValue: "200" } }],
  status: { code: 2 },
});

const traces = (...spans: ReturnType<typeof span>[]): OtlpBody => ({ resourceSpans: [{ resource, scopeSpans: [{ scope: { name: "scope" }, spans }] }] });

describe("decodeSpans", () => {
  it("gives the values of OTLP as JavaScript values", () => {
    const [decoded] = decodeSpans(traces(span("a", undefined, 10, 30)));
    expect(decoded).toMatchObject({ spanId: "a", parentSpanId: undefined, kind: "client", scope: "scope", startMs: 10, endMs: 30, status: "error" });
    expect(decoded?.attributes).toEqual({ "http.status_code": 200 });
    expect(decoded?.resource).toEqual({ "service.name": "demo" });
  });

  it("treats an empty parent ID as no parent", () => {
    expect(decodeSpans(traces(span("a", "", 0, 1)))[0]?.parentSpanId).toBeUndefined();
  });
});

describe("decodeMetrics", () => {
  const body: OtlpBody = {
    resourceMetrics: [
      {
        resource,
        scopeMetrics: [
          {
            metrics: [
              { name: "count", sum: { aggregationTemporality: 2, dataPoints: [{ asInt: "4", attributes: [{ key: "action", value: { stringValue: "log" } }] }] } },
              { name: "time", unit: "ms", histogram: { aggregationTemporality: 1, dataPoints: [{ count: "3", sum: 12, bucketCounts: ["1", "2"], explicitBounds: [5] }] } },
              { name: "wide", exponentialHistogram: { aggregationTemporality: 1, dataPoints: [{ count: 1, sum: 3, scale: 0, positive: { offset: 1, bucketCounts: [1] } }] } },
            ],
          },
        ],
      },
    ],
  };

  it("gives the value and the temporality of a sum", () => {
    expect(decodeMetrics(body)[0]).toMatchObject({ name: "count", type: "sum", temporality: "cumulative", value: 4, attributes: { action: "log" } });
  });

  it("gives the buckets of an explicit histogram, with an open last bucket", () => {
    expect(decodeMetrics(body)[1]).toMatchObject({
      type: "histogram",
      temporality: "delta",
      count: 3,
      value: 12,
      buckets: [
        { limit: 5, count: 1 },
        { limit: Number.POSITIVE_INFINITY, count: 2 },
      ],
    });
  });

  it("gives the upper limit of a bucket of an exponential histogram", () => {
    // Scale 0 has the base 2. The bucket with offset 1 and index 0 covers (2, 4].
    expect(decodeMetrics(body)[2]?.buckets).toEqual([{ limit: 4, count: 1 }]);
  });

  it("counts the data points", () => {
    expect(recordCount("metrics", body)).toBe(3);
  });
});

describe("decodeLogs", () => {
  it("keeps the trace IDs of a log record", () => {
    const body: OtlpBody = {
      resourceLogs: [{ resource, scopeLogs: [{ logRecords: [{ timeUnixNano: "5000000", severityNumber: 9, severityText: "INFO", body: { stringValue: "hello" }, traceId: "t", spanId: "s" }] }] }],
    };
    expect(decodeLogs(body)).toMatchObject([{ timeMs: 5, severity: "INFO", body: "hello", traceId: "t", spanId: "s" }]);
  });
});

describe("waterfallRows", () => {
  const spans = decodeSpans(traces(span("child", "root", 5, 6), span("late", undefined, 20, 21), span("root", undefined, 0, 10), span("orphan", "gone", 8, 9)));

  it("puts each child after its parent, and gives it a depth", () => {
    expect(waterfallRows(spans).map((row) => [row.span.spanId, row.depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["orphan", 0],
      ["late", 0],
    ]);
  });
});

describe("barPosition", () => {
  const record = { startMs: 25, endMs: 50 } as SpanRecord;

  it("gives percents of the trace", () => {
    expect(barPosition(record, 0, 100)).toEqual({ left: 25, width: 25 });
  });

  it("does not go past the right edge", () => {
    expect(barPosition({ startMs: 90, endMs: 200 } as SpanRecord, 0, 100)).toEqual({ left: 90, width: 10 });
  });
});

describe("the text formats", () => {
  it("gives a short time", () => {
    expect([formatMs(1.25), formatMs(42.4), formatMs(1500)]).toEqual(["1.3 ms", "42 ms", "1.50 s"]);
  });

  it("gives a short size", () => {
    expect([formatBytes(512), formatBytes(2048)]).toEqual(["512 B", "2.0 KiB"]);
  });
});

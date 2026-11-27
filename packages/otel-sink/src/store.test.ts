import { describe, expect, it } from "vitest";
import { logs, metrics, traces, traceId } from "./fixtures.test-util.ts";
import { logRows, OtlpShapeError, pointRows, spanRows, UNKNOWN_SERVICE, valueOf } from "./otlp.ts";
import { errors, services, slowest, trace, windowProblems } from "./query.ts";
import { DEFAULT_RETENTION, HARD_LIMIT_BYTES, retentionProblems, type RetentionRules } from "./retention.ts";
import { openStore } from "./store.ts";
import { isOwnEndpoint } from "./index.ts";

const T0 = Date.UTC(2026, 10, 26, 12);
const MINUTE = 60_000;

describe("the rows of OTLP JSON", () => {
  it("keeps each time in nanoseconds past 2^53 as a bigint, and the ids in lower-case hex", () => {
    const [row] = spanRows({
      resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "AB".repeat(16), spanId: "CD".repeat(8), name: "x", startTimeUnixNano: "1764158400123456789", endTimeUnixNano: "1764158400123456790" }] }] }],
    });
    expect(row?.startNs).toBe(1764158400123456789n);
    expect((row?.endNs ?? 0n) - (row?.startNs ?? 0n)).toBe(1n);
    expect(row?.traceId).toBe("ab".repeat(16));
    expect(row?.service).toBe(UNKNOWN_SERVICE);
  });

  it("gives the values of each kind of attribute", () => {
    expect(valueOf({ intValue: "42" })).toBe(42);
    expect(valueOf({ boolValue: false })).toBe(false);
    expect(valueOf({ arrayValue: { values: [{ stringValue: "a" }, { doubleValue: 1.5 }] } })).toEqual(["a", 1.5]);
    expect(valueOf({ kvlistValue: { values: [{ key: "k", value: { stringValue: "v" } }] } })).toEqual({ k: "v" });
    expect(valueOf(undefined)).toBeNull();
  });

  it("gives a log record without a time its observed time, and a body that is not a string as JSON", () => {
    const [row] = logRows({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ observedTimeUnixNano: "5", body: { kvlistValue: { values: [{ key: "a", value: { intValue: 1 } }] } } }] }] }] });
    expect(row?.timeNs).toBe(5n);
    expect(row?.body).toBe('{"a":1}');
  });

  it("gives a row for each point of a sum and a histogram", () => {
    const rows = pointRows(metrics(T0));
    expect(rows.map((row) => [row.metric, row.value])).toEqual([
      ["requests", 7],
      ["duration", 0.6],
    ]);
    expect(JSON.parse(rows[1]?.histogram ?? "null")).toEqual({ count: 3, explicitBounds: [0.1, 1], bucketCounts: [1, 2, 0] });
  });

  it("refuses a body that is not OTLP: a list that is not a list, an id that is not hex, a time that is not a number", () => {
    expect(() => spanRows({ resourceSpans: {} as never })).toThrow(OtlpShapeError);
    expect(() => spanRows({ resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "zz", spanId: "01", name: "x" }] }] }] })).toThrow(/not hex/);
    expect(() => logRows({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ timeUnixNano: "soon" }] }] }] })).toThrow(OtlpShapeError);
    expect(() => spanRows({ resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "", spanId: "01", name: "x" }] }] }] })).toThrow(/no traceId/);
  });
});

describe("the retention rules", () => {
  it("accept the defaults, and refuse a sum of sizes past the hard limit or a value that is not positive", () => {
    expect(retentionProblems(DEFAULT_RETENTION)).toEqual([]);
    const big: RetentionRules = { ...DEFAULT_RETENTION, spans: { maxAgeMs: 1, maxBytes: HARD_LIMIT_BYTES } };
    expect(retentionProblems(big)).toEqual([expect.stringMatching(/more than the hard limit/)]);
    const bad: RetentionRules = { ...DEFAULT_RETENTION, logs: { maxAgeMs: 0, maxBytes: 1.5 } };
    expect(retentionProblems(bad)).toHaveLength(2);
    expect(() => openStore(":memory:", { rules: big })).toThrow(/retention rules have problems/);
  });
});

describe("the store", () => {
  it("counts the rows and the bytes of each signal through its triggers", () => {
    const store = openStore(":memory:");
    try {
      store.insert({ spans: spanRows(traces([{ trace: 1, span: 1, startMs: T0, durationMs: 5 }])), logs: logRows(logs([{ timeMs: T0, severity: 9, body: "hello" }])) });
      const sizes = store.sizes();
      expect(sizes.spans.rows).toBe(1);
      expect(sizes.logs.rows).toBe(1);
      expect(sizes.points).toEqual({ rows: 0, bytes: 0 });
      expect(sizes.spans.bytes).toBeGreaterThan(32);
      const sum = Number(store.db.prepare("SELECT SUM(bytes) AS b FROM spans").get()?.["b"]);
      expect(sizes.spans.bytes).toBe(sum);
    } finally {
      store.close();
    }
  });

  it("deletes the rows past the age of their signal at the prune", () => {
    const store = openStore(":memory:");
    try {
      const old = T0 - DEFAULT_RETENTION.spans.maxAgeMs - MINUTE;
      store.insert({ spans: spanRows(traces([{ trace: 1, span: 1, startMs: old, durationMs: 1 }, { trace: 2, span: 2, startMs: T0, durationMs: 1 }])) });
      expect(store.prune(T0).spans).toEqual({ aged: 1, capped: 0 });
      expect(store.sizes().spans.rows).toBe(1);
      expect(store.prune(T0).spans).toEqual({ aged: 0, capped: 0 });
    } finally {
      store.close();
    }
  });

  it("stops a prune after its budget of deletes, and ends it in the next prune", () => {
    const store = openStore(":memory:", { batch: 2 });
    try {
      const old = T0 - DEFAULT_RETENTION.spans.maxAgeMs - MINUTE;
      store.insert({ spans: spanRows(traces(Array.from({ length: 5 }, (_, i) => ({ trace: i + 1, span: 1, startMs: old + i, durationMs: 1 })))) });
      expect(store.prune(T0, 2)).toMatchObject({ spans: { aged: 4, capped: 0 }, done: false });
      // a check of each signal is one delete, also when it deletes nothing: thus 2 deletes do not reach the three signals
      expect(store.prune(T0, 2)).toMatchObject({ spans: { aged: 1, capped: 0 }, done: false });
      expect(store.prune(T0, 3)).toMatchObject({ spans: { aged: 0, capped: 0 }, done: true });
      expect(store.sizes().spans.rows).toBe(0);
      expect(() => store.prune(T0, 0)).toThrow(RangeError);
    } finally {
      store.close();
    }
  });

  it("holds the size of each signal at its cap at each insert, and deletes the oldest rows first", () => {
    const rules: RetentionRules = { ...DEFAULT_RETENTION, spans: { maxAgeMs: DEFAULT_RETENTION.spans.maxAgeMs, maxBytes: 4000 } };
    const store = openStore(":memory:", { rules, batch: 7 });
    try {
      for (let i = 0; i < 20; i++) {
        const batch = Array.from({ length: 10 }, (_, j) => ({ trace: i * 10 + j + 1, span: 1, startMs: T0 + (i * 10 + j) * 1000, durationMs: 1 }));
        store.insert({ spans: spanRows(traces(batch)) });
        expect(store.sizes().spans.bytes).toBeLessThanOrEqual(4000);
      }
      const oldest = Number(store.db.prepare("SELECT MIN(start_ns) / 1000000 AS t FROM spans").get()?.["t"]);
      const kept = store.sizes().spans.rows;
      expect(kept).toBeGreaterThan(0);
      // the kept rows are the newest: the last row is at T0 + 199 s
      expect(oldest).toBe(T0 + (200 - kept) * 1000);
    } finally {
      store.close();
    }
  });

  it("keeps its rows in a file across a close and an open", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const folder = mkdtempSync(join(tmpdir(), "otel-sink-"));
    try {
      const path = join(folder, "deep", "sink.db");
      const first = openStore(path);
      first.insert({ spans: spanRows(traces([{ trace: 1, span: 1, startMs: T0, durationMs: 1 }])) });
      first.close();
      first.close();
      const second = openStore(path);
      expect(second.sizes().spans.rows).toBe(1);
      expect(second.fileBytes()).toBeGreaterThan(0);
      second.close();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("the queries", () => {
  const filled = () => {
    const store = openStore(":memory:");
    store.insert({
      spans: spanRows(
        traces([
          { trace: 1, span: 1, startMs: T0, durationMs: 900, name: "GET /slow" },
          { trace: 1, span: 2, parent: 1, startMs: T0 + 10, durationMs: 800, name: "SELECT", service: "db" },
          { trace: 2, span: 3, startMs: T0 + 20, durationMs: 30, error: true, name: "POST /pay" },
          { trace: 3, span: 4, startMs: T0 - 2 * 60 * MINUTE, durationMs: 5000, name: "GET /old" },
        ]),
      ),
      logs: logRows(
        logs([
          { timeMs: T0 + 25, severity: 17, body: "the payment failed", trace: 2 },
          { timeMs: T0 + 5, severity: 9, body: "a request", trace: 1 },
        ]),
      ),
    });
    return store;
  };
  const window = { sinceMs: T0 - MINUTE, limit: 10 };

  it("give the slowest spans of the window, the slowest first, with a service filter", () => {
    const store = filled();
    try {
      expect(slowest(store.db, window).map((span) => [span.name, span.durationMs])).toEqual([
        ["GET /slow", 900],
        ["SELECT", 800],
        ["POST /pay", 30],
      ]);
      expect(slowest(store.db, { ...window, service: "db" }).map((span) => span.name)).toEqual(["SELECT"]);
      expect(slowest(store.db, { ...window, limit: 1 })[0]?.startMs).toBe(T0);
    } finally {
      store.close();
    }
  });

  it("give the failed spans and the error logs, and one trace with its logs in order", () => {
    const store = filled();
    try {
      const found = errors(store.db, window);
      expect(found.spans.map((span) => span.name)).toEqual(["POST /pay"]);
      expect(found.logs.map((log) => [log.body, log.traceId])).toEqual([["the payment failed", traceId(2)]]);
      const one = trace(store.db, traceId(1).toUpperCase());
      expect(one.spans.map((span) => [span.name, span.parentId])).toEqual([
        ["GET /slow", null],
        ["SELECT", "0000000000000001"],
      ]);
      expect(one.logs.map((log) => log.body)).toEqual(["a request"]);
      expect(one.spans[0]?.attributes).toEqual({ "http.response.status_code": 200 });
    } finally {
      store.close();
    }
  });

  it("give the counts of each service, the most failed first", () => {
    const store = filled();
    try {
      expect(services(store.db, window)).toEqual([
        { service: "api", spans: 2, failed: 1, errorRate: 0.5, slowestMs: 900 },
        { service: "db", spans: 1, failed: 0, errorRate: 0, slowestMs: 800 },
      ]);
    } finally {
      store.close();
    }
  });

  it("refuse a window with a bad time or a bad limit", () => {
    expect(windowProblems(window)).toEqual([]);
    expect(windowProblems({ sinceMs: Number.NaN, limit: 0 })).toHaveLength(2);
    expect(windowProblems({ sinceMs: 0, limit: 1001 })).toHaveLength(1);
  });
});

describe("the endpoint of the telemetry of the sink", () => {
  it("is not the receiver of the sink", () => {
    expect(isOwnEndpoint("http://127.0.0.1:4318", 4318)).toBe(true);
    expect(isOwnEndpoint("http://localhost:4318/v1/traces", 4318)).toBe(true);
    expect(isOwnEndpoint("http://[::1]:4318", 4318)).toBe(true);
    expect(isOwnEndpoint("http://localhost", 80)).toBe(true);
    expect(isOwnEndpoint("http://collector:4318", 4318)).toBe(false);
    expect(isOwnEndpoint("http://127.0.0.1:4317", 4318)).toBe(false);
    expect(isOwnEndpoint(undefined, 4318)).toBe(false);
    expect(isOwnEndpoint("not a url", 4318)).toBe(false);
  });
});

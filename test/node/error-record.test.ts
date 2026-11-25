import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { context, logs, ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import { defineContextKeys, withContext } from "../../src/context.js";
import {
  ERROR_RECORD_FORMAT,
  MAX_ERROR_CAUSES,
  errorLogAttributes,
  errorRecord,
  errorRecordText,
  reportError,
} from "../../src/error-record.js";

defineContextKeys({
  "e.session.id": { cardinality: "high", propagate: "internal" },
  "e.page": { cardinality: "low", propagate: "internal" },
});

const spans = new InMemorySpanExporter();
const tracerProvider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] });
const tracer = tracerProvider.getTracer("test");
const records = new InMemoryLogRecordExporter();
const loggerProvider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter: records })] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncContextManager().enable());
  logs.setGlobalLoggerProvider(loggerProvider);
});

afterAll(async () => {
  await loggerProvider.shutdown();
  await tracerProvider.shutdown();
  logs.disable();
  context.disable();
});

describe("errorRecord", () => {
  it("holds the trace, the span and the context keys of the active context, after an await", async () => {
    const record = await withContext({ "e.session.id": "s-1", "e.page": "inbox" }, () =>
      tracer.startActiveSpan("load", async (span) => {
        await null;
        const made = errorRecord(new Error("the inbox did not load"), { procedure: { name: "fleet.inbox.list", inputDigest: "sha256:ab" } });
        span.end();
        return { made, ids: span.spanContext() };
      }),
    );

    expect(record.made).toMatchObject({
      format: ERROR_RECORD_FORMAT,
      name: "Error",
      message: "the inbox did not load",
      traceId: record.ids.traceId,
      spanId: record.ids.spanId,
      sampled: true,
      context: { "e.session.id": "s-1", "e.page": "inbox" },
      procedure: { name: "fleet.inbox.list", inputDigest: "sha256:ab" },
    });
    expect(record.made.id).toMatch(/^[0-9a-f]{32}$/);
    expect(Date.parse(record.made.at)).not.toBeNaN();
  });

  it("has no trace id outside a span, and stays plain JSON", () => {
    const record = errorRecord("a bare text", { from: ROOT_CONTEXT, at: new Date("2026-11-25T18:00:00Z"), id: "r-1" });

    expect(record).toEqual({
      format: ERROR_RECORD_FORMAT,
      id: "r-1",
      at: "2026-11-25T18:00:00.000Z",
      name: "string",
      message: "a bare text",
      causes: [{ name: "string", message: "a bare text" }],
      context: {},
    });
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  it("follows the cause chain and the errors of an AggregateError, depth first", () => {
    const reset = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const error = new Error("the call failed", { cause: new AggregateError([reset, new TypeError("bad body")], "two tries failed") });

    const record = errorRecord(error);

    expect(record.causes).toEqual([
      { name: "Error", message: "the call failed" },
      { name: "AggregateError", message: "two tries failed", via: "cause" },
      { name: "Error", message: "socket hang up", code: "ECONNRESET", via: "errors[0]" },
      { name: "TypeError", message: "bad body", via: "errors[1]" },
    ]);
  });

  it("stops at a loop and at the limit of causes", () => {
    const loop = new Error("a");
    (loop as { cause?: unknown }).cause = loop;
    expect(errorRecord(loop).causes).toHaveLength(1);

    let deep: Error = new Error("0");
    for (let i = 1; i < 20; i++) deep = new Error(String(i), { cause: deep });
    const causes = errorRecord(deep).causes;
    expect(causes).toHaveLength(MAX_ERROR_CAUSES);
    expect(causes.at(-1)?.name).toBe("CauseLimit");
  });

  it("never throws for a value with a throwing getter", () => {
    const hostile = new Error("x");
    Object.defineProperty(hostile, "cause", {
      get() {
        throw new Error("no");
      },
    });
    Object.defineProperty(hostile, "name", {
      get() {
        throw new Error("no");
      },
    });

    expect(() => errorRecord(hostile)).not.toThrow();
    expect(errorRecord(hostile).causes).toEqual([{ name: "Error", message: "x" }]);
  });

  it("keeps the stack only when asked", () => {
    expect(errorRecord(new Error("s")).causes[0]?.stack).toBeUndefined();
    expect(errorRecord(new Error("s"), { stacks: true }).causes[0]?.stack).toContain("error-record.test");
  });

  it("removes the secrets from the message, the context and the attributes", () => {
    const token = "ghp_" + "a".repeat(36);
    const record = errorRecord(new Error(`fetch https://api.example.com/?access_token=${token} failed`), {
      attributes: { header: `Authorization: Bearer ${token}`, tries: 3 },
    });

    expect(JSON.stringify(record)).not.toContain(token);
    expect(record.attributes?.["tries"]).toBe(3);
  });
});

describe("reportError", () => {
  it("emits one ERROR log record and marks the span, with the ids of the record", async () => {
    records.reset();
    spans.reset();

    const record = await withContext({ "e.session.id": "s-2" }, () =>
      tracer.startActiveSpan("save", async (span) => {
        await null;
        const made = reportError(new Error("the save failed"), { procedure: { name: "fleet.items.set" } });
        span.end();
        return made;
      }),
    );

    const [log] = records.getFinishedLogRecords();
    expect(log?.severityText).toBe("ERROR");
    expect(log?.body).toBe("fleet.items.set: the save failed");
    expect(log?.spanContext?.traceId).toBe(record.traceId);
    expect(log?.spanContext?.spanId).toBe(record.spanId);
    expect(log?.attributes).toEqual(errorLogAttributes(record));
    expect(log?.attributes["error.record.id"]).toBe(record.id);

    const [span] = spans.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events.map((event) => event.name)).toEqual(["exception"]);
  });

  it("returns the record with no SDK span, and does not throw", () => {
    expect(() => reportError(new Error("quiet"), { from: ROOT_CONTEXT, markSpan: true })).not.toThrow();
  });
});

describe("errorRecordText", () => {
  it("gives the message, the ids, the causes and the JSON of the record", () => {
    const record = errorRecord(new Error("top", { cause: new Error("root") }), {
      from: ROOT_CONTEXT,
      id: "r-2",
      at: new Date("2026-11-25T18:00:00Z"),
      procedure: { name: "alerts.feeds.poll", inputDigest: "sha256:cd" },
    });

    const text = errorRecordText(record);

    expect(text.split("\n").slice(0, 8)).toEqual([
      "Error: top",
      "",
      "Time: 2026-11-25T18:00:00.000Z",
      "Record: r-2",
      "Procedure: alerts.feeds.poll",
      "Input digest: sha256:cd",
      "Cause (cause): Error: root",
      "",
    ]);
    expect(JSON.parse(text.slice(text.indexOf("{")))).toEqual(record);
  });
});

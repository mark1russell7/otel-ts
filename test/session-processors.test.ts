import { describe, expect, it } from "vitest";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  createSessionLogRecordProcessor,
  createSessionSpanProcessor,
} from "../src/session-processors.js";

/** A session reader that rotates on every call: "session-1", "session-2", … */
function rotatingSession(): () => string {
  let calls = 0;
  return () => `session-${++calls}`;
}

describe("createSessionLogRecordProcessor", () => {
  async function emit(
    records: Array<{ body: string; attributes?: Record<string, string> }>,
  ) {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [
        createSessionLogRecordProcessor(rotatingSession()),
        new SimpleLogRecordProcessor(exporter),
      ],
    });
    const logger = provider.getLogger("test");

    for (const record of records) logger.emit(record);

    await provider.forceFlush();
    const finished = exporter.getFinishedLogRecords();
    await provider.shutdown();
    return finished;
  }

  it("sets session.id on each log record, read as it is emitted", async () => {
    const records = await emit([{ body: "first" }, { body: "second" }]);

    expect(records.map((record) => record.attributes["session.id"])).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("keeps a session.id the caller set", async () => {
    // e.g. a session.end event for the session that just ended
    const records = await emit([
      { body: "session.end", attributes: { "session.id": "previous" } },
    ]);

    expect(records[0]!.attributes["session.id"]).toBe("previous");
  });

  it("does not put session.id on the resource", async () => {
    const [record] = await emit([{ body: "first" }]);

    expect(record!.resource.attributes).not.toHaveProperty(["session.id"]);
  });
});

describe("createSessionSpanProcessor", () => {
  async function trace(
    spans: Array<{ name: string; attributes?: Record<string, string> }>,
  ) {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        createSessionSpanProcessor(rotatingSession()),
        new SimpleSpanProcessor(exporter),
      ],
    });
    const tracer = provider.getTracer("test");

    for (const { name, attributes } of spans) {
      tracer.startSpan(name, { attributes }).end();
    }

    await provider.forceFlush();
    const finished = exporter.getFinishedSpans();
    await provider.shutdown();
    return finished;
  }

  it("sets session.id on each span, read as it starts", async () => {
    const spans = await trace([{ name: "first" }, { name: "second" }]);

    expect(spans.map((span) => span.attributes["session.id"])).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("keeps a session.id the caller set", async () => {
    const spans = await trace([
      { name: "explicit", attributes: { "session.id": "previous" } },
    ]);

    expect(spans[0]!.attributes["session.id"]).toBe("previous");
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { faro } from "@grafana/faro-web-sdk";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { init } from "../src/index.js";
import type { OtelTsInstance } from "../src/index.js";
import { FakeExporter, exportedTo } from "./support/fake-exporter.js";

// Real Faro, real tracing and the real fetch instrumentation. Only the
// network is replaced: the trace exporter, and the fetch() that both wrap.
vi.mock("@opentelemetry/exporter-trace-otlp-http", async () => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return { OTLPTraceExporter: FakeExporter };
});

const collector = "https://faro.example.com/collect";
const api = () => `${location.origin}/api/orders`;

/** Each request that reached the network: its URL and its body */
const sent: Array<{ url: string; body: string }> = [];

let otel: OtelTsInstance | undefined;
let realFetch: typeof fetch;

/** Waits for a request to the collector with `text` in its body, and gives its body */
async function sentToCollector(text: string): Promise<string> {
  for (let i = 0; i < 150; i += 1) {
    const found = sent.find(
      (request) => request.url === collector && request.body.includes(text),
    );
    if (found) return found.body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no request to the collector with "${text}"`);
}

/** The exported spans of the requests to `url` */
async function spansOf(url: string): Promise<ReadableSpan[]> {
  // The fetch instrumentation ends a span up to 300 ms after the response,
  // when it found the resource timing of the request
  await new Promise((resolve) => setTimeout(resolve, 400));
  await otel?.forceFlush();
  return exportedTo<ReadableSpan>("/v1/traces").filter(
    (span) => span.attributes["url.full"] === url,
  );
}

// Faro has one instance for each page, so the tests share one init()
beforeAll(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, options?: RequestInit) => {
    const request = new Request(input, options);
    sent.push({ url: request.url, body: await request.text() });
    return new Response("{}", { status: 202 });
  };
  otel = init({
    faroCollectorUrl: collector,
    metrics: false,
    logs: false,
    instrumentDocumentLoad: false,
    instrumentUserInteraction: false,
    instrumentXhr: false,
    instrumentLongTask: false,
  });
});

afterAll(async () => {
  await otel?.shutdown();
  globalThis.fetch = realFetch;
  FakeExporter.instances.length = 0;
  trace.disable();
  context.disable();
  propagation.disable();
  sessionStorage.clear();
});

describe("Faro with the tracing of otel-ts", () => {
  it("makes one span for each fetch()", async () => {
    // Before, the TracingInstrumentation of Faro wrapped fetch() a second
    // time, with the tracer provider of otel-ts: two spans for each request
    await fetch(api());

    expect(await spansOf(api())).toHaveLength(1);
  });

  it("uses the context of otel-ts: a Faro error has the trace of its span", async () => {
    const tracer = trace.getTracer("test");
    const traceId = tracer.startActiveSpan("checkout", (span) => {
      faro.api.pushError(new Error("payment refused"));
      span.end();
      return span.spanContext().traceId;
    });

    const body = await sentToCollector("payment refused");

    expect(body).toContain(`"trace_id":"${traceId}"`);
  });

  it("makes no span for the requests of Faro to its collector", async () => {
    faro.api.pushLog(["a log of the app"]);
    await sentToCollector("a log of the app");

    expect(await spansOf(collector)).toHaveLength(0);
  });

  it("keeps fetch.__original, so an OTLP export makes no span", async () => {
    // The OTLP exporters send with fetch.__original. Faro wraps fetch()
    // again (its request monitor), and before, its wrapper had no __original
    const wrapped = globalThis.fetch as typeof fetch & { __original?: typeof fetch };
    const exportUrl = `${location.origin}/v1/traces-of-the-test`;

    expect(typeof wrapped.__original).toBe("function");
    await wrapped.__original!(exportUrl, { method: "POST", body: "{}" });

    expect(sent.some((request) => request.url === exportUrl)).toBe(true);
    expect(await spansOf(exportUrl)).toHaveLength(0);
  });

  it("does not send traces to the Faro collector", async () => {
    await fetch(api());
    await otel?.forceFlush();
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // The traces go only through the OTLP exporter of otel-ts
    const bodies = sent.filter((request) => request.url === collector).map((request) => request.body);
    expect(bodies.some((body) => body.includes('"traces"'))).toBe(false);
  });
});

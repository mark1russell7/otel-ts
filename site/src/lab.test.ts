/**
 * These tests run the real `init()` through the real wire of the page: only the DOM comes from happy-dom. Thus they show
 * that the exporters of the package call the stub, and that the decoders of the page read what the package gives.
 */
import { context, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configText, labConfig, readOptions, startLab } from "./lab.ts";
import type { Lab } from "./lab.ts";
import { decodeFaro } from "./faro.ts";
import type { FaroItem } from "./faro.ts";
import { decodeLogs, decodeMetrics, decodeSpans } from "./otlp.ts";
import type { OtlpBody } from "./otlp.ts";
import { createStore } from "./store.ts";
import type { Capture } from "./store.ts";
import { COLLECTOR, createWire, FARO_COLLECTOR, isAt, OTHER_ORIGIN } from "./wire.ts";

const ORDER_URL = `${location.origin}/demo/order.json`;

describe("readOptions", () => {
  it("keeps the defaults of the package when the query has no option", () => {
    expect(readOptions("")).toEqual({ contextManager: "async", histogramAggregation: "explicit", metricsTemporality: "cumulative" });
  });

  it("reads each allowed value", () => {
    expect(readOptions("?contextManager=stack&histogramAggregation=exponential&metricsTemporality=delta")).toEqual({
      contextManager: "stack",
      histogramAggregation: "exponential",
      metricsTemporality: "delta",
    });
  });

  it("ignores a value that is not on the list", () => {
    expect(readOptions("?contextManager=evil").contextManager).toBe("async");
  });
});

describe("configText", () => {
  it("shows the collector URL and the options that the page passes to init()", () => {
    const text = configText(labConfig(readOptions("?metricsTemporality=delta"), "1.2.3"));
    expect(text).toContain(`endpoint: "${COLLECTOR}"`);
    expect(text).toContain(`faroCollectorUrl: "${FARO_COLLECTOR}"`);
    expect(text).toContain('metricsTemporality: "delta"');
    expect(text).toContain("metricsExportIntervalMs: 10000");
  });
});

describe("the wire", () => {
  it("answers the stand-in API with no network", async () => {
    const wire = createWire(() => Promise.reject(new Error("the network")));
    expect((await wire.fetch(`${OTHER_ORIGIN}/orders`)).status).toBe(200);
  });

  it("gives other requests to the network, and notes their traceparent", async () => {
    const seen: (string | undefined)[] = [];
    const wire = createWire(() => Promise.resolve(new Response("ok")));
    wire.onRequest((record) => seen.push(record.traceparent));
    await wire.fetch("https://site.example/file", { headers: { traceparent: "00-a-b-01" } });
    expect(seen).toEqual(["00-a-b-01"]);
  });

  it("gives the earlier exports to a late listener", async () => {
    const wire = createWire(() => Promise.reject(new Error("the network")));
    await wire.fetch(`${COLLECTOR}/v1/logs`, { method: "POST", body: new TextEncoder().encode("{}") });
    const late: number[] = [];
    wire.onExport((record) => late.push(record.id));
    expect(late).toEqual([1]);
  });

  it("takes a Faro request on the path of Faro, and gives it the lane faro", async () => {
    const wire = createWire(() => Promise.reject(new Error("the network")));
    const lanes: string[] = [];
    wire.onExport((record) => lanes.push(record.signal));
    const response = await wire.fetch(FARO_COLLECTOR, { method: "POST", body: '{"logs":[]}' });
    expect(response.status).toBe(200);
    expect(lanes).toEqual(["faro"]);
  });

  it("answers 404 to another path of the collector", async () => {
    const wire = createWire(() => Promise.reject(new Error("the network")));
    expect((await wire.fetch(`${COLLECTOR}/v1/profiles`, { method: "POST", body: "{}" })).status).toBe(404);
  });
});

describe("the store", () => {
  const record = (signal: "traces" | "logs", at: number) => ({ id: at, at, signal, url: "", method: "POST", headers: {}, bytes: 2, text: "{}", body: {} });

  it("gives the flush as the cause of an export right after it", () => {
    const store = createStore();
    store.noteFlush("flush button", 1000);
    expect(store.addExport(record("traces", 1100)).cause).toBe("flush button");
  });

  it("gives the batch timer as the cause of a later export", () => {
    const store = createStore();
    store.noteFlush("flush button", 1000);
    expect(store.addExport(record("traces", 5000)).cause).toBe("batch timer");
  });

  it("gives Faro as the cause of a Faro request, also right after a flush, and keeps its items", () => {
    const store = createStore();
    store.noteFlush("flush button", 1000);
    const body = { logs: [{ level: "info", message: "hello", timestamp: "2026-11-09T10:00:00.000Z", trace: { trace_id: "t1", span_id: "s1" } }] };
    const capture = store.addExport({ id: 1, at: 1100, signal: "faro", url: FARO_COLLECTOR, method: "POST", headers: {}, bytes: 2, text: "", body });
    expect(capture).toMatchObject({ cause: "Faro batch", records: 1 });
    expect(store.faro()).toMatchObject([{ kind: "log", text: "info: hello", traceId: "t1", spanId: "s1" }]);
    expect(store.totals()).toMatchObject({ faro: 1, exports: 1, logs: 0 });
  });
});

describe("the lab", () => {
  const captures: Capture[] = [];
  const realFetch = globalThis.fetch;
  const store = createStore();
  let lab: Lab;

  const otlp = (): OtlpBody[] => captures.flatMap((capture) => (capture.signal === "faro" ? [] : [capture.body]));
  const spans = () => otlp().flatMap(decodeSpans);
  const named = (name: string) => spans().filter((span) => span.name === name);
  const faroItems = (): FaroItem[] => captures.flatMap((capture) => (capture.signal === "faro" ? decodeFaro(capture.body) : []));
  /** Faro sends on its own timer, so this function waits for the item with the text. */
  const faroItem = async (text: string): Promise<FaroItem> => {
    for (let i = 0; i < 100; i += 1) {
      const found = faroItems().find((item) => item.text.includes(text));
      if (found !== undefined) return found;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`no Faro item with "${text}"`);
  };
  const flush = async () => {
    // The fetch instrumentation ends a span about 300 ms after the response.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await lab.otel.forceFlush();
  };

  beforeAll(() => {
    const wire = createWire(() => Promise.resolve(new Response('{"order":"A-1042"}', { status: 200 })));
    globalThis.fetch = wire.fetch;
    wire.onRequest((request) => store.addRequest(request));
    wire.onExport((record) => captures.push(store.addExport(record)));
    lab = startLab(labConfig(readOptions(""), "0.0.0"), ORDER_URL);
  });

  afterAll(async () => {
    await lab.otel.shutdown();
    globalThis.fetch = realFetch;
    trace.disable();
    context.disable();
    propagation.disable();
    logs.disable();
  });

  it("sends each signal to the path of the collector, as JSON", async () => {
    await lab.run("checkout");
    await flush();
    const exports = captures.filter((capture) => capture.signal !== "faro");
    expect(new Set(exports.map((capture) => new URL(capture.url).pathname))).toEqual(new Set(["/v1/traces", "/v1/metrics", "/v1/logs"]));
    expect(exports.every((capture) => capture.method === "POST" && capture.headers["content-type"] === "application/json")).toBe(true);
  });

  it("makes one span for each fetch, with Faro on", () => {
    // The checkout fetched the order once. The tracing of Faro made a second span before 0.7.0.
    expect(spans().filter((span) => span.attributes["url.full"] === ORDER_URL)).toHaveLength(1);
  });

  it("gives the Faro event of the checkout the IDs of its span", async () => {
    const event = await faroItem("order saved");
    expect(event.kind).toBe("event");
    expect(event.spanId).toBe(named("save the order")[0]?.spanId);
    expect(event.traceId).toBe(named("checkout")[0]?.traceId);
  });

  it("makes no span for an export or a request of Faro", async () => {
    await faroItem("order saved");
    expect(captures.some((capture) => capture.url === FARO_COLLECTOR)).toBe(true);
    expect(spans().filter((span) => isAt(String(span.attributes["url.full"]), COLLECTOR))).toEqual([]);
  });

  it("keeps the checkout span across the timers and the then callback", () => {
    const root = named("checkout")[0];
    expect(root).toBeDefined();
    expect(named("price the cart")[0]?.parentSpanId).toBe(root?.spanId);
    expect(named("save the order")[0]?.parentSpanId).toBe(root?.spanId);
    expect(named("GET")[0]?.parentSpanId).toBe(root?.spanId);
  });

  it("gives the log record of the checkout the IDs of its span", () => {
    const record = otlp().flatMap(decodeLogs).find((log) => log.body === "The order is saved");
    expect(record?.spanId).toBe(named("save the order")[0]?.spanId);
    expect(record?.traceId).toBe(named("checkout")[0]?.traceId);
  });

  it("puts the fetch span ID into the traceparent of the request", () => {
    const fetchSpan = named("GET")[0];
    if (fetchSpan === undefined) throw new Error("no fetch span");
    expect(store.requestOf(fetchSpan)?.traceparent).toBe(`00-${fetchSpan.traceId}-${fetchSpan.spanId}-01`);
  });

  it("records the counter and the histogram of the action", () => {
    const points = otlp().flatMap(decodeMetrics);
    expect(points.find((point) => point.name === "demo.actions")).toMatchObject({ type: "sum", temporality: "cumulative", value: 1, attributes: { action: "checkout" } });
    expect(points.find((point) => point.name === "demo.action.duration")).toMatchObject({ type: "histogram", unit: "ms", count: 1 });
  });

  it("sends no traceparent to another origin", async () => {
    await lab.run("other-origin");
    await flush();
    const span = spans().find((item) => item.attributes["url.full"] === `${OTHER_ORIGIN}/orders`);
    if (span === undefined) throw new Error("no span of the other origin");
    expect(store.requestOf(span)).toMatchObject({ stubbed: true, traceparent: undefined });
  });

  it("catches the error of the failed job, and exports the span with the status ERROR", async () => {
    await context.with(context.active(), () =>
      trace.getTracer("test").startActiveSpan("click", (click) =>
        lab.run("failed-job").then((result) => {
          click.end();
          expect(result).toContain("failed");
        }),
      ),
    );
    await flush();
    const [job] = named("payment job");
    expect(job).toMatchObject({ kind: "consumer", status: "error" });
    expect(job?.events[0]?.attributes["exception.message"]).toBe("The payment job failed on purpose");
    expect(job?.parentSpanId).toBe(named("click")[0]?.spanId);
  });

  it("gives the Faro error of the failed job the IDs of the click span", async () => {
    const error = await faroItem("The payment job failed on purpose");
    expect(error.kind).toBe("exception");
    expect(error.spanId).toBe(named("click")[0]?.spanId);
    expect(error.traceId).toBe(named("click")[0]?.traceId);
  });

  it("gives each span the session ID, and the resource the instance ID", () => {
    const [span] = spans();
    expect(span?.attributes["session.id"]).toBe(lab.otel.getSessionId());
    expect(span?.resource["session.id"]).toBeUndefined();
    expect(typeof span?.resource["service.instance.id"]).toBe("string");
  });
});

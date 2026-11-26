import { afterEach, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { startNodeContext, type NodeContext } from "../../src/node-context.js";
import { exportSpanProcessors } from "../../src/node-export.js";
import { startStubCollector, type StubCollector } from "../../src/node-testing.js";

let started: NodeContext | undefined;
let collector: StubCollector | undefined;

afterEach(async () => {
  await started?.shutdown();
  started = undefined;
  await collector?.close();
  collector = undefined;
  vi.unstubAllEnvs();
});

describe("exportSpanProcessors", () => {
  it("gives no processor with no endpoint and no exporter", () => {
    expect(exportSpanProcessors({ env: {} })).toEqual([]);
  });

  it("gives no processor when OTEL_TRACES_EXPORTER is none", () => {
    expect(exportSpanProcessors({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318", OTEL_TRACES_EXPORTER: "none" } })).toEqual([]);
  });

  it("refuses an exporter name that it does not make", () => {
    expect(() => exportSpanProcessors({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318", OTEL_TRACES_EXPORTER: "zipkin" } })).toThrow(RangeError);
  });

  it("exports the spans of startNodeContext to the endpoint of the variables, and the stop flushes them", async () => {
    collector = await startStubCollector();
    // The OTLP exporter reads its endpoint from process.env. The stub collector reads OTLP/HTTP JSON.
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.endpoint);
    const env = { OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint, OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" };
    started = startNodeContext({ serviceName: "otel-ts-export-test", env: {}, spanProcessors: exportSpanProcessors({ env }) });

    trace.getTracer("otel-ts-export-scope").startSpan("work").end();
    await started.shutdown();
    started = undefined;

    expect(collector.spansByScope().get("otel-ts-export-scope")).toEqual(new Set(["work"]));
  });

  it("exports to the exporter of the options, also with no endpoint", async () => {
    collector = await startStubCollector();
    const exporter = new OTLPTraceExporter({ url: `${collector.endpoint}/v1/traces` });
    started = startNodeContext({ env: {}, spanProcessors: exportSpanProcessors({ env: {}, exporter }) });

    trace.getTracer("otel-ts-export-own").startSpan("own").end();
    await started.shutdown();
    started = undefined;

    expect(collector.spansByScope().get("otel-ts-export-own")).toEqual(new Set(["own"]));
  });
});

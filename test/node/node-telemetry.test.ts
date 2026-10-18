import { afterEach, describe, expect, it } from "vitest";
import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { startNodeTelemetry, type NodeTelemetry } from "../../src/node.js";
import { startStubCollector, type StubCollector } from "../../src/node-testing.js";

let telemetry: NodeTelemetry | undefined;
let collector: StubCollector | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  await collector?.close();
  telemetry = undefined;
  collector = undefined;
});

describe("startNodeTelemetry", () => {
  it("starts nothing when OTEL_EXPORTER_OTLP_ENDPOINT has no value", async () => {
    telemetry = startNodeTelemetry({ env: {}, importMetaUrl: import.meta.url });
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.esmHook).toBe(false);
    await telemetry.shutdown();
  });

  it("exports the spans to the collector of the endpoint", async () => {
    collector = await startStubCollector();
    telemetry = startNodeTelemetry({
      serviceName: "otel-ts-node-test",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint },
      traceExporter: new OTLPTraceExporter({ url: `${collector.endpoint}/v1/traces` }),
      stopOnSignals: false,
    });
    expect(telemetry.enabled).toBe(true);
    expect(telemetry.esmHook).toBe(false);

    trace.getTracer("otel-ts-node-test-scope").startSpan("work").end();
    await telemetry.shutdown(); // the stop flushes the spans

    expect(collector.exports).toBeGreaterThan(0);
    expect(collector.spansByScope().get("otel-ts-node-test-scope")).toEqual(new Set(["work"]));
    expect(collector.has(["otel-ts-node-test-scope"])).toBe(true);
    expect(collector.missing(["otel-ts-node-test-scope", "absent-scope"])).toEqual(["absent-scope"]);
  });

  it("does nothing at a second stop", async () => {
    collector = await startStubCollector();
    telemetry = startNodeTelemetry({
      enabled: true,
      env: {},
      traceExporter: new OTLPTraceExporter({ url: `${collector.endpoint}/v1/traces` }),
      stopOnSignals: false,
    });
    await telemetry.shutdown();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});

describe("startStubCollector", () => {
  it("gives the scopes that are still missing when the time is up", async () => {
    collector = await startStubCollector();
    let pokes = 0;
    const missing = await collector.waitFor(["absent-scope"], {
      timeoutMs: 300,
      intervalMs: 50,
      poke: async () => {
        pokes++;
      },
    });
    expect(missing).toEqual(["absent-scope"]);
    expect(pokes).toBeGreaterThan(1);
  });

  it("answers an export that is not JSON, and counts it", async () => {
    collector = await startStubCollector();
    const res = await fetch(`${collector.endpoint}/v1/traces`, { method: "POST", body: "\u0000binary" });
    expect(res.status).toBe(200);
    expect(collector.exports).toBe(1);
    expect(collector.spansByScope().size).toBe(0);
  });
});

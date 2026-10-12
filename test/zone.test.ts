// The opt-in entry first, as the README tells
import "../src/zone.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { context, propagation, trace, type Span } from "@opentelemetry/api";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { createContextManager } from "../src/context-manager.js";
import { init } from "../src/index.js";
import type { OtelTsInstance } from "../src/index.js";
import { FakeExporter } from "./support/fake-exporter.js";

vi.mock("@opentelemetry/exporter-trace-otlp-http", async () => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return { OTLPTraceExporter: FakeExporter };
});

let otel: OtelTsInstance | undefined;

afterEach(async () => {
  await otel?.shutdown();
  otel = undefined;
  FakeExporter.instances.length = 0;
  trace.disable();
  context.disable();
  propagation.disable();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("@mark1russell7/otel-ts/zone", () => {
  it("loads zone.js", () => {
    expect("Zone" in globalThis).toBe(true);
  });

  it('lets createContextManager() make the ZoneContextManager for "zone"', () => {
    expect(createContextManager("zone")).toBeInstanceOf(ZoneContextManager);
  });

  it('lets init() register the ZoneContextManager for contextManager: "zone"', () => {
    const registered = vi.spyOn(context, "setGlobalContextManager");

    otel = init({ contextManager: "zone", faro: false, metrics: false, logs: false });

    expect(registered).toHaveBeenCalledOnce();
    expect(registered.mock.lastCall![0]).toBeInstanceOf(ZoneContextManager);
  });

  it("keeps the active span in a setTimeout callback with zone", async () => {
    otel = init({ contextManager: "zone", faro: false, metrics: false, logs: false });

    let parent!: Span;
    const seen = await new Promise<Span | undefined>((resolve) => {
      trace.getTracer("test").startActiveSpan("parent", (span) => {
        parent = span;
        setTimeout(() => resolve(trace.getActiveSpan()), 0);
        span.end();
      });
    });

    expect(seen).toBe(parent);
  });

  it("does not change the default", () => {
    const registered = vi.spyOn(context, "setGlobalContextManager");

    otel = init({ faro: false, metrics: false, logs: false });

    expect(registered.mock.lastCall![0]).not.toBeInstanceOf(ZoneContextManager);
  });
});

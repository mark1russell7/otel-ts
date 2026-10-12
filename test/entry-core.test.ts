import { afterEach, describe, expect, it, vi } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { init } from "../src/core.js";
import type { ContextManagerOption, OtelTsConfig, OtelTsInstance } from "../src/core.js";
import { unavailableMessage } from "../src/context-manager.js";
import { FakeExporter } from "./support/fake-exporter.js";
import { activeSpanIn, inListener, inThen, inTimeout } from "./support/active-span.js";

// @mark1russell7/otel-ts/core: no context library
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

function start(contextManager?: ContextManagerOption): void {
  otel = init({ faro: false, metrics: false, logs: false, contextManager });
}

/** The manager that init() registered */
function registered(): unknown {
  return vi.mocked(context.setGlobalContextManager).mock.lastCall?.[0];
}

describe("@mark1russell7/otel-ts/core", () => {
  it("does not load zone.js", () => {
    expect("Zone" in globalThis).toBe(false);
  });

  it("registers the StackContextManager by default", () => {
    vi.spyOn(context, "setGlobalContextManager");

    start();

    expect(registered()).toBeInstanceOf(StackContextManager);
  });

  it("keeps the active span only in synchronous code by default", async () => {
    start();

    for (const callback of [inTimeout, inThen, inListener()]) {
      const { seen } = await activeSpanIn(...callback);
      expect(seen).toBeUndefined();
    }
  });

  it("registers a ContextManager of the app", () => {
    vi.spyOn(context, "setGlobalContextManager");
    const manager = new StackContextManager();

    start(manager);

    expect(registered()).toBe(manager);
  });

  it('throws for "async" and "zone", and tells which entry has each', () => {
    for (const name of ["async", "zone"] as const) {
      // Not in the type of this entry, but a JavaScript app can give it
      const config = { contextManager: name } as unknown as OtelTsConfig;
      expect(() => (otel = init(config))).toThrow(unavailableMessage(name, "core"));
    }
  });
});

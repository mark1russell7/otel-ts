import { afterEach, describe, expect, it, vi } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { init } from "../src/zone.js";
import type { ContextManagerOption, OtelTsConfig, OtelTsInstance } from "../src/zone.js";
import { unavailableMessage } from "../src/context-manager.js";
import { FakeExporter } from "./support/fake-exporter.js";
import { activeSpanIn, inListener, inThen, inTimeout } from "./support/active-span.js";

// @mark1russell7/otel-ts/zone: zone.js, never async-browser-context
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

describe("@mark1russell7/otel-ts/zone", () => {
  it("loads zone.js", () => {
    expect("Zone" in globalThis).toBe(true);
  });

  it("registers the ZoneContextManager by default", () => {
    vi.spyOn(context, "setGlobalContextManager");

    start();

    expect(registered()).toBeInstanceOf(ZoneContextManager);
  });

  it("keeps the active span in timer, then and event listener callbacks by default", async () => {
    start();

    for (const callback of [inTimeout, inThen, inListener()]) {
      const { parent, seen } = await activeSpanIn(...callback);
      expect(seen).toBe(parent);
    }
  });

  it('registers the StackContextManager for "stack"', () => {
    vi.spyOn(context, "setGlobalContextManager");

    start("stack");

    expect(registered()).toBeInstanceOf(StackContextManager);
  });

  it("registers a ContextManager of the app", () => {
    vi.spyOn(context, "setGlobalContextManager");
    const manager = new StackContextManager();

    start(manager);

    expect(registered()).toBe(manager);
  });

  it('throws for "async", and tells to import init from the main entry', () => {
    // Not in the type of this entry, but a JavaScript app can give it
    const config = { contextManager: "async" } as unknown as OtelTsConfig;

    expect(() => (otel = init(config))).toThrow(unavailableMessage("async", "zone"));
  });
});

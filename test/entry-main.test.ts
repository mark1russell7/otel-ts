import { afterEach, describe, expect, it, vi } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { init } from "../src/index.js";
import type { ContextManagerOption, OtelTsConfig, OtelTsInstance } from "../src/index.js";
import { unavailableMessage } from "../src/context-manager.js";
import { FakeExporter } from "./support/fake-exporter.js";
import { activeSpanIn, inListener, inThen, inTimeout } from "./support/active-span.js";

// @mark1russell7/otel-ts, with real providers and the real context managers;
// only the network layer is replaced. This project resolves
// async-browser-context to its browser runtime (vitest.config.ts), as a
// browser does.
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

/** Starts otel-ts with real tracing and the default instrumentations */
function start(contextManager?: ContextManagerOption): void {
  otel = init({ faro: false, metrics: false, logs: false, contextManager });
}

/** The manager that init() registered */
function registered(): unknown {
  return vi.mocked(context.setGlobalContextManager).mock.lastCall?.[0];
}

describe("@mark1russell7/otel-ts: the default context manager", () => {
  it("is the AsyncContextManager of async-browser-context", () => {
    vi.spyOn(context, "setGlobalContextManager");

    start();

    expect(registered()).toBeInstanceOf(AsyncContextManager);
  });

  it("keeps the active span in a setTimeout callback", async () => {
    start();

    const { parent, seen } = await activeSpanIn(...inTimeout);

    expect(seen).toBe(parent);
  });

  it("keeps the active span in a Promise.then callback", async () => {
    start();

    const { parent, seen } = await activeSpanIn(...inThen);

    expect(seen).toBe(parent);
  });

  it("keeps the active span in an event listener", async () => {
    start();

    // The listener gets the span of the addEventListener() call
    const { parent, seen } = await activeSpanIn(...inListener());

    expect(seen).toBe(parent);
  });
});

describe('@mark1russell7/otel-ts: contextManager: "stack"', () => {
  it("registers the StackContextManager", () => {
    vi.spyOn(context, "setGlobalContextManager");

    start("stack");

    expect(registered()).toBeInstanceOf(StackContextManager);
  });

  it("loses the active span in timer, then and event listener callbacks", async () => {
    start("stack");

    for (const callback of [inTimeout, inThen, inListener()]) {
      const { seen } = await activeSpanIn(...callback);
      expect(seen).toBeUndefined();
    }
  });
});

describe("@mark1russell7/otel-ts: other values", () => {
  it("registers a ContextManager of the app", () => {
    vi.spyOn(context, "setGlobalContextManager");
    const manager = new StackContextManager();

    start(manager);

    expect(registered()).toBe(manager);
  });

  it('throws for "zone", and tells to import init from the zone entry', () => {
    // Not in the type of this entry, but a JavaScript app can give it
    const config = { contextManager: "zone" } as unknown as OtelTsConfig;

    expect(() => (otel = init(config))).toThrow(unavailableMessage("zone", "main"));
    expect(unavailableMessage("zone", "main")).toContain(
      'Import init from "@mark1russell7/otel-ts/zone"',
    );
  });

  it("does not load zone.js", () => {
    expect("Zone" in globalThis).toBe(false);
  });
});

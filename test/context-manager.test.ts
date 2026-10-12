import { afterEach, describe, expect, it } from "vitest";
import {
  ROOT_CONTEXT,
  context,
  propagation,
  trace,
  type ContextManager,
} from "@opentelemetry/api";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import { createContextManager, ZONE_NOT_LOADED } from "../src/context-manager.js";
import { init } from "../src/index.js";
import type { OtelTsInstance } from "../src/index.js";

// This file never imports the zone entry: "zone" must fail, and the main
// entry must not load zone.js

let otel: OtelTsInstance | undefined;

afterEach(async () => {
  await otel?.shutdown();
  otel = undefined;
  trace.disable();
  context.disable();
  propagation.disable();
  sessionStorage.clear();
});

describe("createContextManager", () => {
  it("makes the manager of async-browser-context for async", () => {
    expect(createContextManager("async")).toBeInstanceOf(AsyncContextManager);
  });

  it("makes the stack manager for stack", () => {
    expect(createContextManager("stack")).toBeInstanceOf(StackContextManager);
  });

  it("gives back a manager of the app", () => {
    const manager: ContextManager = {
      active: () => ROOT_CONTEXT,
      with: (_context, fn, thisArg, ...args) => fn.apply(thisArg, args),
      bind: (_context, target) => target,
      enable() { return this; },
      disable() { return this; },
    };
    expect(createContextManager(manager)).toBe(manager);
  });

  it("throws for zone without the zone entry, and the error tells what to import", () => {
    expect(() => createContextManager("zone")).toThrow(ZONE_NOT_LOADED);
    expect(ZONE_NOT_LOADED).toContain('import "@mark1russell7/otel-ts/zone";');
  });
});

describe("the main entry without the zone entry", () => {
  it("does not load zone.js", () => {
    expect("Zone" in globalThis).toBe(false);
  });

  it("makes init() throw for zone, before it stores a session", () => {
    expect(() => (otel = init({ contextManager: "zone" }))).toThrow(
      ZONE_NOT_LOADED,
    );
    expect(sessionStorage.length).toBe(0);
  });

  it("does not need zone.js for zone when tracing is off", () => {
    expect(() => {
      otel = init({
        contextManager: "zone",
        tracing: false,
        metrics: false,
        logs: false,
        faro: false,
      });
    }).not.toThrow();
  });
});

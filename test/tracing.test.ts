import { describe, expect, it } from "vitest";
import { ROOT_CONTEXT, type ContextManager } from "@opentelemetry/api";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { createContextManager } from "../src/tracing.js";

describe("createContextManager", () => {
  it("makes the Zone.js manager for zone and the stack manager for stack", () => {
    expect(createContextManager("zone")).toBeInstanceOf(ZoneContextManager);
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
});

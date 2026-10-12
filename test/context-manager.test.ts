import { describe, expect, it } from "vitest";
import { ROOT_CONTEXT, type ContextManager } from "@opentelemetry/api";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import {
  createContextManager,
  createStackContextManager,
  unavailableMessage,
  type EntryContextManagers,
} from "../src/context-manager.js";

/** A context manager of the app */
function appManager(): ContextManager {
  return {
    active: () => ROOT_CONTEXT,
    with: (_context, fn, thisArg, ...args) => fn.apply(thisArg, args),
    bind: (_context, target) => target,
    enable() { return this; },
    disable() { return this; },
  };
}

const core: EntryContextManagers = {
  entry: "core",
  defaultName: "stack",
  factories: { stack: createStackContextManager },
};

describe("createContextManager", () => {
  it("makes the manager of a name that the entry has", () => {
    expect(createContextManager("stack", core)).toBeInstanceOf(StackContextManager);
  });

  it("gives back a manager of the app", () => {
    const manager = appManager();
    expect(createContextManager(manager, core)).toBe(manager);
  });

  it("throws for a name that the entry does not have", () => {
    expect(() => createContextManager("zone", core)).toThrow(
      unavailableMessage("zone", "core"),
    );
    expect(() => createContextManager("async", core)).toThrow(
      unavailableMessage("async", "core"),
    );
  });

  it("throws for an unknown name, also for a name of Object.prototype", () => {
    for (const name of ["zones", "constructor"]) {
      expect(() => createContextManager(name as "stack", core)).toThrow(
        `[otel-ts] Unknown contextManager "${name}".`,
      );
    }
  });
});

describe("unavailableMessage", () => {
  it('tells to use the zone entry for "zone" in the main entry, and why', () => {
    const message = unavailableMessage("zone", "main");

    expect(message).toContain('"@mark1russell7/otel-ts"');
    expect(message).toContain("This entry loads async-browser-context");
    expect(message).toContain("cannot share a page");
    expect(message).toContain(
      'Import init from "@mark1russell7/otel-ts/zone" in place of "@mark1russell7/otel-ts".',
    );
  });

  it('tells to use the main entry for "async" in the zone entry', () => {
    const message = unavailableMessage("async", "zone");

    expect(message).toContain("This entry loads zone.js");
    expect(message).toContain(
      'Import init from "@mark1russell7/otel-ts" in place of "@mark1russell7/otel-ts/zone".',
    );
  });

  it("tells which entry has the manager, for the core entry", () => {
    expect(unavailableMessage("async", "core")).toContain(
      'This entry loads no context library. Import init from "@mark1russell7/otel-ts" in place of "@mark1russell7/otel-ts/core".',
    );
    expect(unavailableMessage("zone", "core")).toContain(
      'Import init from "@mark1russell7/otel-ts/zone" in place of "@mark1russell7/otel-ts/core".',
    );
  });
});

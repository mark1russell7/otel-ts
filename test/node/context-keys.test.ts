import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { context, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import { W3CBaggagePropagator } from "@opentelemetry/core";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import {
  contextKeyRule,
  contextValue,
  contextValues,
  contextWith,
  defineContextKeys,
  isInternalCall,
  withContext,
  withInternalCall,
} from "../../src/context.js";

// The registry of keys is global, so each test uses keys of its own: "t<n>.<name>"

beforeAll(() => {
  // On Node.js, async-browser-context resolves to its AsyncLocalStorage manager
  context.setGlobalContextManager(new AsyncContextManager().enable());
  propagation.setGlobalPropagator(new W3CBaggagePropagator());
});

afterAll(() => {
  context.disable();
  propagation.disable();
});

describe("defineContextKeys", () => {
  it("fills in the default maxLength and gives typed calls", () => {
    const keys = defineContextKeys({ "t1.user.id": { cardinality: "high", propagate: "internal" } });

    expect(contextKeyRule("t1.user.id")).toEqual({ key: "t1.user.id", cardinality: "high", propagate: "internal", maxLength: 256 });
    expect(keys.with({ "t1.user.id": "u-1" }, () => keys.get("t1.user.id"))).toBe("u-1");
  });

  it("accepts a second definition with the same rules", () => {
    defineContextKeys({ "t2.request.id": { cardinality: "high", propagate: "internal" } });

    expect(() => defineContextKeys({ "t2.request.id": { cardinality: "high", propagate: "internal", maxLength: 256 } })).not.toThrow();
  });

  it("refuses a second definition with other rules, and registers no key of that set", () => {
    defineContextKeys({ "t3.tenant": { cardinality: "low", propagate: "internal" } });

    expect(() =>
      defineContextKeys({
        "t3.fresh": { cardinality: "low", propagate: "internal" },
        "t3.tenant": { cardinality: "high", propagate: "internal" },
      }),
    ).toThrow(/"t3.tenant" is defined already with other rules/);
    expect(contextKeyRule("t3.fresh")).toBeUndefined();
  });

  it("refuses a key that is not a W3C baggage key, and bad rules", () => {
    expect(() => defineContextKeys({ "t4 bad": { cardinality: "low", propagate: "internal" } })).toThrow(TypeError);
    expect(() => defineContextKeys({ "t4.a": { cardinality: "some" as "low", propagate: "internal" } })).toThrow(TypeError);
    expect(() => defineContextKeys({ "t4.b": { cardinality: "low", propagate: "out" as "none" } })).toThrow(TypeError);
    expect(() => defineContextKeys({ "t4.c": { cardinality: "low", propagate: "none", maxLength: 0 } })).toThrow(TypeError);
  });
});

describe("withContext and contextValue", () => {
  defineContextKeys({
    "t5.user.id": { cardinality: "high", propagate: "internal", maxLength: 8 },
    "t5.flag": { cardinality: "low", propagate: "none" },
    "t5.tenant": { cardinality: "low", propagate: "internal" },
  });

  it("keeps the values through await, timers and callbacks", async () => {
    const seen = await withContext({ "t5.user.id": "u-2" }, async () => {
      await null;
      const afterAwait = contextValue("t5.user.id");
      const afterTimer = await new Promise((resolve) => setTimeout(() => resolve(contextValue("t5.user.id")), 1));
      const afterMicrotask = await new Promise((resolve) => queueMicrotask(() => resolve(contextValue("t5.user.id"))));
      return [afterAwait, afterTimer, afterMicrotask];
    });

    expect(seen).toEqual(["u-2", "u-2", "u-2"]);
    expect(contextValue("t5.user.id")).toBeUndefined();
  });

  it("keeps two flows apart", async () => {
    const flow = (id: string) => withContext({ "t5.user.id": id }, async () => {
      await new Promise((resolve) => setTimeout(resolve, id === "a" ? 5 : 1));
      return contextValue("t5.user.id");
    });

    expect(await Promise.all([flow("a"), flow("b")])).toEqual(["a", "b"]);
  });

  it("adds the values to the values of the outer context, and an inner value wins", () => {
    const values = withContext({ "t5.user.id": "outer", "t5.tenant": "acme" }, () =>
      withContext({ "t5.user.id": "inner", "t5.flag": "on" }, () => contextValues()),
    );

    expect(values).toEqual({ "t5.user.id": "inner", "t5.tenant": "acme", "t5.flag": "on" });
  });

  it("skips an undefined or null value", () => {
    expect(withContext({ "t5.user.id": undefined, "t5.tenant": null }, () => contextValues())).toEqual({});
  });

  it("refuses a key that is not defined, a value that is not a string, and a value over its maxLength", () => {
    expect(() => withContext({ "t5.unknown": "x" }, () => 0)).toThrow(/"t5.unknown" is not defined/);
    expect(() => contextValue("t5.unknown")).toThrow(/is not defined/);
    expect(() => withContext({ "t5.user.id": 42 as unknown as string }, () => 0)).toThrow(TypeError);
    expect(() => withContext({ "t5.user.id": "123456789" }, () => 0)).toThrow(RangeError);
  });

  it("puts an internal key in the baggage, and a key with propagate none out of it", () => {
    const carrier: Record<string, string> = {};
    withContext({ "t5.tenant": "acme", "t5.flag": "on" }, () => propagation.inject(context.active(), carrier));

    expect(carrier["baggage"]).toBe("t5.tenant=acme");
  });

  it("reads an internal key from an incoming baggage, and leaves out a key that is not defined", () => {
    const incoming = propagation.extract(ROOT_CONTEXT, { baggage: "t5.tenant=acme,someone.else=x" });

    expect(contextValue("t5.tenant", incoming)).toBe("acme");
    expect(contextValues(incoming)).toEqual({ "t5.tenant": "acme" });
  });

  it("contextWith gives the context without a call", () => {
    const next = contextWith({ "t5.tenant": "acme" }, ROOT_CONTEXT);

    expect(contextValue("t5.tenant", next)).toBe("acme");
    expect(contextValue("t5.tenant")).toBeUndefined();
  });
});

describe("withInternalCall", () => {
  it("marks the context of the call and of its async continuations only", async () => {
    const inside = await withInternalCall(async () => {
      await null;
      return isInternalCall();
    });

    expect(inside).toBe(true);
    expect(isInternalCall()).toBe(false);
  });
});

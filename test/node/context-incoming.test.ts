import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { context, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import { contextValue, defineContextKeys, incomingContext, withContext, type IncomingTrust } from "../../src/context.js";
import { ContextPropagator } from "../../src/context-propagator.js";

defineContextKeys({
  "i.tenant": { cardinality: "low", propagate: "internal" },
  "i.user.id": { cardinality: "high", propagate: "internal" },
  "i.flag": { cardinality: "low", propagate: "none" },
});

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

beforeAll(() => {
  context.setGlobalContextManager(new AsyncContextManager().enable());
  propagation.setGlobalPropagator(new ContextPropagator());
});

afterAll(() => {
  propagation.disable();
  context.disable();
});

describe("incomingContext", () => {
  it("keeps the trace and the defined baggage keys of a caller with trust all", () => {
    const read = incomingContext({ traceparent: TRACEPARENT, baggage: "i.tenant=acme,someone.else=x" }, { trust: "all" });

    expect(trace.getSpanContext(read)).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID, isRemote: true });
    expect(contextValue("i.tenant", read)).toBe("acme");
    // an entry from outside, with a key that no defineContextKeys call defined, does not travel on
    expect(propagation.getBaggage(read)?.getEntry("someone.else")).toBeUndefined();
  });

  it("keeps the trace and removes each baggage entry with trust trace, the default", () => {
    const headers = { traceparent: TRACEPARENT, baggage: "i.tenant=acme" };

    for (const read of [incomingContext(headers, { trust: "trace" }), incomingContext(headers), incomingContext(headers, {})]) {
      expect(trace.getSpanContext(read)?.traceId).toBe(TRACE_ID);
      expect(propagation.getBaggage(read)).toBeUndefined();
    }
  });

  it("gives the root context with trust none: a public edge starts a new trace", () => {
    expect(incomingContext({ traceparent: TRACEPARENT, baggage: "i.tenant=acme" }, { trust: "none" })).toBe(ROOT_CONTEXT);
  });

  it("refuses a trust that is not all, trace or none", () => {
    expect(() => incomingContext({}, { trust: "some" as IncomingTrust })).toThrow(TypeError);
  });

  it("reads the Headers of a Fetch request, with the same trust rule", () => {
    const headers = new Headers({ Traceparent: TRACEPARENT, Baggage: "i.tenant=acme" });

    expect(contextValue("i.tenant", incomingContext(headers, { trust: "all" }))).toBe("acme");
    const untrusted = incomingContext(headers);
    expect(trace.getSpanContext(untrusted)?.spanId).toBe(SPAN_ID);
    expect(propagation.getBaggage(untrusted)).toBeUndefined();
  });

  it("reads a record with names of any case, and a list of values, as node:http gives a repeated header", () => {
    const read = incomingContext({ TraceParent: TRACEPARENT, baggage: ["i.tenant=acme", "i.user.id=u-1"] }, { trust: "all" });

    expect(trace.getSpanContext(read)?.traceId).toBe(TRACE_ID);
    expect(contextValue("i.tenant", read)).toBe("acme");
    expect(contextValue("i.user.id", read)).toBe("u-1");
  });

  it("reads only the own keys of a record, not the keys of its prototype", () => {
    const headers = Object.create({ traceparent: TRACEPARENT }) as Record<string, string>;

    expect(trace.getSpanContext(incomingContext(headers, { trust: "all" }))).toBeUndefined();
  });

  it("starts from the root context: the call gets no value of the context that runs the server", () => {
    const read = withContext({ "i.tenant": "server", "i.flag": "on" }, () =>
      incomingContext({ traceparent: TRACEPARENT }, { trust: "all" }),
    );

    expect(contextValue("i.tenant", read)).toBeUndefined();
    expect(contextValue("i.flag", read)).toBeUndefined();
    expect(trace.getSpanContext(incomingContext({}, { trust: "all" }))).toBeUndefined();
  });

  it("gives the root context when no propagator is registered", () => {
    propagation.disable();
    try {
      expect(incomingContext({ traceparent: TRACEPARENT, baggage: "i.tenant=acme" }, { trust: "all" })).toBe(ROOT_CONTEXT);
    } finally {
      propagation.setGlobalPropagator(new ContextPropagator());
    }
  });
});

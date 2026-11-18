import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { context, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import { contextValue, defineContextKeys, incomingContext, withContext } from "../../src/context.js";
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
  it("reads the trace and the defined baggage keys of a trusted caller", () => {
    const read = incomingContext({ traceparent: TRACEPARENT, baggage: "i.tenant=acme,someone.else=x" }, true);

    expect(trace.getSpanContext(read)).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID, isRemote: true });
    expect(contextValue("i.tenant", read)).toBe("acme");
    // an entry from outside, with a key that no defineContextKeys call defined, does not travel on
    expect(propagation.getBaggage(read)?.getEntry("someone.else")).toBeUndefined();
  });

  it("keeps the trace of a caller that is not trusted, and removes each baggage entry", () => {
    const read = incomingContext({ traceparent: TRACEPARENT, baggage: "i.tenant=acme" }, false);

    expect(trace.getSpanContext(read)?.traceId).toBe(TRACE_ID);
    expect(propagation.getBaggage(read)).toBeUndefined();
  });

  it("reads the Headers of a Fetch request, with the same trust rule", () => {
    const headers = new Headers({ Traceparent: TRACEPARENT, Baggage: "i.tenant=acme" });

    expect(contextValue("i.tenant", incomingContext(headers, true))).toBe("acme");
    const untrusted = incomingContext(headers, false);
    expect(trace.getSpanContext(untrusted)?.spanId).toBe(SPAN_ID);
    expect(propagation.getBaggage(untrusted)).toBeUndefined();
  });

  it("reads a record with names of any case, and a list of values, as node:http gives a repeated header", () => {
    const read = incomingContext({ TraceParent: TRACEPARENT, baggage: ["i.tenant=acme", "i.user.id=u-1"] }, true);

    expect(trace.getSpanContext(read)?.traceId).toBe(TRACE_ID);
    expect(contextValue("i.tenant", read)).toBe("acme");
    expect(contextValue("i.user.id", read)).toBe("u-1");
  });

  it("starts from the root context: the call gets no value of the context that runs the server", () => {
    const read = withContext({ "i.tenant": "server", "i.flag": "on" }, () => incomingContext({ traceparent: TRACEPARENT }, true));

    expect(contextValue("i.tenant", read)).toBeUndefined();
    expect(contextValue("i.flag", read)).toBeUndefined();
    expect(trace.getSpanContext(incomingContext({}, true))).toBeUndefined();
  });

  it("gives the root context when no propagator is registered", () => {
    propagation.disable();
    try {
      expect(incomingContext({ traceparent: TRACEPARENT, baggage: "i.tenant=acme" }, true)).toBe(ROOT_CONTEXT);
    } finally {
      propagation.setGlobalPropagator(new ContextPropagator());
    }
  });
});

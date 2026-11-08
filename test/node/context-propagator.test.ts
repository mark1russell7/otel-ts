import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { context, defaultTextMapGetter, defaultTextMapSetter, propagation, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import { contextValue, contextValues, defineContextKeys, withContext, withInternalCall } from "../../src/context.js";
import { ContextPropagator, claimContextRegistration, contextRegistrationOwner } from "../../src/context-propagator.js";

defineContextKeys({
  "p.user.id": { cardinality: "high", propagate: "internal", maxLength: 8 },
  "p.tenant": { cardinality: "low", propagate: "internal" },
  "p.flag": { cardinality: "low", propagate: "none" },
});

const propagator = new ContextPropagator();
const span = { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", traceFlags: TraceFlags.SAMPLED };

/** The headers of a call that starts in the active context */
function send(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagator.inject(context.active(), carrier, defaultTextMapSetter);
  return carrier;
}

beforeAll(() => {
  context.setGlobalContextManager(new AsyncContextManager().enable());
});

afterAll(() => {
  context.disable();
});

describe("ContextPropagator.inject", () => {
  it("sends traceparent on each call, and no baggage on a call with no internal mark", () => {
    const headers = context.with(trace.setSpanContext(ROOT_CONTEXT, span), () =>
      withContext({ "p.user.id": "u-1" }, () => send()),
    );

    expect(headers).toEqual({ traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" });
  });

  it("sends the defined internal keys on an internal call, also after await", async () => {
    const headers = await withContext({ "p.user.id": "u-1", "p.tenant": "acme", "p.flag": "on" }, () =>
      withInternalCall(async () => {
        await null;
        return send();
      }),
    );

    expect(headers["baggage"]?.split(",").sort()).toEqual(["p.tenant=acme", "p.user.id=u-1"]);
  });

  it("drops a baggage entry that no defineContextKeys call defined, and a value over its maxLength", () => {
    let baggage = propagation.createBaggage({
      "p.tenant": { value: "acme" },
      "someone.else": { value: "x" },
      "p.user.id": { value: "far-too-long" },
    });
    const headers = context.with(propagation.setBaggage(ROOT_CONTEXT, baggage), () => withInternalCall(() => send()));
    baggage = propagation.createBaggage({ "someone.else": { value: "x" } });
    const none = context.with(propagation.setBaggage(ROOT_CONTEXT, baggage), () => withInternalCall(() => send()));

    expect(headers).toEqual({ baggage: "p.tenant=acme" });
    expect(none).toEqual({});
  });

  it("names the fields of both W3C formats", () => {
    expect(propagator.fields().sort()).toEqual(["baggage", "traceparent", "tracestate"]);
  });
});

describe("ContextPropagator.extract", () => {
  it("reads the trace context and the defined internal keys, and leaves out the other entries", () => {
    const incoming = propagator.extract(
      ROOT_CONTEXT,
      { traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01", baggage: "p.tenant=acme,someone.else=x,p.flag=on,p.user.id=far-too-long" },
      defaultTextMapGetter,
    );

    expect(trace.getSpanContext(incoming)).toMatchObject({ traceId: span.traceId, spanId: span.spanId, isRemote: true });
    expect(contextValues(incoming)).toEqual({ "p.tenant": "acme" });
    expect(propagation.getBaggage(incoming)?.getAllEntries().map(([key]) => key)).toEqual(["p.tenant"]);
    // A key with propagate "none" does not come in from the baggage either
    expect(contextValue("p.flag", incoming)).toBeUndefined();
  });

  it("gives a context with no baggage when no entry is allowed", () => {
    const incoming = propagator.extract(ROOT_CONTEXT, { baggage: "someone.else=x" }, defaultTextMapGetter);

    expect(propagation.getBaggage(incoming)).toBeUndefined();
  });

  it("a server that does not trust its caller keeps the trace and deletes the baggage", () => {
    const incoming = propagator.extract(
      ROOT_CONTEXT,
      { traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01", baggage: "p.tenant=acme" },
      defaultTextMapGetter,
    );
    const untrusted = propagation.deleteBaggage(incoming);

    expect(trace.getSpanContext(untrusted)?.traceId).toBe(span.traceId);
    expect(contextValues(untrusted)).toEqual({});
  });
});

describe("claimContextRegistration", () => {
  it("refuses a second registration that names the first caller, until the first gives it back", () => {
    const release = claimContextRegistration("init()");

    expect(contextRegistrationOwner()).toBe("init()");
    expect(() => claimContextRegistration("startNodeTelemetry()")).toThrow(/registered already by init\(\)/);

    release();
    release();
    expect(contextRegistrationOwner()).toBeUndefined();
    const second = claimContextRegistration("startNodeTelemetry()");
    second();
  });
});

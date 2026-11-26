import { afterEach, describe, expect, it } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { TracerProvider } from "@opentelemetry/sdk-trace";
import { contextOwner, OTHER_SDK } from "../../src/context.js";
import { startNodeContext } from "../../src/node-context.js";

afterEach(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

describe("contextOwner", () => {
  it("gives undefined when no part of the program registered the context", () => {
    expect(contextOwner()).toBeUndefined();
  });

  it("gives the call of otel-ts that holds the registration, and undefined after its stop", async () => {
    const started = startNodeContext({ env: {} });
    expect(contextOwner()).toBe("startNodeContext()");
    await started.shutdown();
    expect(contextOwner()).toBeUndefined();
  });

  it("gives OTHER_SDK when an SDK outside otel-ts registered the global tracer provider, for example the capture of a test", () => {
    expect(trace.setGlobalTracerProvider(new TracerProvider())).toBe(true);
    expect(contextOwner()).toBe(OTHER_SDK);
    trace.disable();
    expect(contextOwner()).toBeUndefined();
  });

  it("gives OTHER_SDK when a part outside otel-ts registered only the context manager or only the propagator", () => {
    expect(context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())).toBe(true);
    expect(contextOwner()).toBe(OTHER_SDK);
    context.disable();
    expect(propagation.setGlobalPropagator(new W3CTraceContextPropagator())).toBe(true);
    expect(contextOwner()).toBe(OTHER_SDK);
    propagation.disable();
    expect(contextOwner()).toBeUndefined();
  });
});

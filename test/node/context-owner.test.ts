import { afterEach, describe, expect, it } from "vitest";
import { trace } from "@opentelemetry/api";
import { TracerProvider } from "@opentelemetry/sdk-trace";
import { contextOwner, OTHER_SDK } from "../../src/context.js";
import { startNodeContext } from "../../src/node-context.js";

afterEach(() => {
  trace.disable();
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
});

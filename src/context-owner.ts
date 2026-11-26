/**
 * The owner of the registration of the context, for each entry. This file loads only `@opentelemetry/api`, so the
 * entry `/context` can read the owner without the SDK packages.
 */
import { ProxyTracerProvider, trace } from "@opentelemetry/api";

/*
 * The owner of the registration is on globalThis, so two copies of otel-ts in
 * one program also refuse each other.
 */
export const OWNER = Symbol.for("@mark1russell7/otel-ts/context owner");

/** The caller of otel-ts that holds the registration of the context, or undefined */
export function contextRegistrationOwner(): string | undefined {
  return (globalThis as { [OWNER]?: string })[OWNER];
}

/** The owner that `contextOwner()` gives when an SDK outside otel-ts registered the global tracer provider */
export const OTHER_SDK = "another SDK";

/**
 * The part of the program that registered the context: the call of otel-ts that holds it (for example
 * "startNodeContext()"), `OTHER_SDK` when an SDK outside otel-ts registered the global tracer provider, or undefined
 * when nothing did. A runner starts the context only when this gives undefined. Then it does not replace the context of
 * the program, or the capture of a test.
 */
export function contextOwner(): string | undefined {
  const owner = contextRegistrationOwner();
  if (owner !== undefined) return owner;
  // The global of the API is its proxy. A registration sets the delegate of the proxy, and a proxy of another copy of the API
  // is not an instance of this class.
  const provider = trace.getTracerProvider();
  return provider instanceof ProxyTracerProvider && provider.getDelegate() === NO_PROVIDER ? undefined : OTHER_SDK;
}

/** The delegate of a proxy with no registered tracer provider: the no-op provider of the API */
const NO_PROVIDER = new ProxyTracerProvider().getDelegate();

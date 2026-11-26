/**
 * The owner of the registration of the context, for each entry. This file loads only `@opentelemetry/api`, so the
 * entry `/context` can read the owner without the SDK packages.
 */

/*
 * The owner of the registration is on globalThis, so two copies of otel-ts in
 * one program also refuse each other.
 */
export const OWNER = Symbol.for("@mark1russell7/otel-ts/context owner");

/** The caller of otel-ts that holds the registration of the context, or undefined */
export function contextRegistrationOwner(): string | undefined {
  return (globalThis as { [OWNER]?: string })[OWNER];
}

/** The owner that `contextOwner()` gives when a part outside otel-ts registered a global of the context */
export const OTHER_SDK = "another SDK";

/**
 * The registry of the globals of `@opentelemetry/api` 1.x. Each copy of the API in a program uses this key, so the
 * registry also shows a registration of another copy. The API has no public read of it.
 */
const API_GLOBALS = Symbol.for("opentelemetry.js.api.1");

/** The globals that a start of the context registers */
const CONTEXT_GLOBALS = ["trace", "context", "propagation"] as const;

/**
 * The part of the program that registered the context: the call of otel-ts that holds it (for example
 * "startNodeContext()"), `OTHER_SDK` when a part outside otel-ts registered the global tracer provider, context
 * manager or propagator, or undefined when nothing did. A runner starts the context only when this gives undefined.
 * Then it does not replace the context of the program, or the capture of a test.
 */
export function contextOwner(): string | undefined {
  const owner = contextRegistrationOwner();
  if (owner !== undefined) return owner;
  const registry = (globalThis as { [API_GLOBALS]?: Partial<Record<string, unknown>> })[API_GLOBALS];
  return CONTEXT_GLOBALS.some((name) => registry?.[name] !== undefined) ? OTHER_SDK : undefined;
}

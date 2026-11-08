/**
 * The propagator of the one context (docs/CONTEXT-DESIGN.md, section 5), and
 * the guard that lets only one part of a program register the context.
 *
 * - The W3C trace context (`traceparent`, `tracestate`) goes on each call. It
 *   holds only random ids.
 * - The W3C baggage goes only on a call that starts in a context with the
 *   internal mark (`withInternalCall` of `/context`), and only with the keys
 *   that `defineContextKeys` defined with `propagate: "internal"`. A value
 *   longer than the `maxLength` of its key is dropped, not cut.
 * - On extract, the baggage keeps only those keys too, so an entry from
 *   outside does not travel on. The W3C limits (180 entries, 8192 bytes) are
 *   the limits of the W3C baggage propagator of `@opentelemetry/core`.
 *
 * A server that does not trust its caller removes the extracted baggage with
 * `propagation.deleteBaggage(context)`, and keeps the trace context.
 */
import {
  propagation,
  type Baggage,
  type Context,
  type TextMapGetter,
  type TextMapPropagator,
  type TextMapSetter,
} from "@opentelemetry/api";
import { W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import { contextKeyRule, isInternalCall } from "./context.js";

/** The baggage with only the defined internal keys, each value in its maxLength; undefined when no entry stays */
export function allowedBaggage(baggage: Baggage): Baggage | undefined {
  let kept = baggage;
  for (const [key, entry] of baggage.getAllEntries()) {
    const rule = contextKeyRule(key);
    if (rule?.propagate !== "internal" || entry.value.length > rule.maxLength) kept = kept.removeEntry(key);
  }
  return kept.getAllEntries().length > 0 ? kept : undefined;
}

/** The W3C trace context on each call, and the allowed baggage on internal calls only */
export class ContextPropagator implements TextMapPropagator {
  private readonly traceContext = new W3CTraceContextPropagator();
  private readonly baggage = new W3CBaggagePropagator();

  inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    this.traceContext.inject(context, carrier, setter);
    if (!isInternalCall(context)) return;
    const baggage = propagation.getBaggage(context);
    const allowed = baggage && allowedBaggage(baggage);
    if (allowed) this.baggage.inject(propagation.setBaggage(context, allowed), carrier, setter);
  }

  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    const next = this.baggage.extract(this.traceContext.extract(context, carrier, getter), carrier, getter);
    const baggage = propagation.getBaggage(next);
    if (!baggage) return next;
    const allowed = allowedBaggage(baggage);
    return allowed ? propagation.setBaggage(next, allowed) : propagation.deleteBaggage(next);
  }

  fields(): string[] {
    return [...this.traceContext.fields(), ...this.baggage.fields()];
  }
}

/*
 * The owner of the registration is on globalThis, so two copies of otel-ts in
 * one program also refuse each other.
 */
const OWNER = Symbol.for("@mark1russell7/otel-ts/context owner");

/**
 * Take the registration of the context for `caller` (for example "init()" or
 * "startNodeTelemetry()"), and give the function that gives it back. A second
 * registration while the first holds is an error that names the first caller.
 * The OpenTelemetry API itself keeps the first registration and only writes a
 * diagnostic message.
 */
export function claimContextRegistration(caller: string): () => void {
  const holder = globalThis as { [OWNER]?: string };
  const owner = holder[OWNER];
  if (owner !== undefined) {
    throw new Error(`The context is registered already by ${owner}. Only one part of a program registers it: call the shutdown() of ${owner} first.`);
  }
  holder[OWNER] = caller;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (holder[OWNER] === caller) delete holder[OWNER];
  };
}

/** The caller that holds the registration of the context, or undefined */
export function contextRegistrationOwner(): string | undefined {
  return (globalThis as { [OWNER]?: string })[OWNER];
}

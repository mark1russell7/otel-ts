/**
 * The entry `@mark1russell7/otel-ts/context`: the one call that adds context
 * ids, for browsers and Node.js (docs/CONTEXT-DESIGN.md, section 3).
 *
 * This entry depends on `@opentelemetry/api` only. It registers nothing: the
 * context manager, the propagators and the processors come from `init()` or
 * `startNodeTelemetry()`. Without a registered context manager, `withContext`
 * still runs its function, but the values do not stay after an `await`.
 *
 * - The keys are data: `defineContextKeys` names each key, its cardinality and
 *   where it may go. A key that no call defined is refused.
 * - A key with `propagate: "internal"` goes in the W3C baggage, so the
 *   propagator of otel-ts can send it on an internal call.
 * - A key with `propagate: "none"` stays in a context entry of its own. No
 *   baggage propagator sees it, so it never leaves the process.
 *
 * @packageDocumentation
 */
import { context, createContextKey, propagation, type Context } from "@opentelemetry/api";

/** How many distinct values a key has: "low" may become a metric attribute, "high" never does */
export type ContextKeyCardinality = "low" | "high";

/** Where a key may go: "internal" on internal calls (in the baggage), "none" never out of the process */
export type ContextKeyPropagation = "internal" | "none";

/** The rules of one context key */
export interface ContextKeySpec {
  readonly cardinality: ContextKeyCardinality;
  readonly propagate: ContextKeyPropagation;
  /** The longest value, in UTF-16 code units. Default: 256. */
  readonly maxLength?: number;
}

/** The rules of one key, with each default filled in */
export interface ContextKeyRule {
  readonly key: string;
  readonly cardinality: ContextKeyCardinality;
  readonly propagate: ContextKeyPropagation;
  readonly maxLength: number;
}

/** The values of a set of keys. An `undefined` or `null` value adds nothing. */
export type ContextValues<K extends string = string> = { readonly [P in K]?: string | null | undefined };

/** The keys that one call of `defineContextKeys` defined, with typed calls */
export interface ContextKeys<K extends string> {
  /** The rules of each key of this set */
  readonly rules: ReadonlyMap<K, ContextKeyRule>;
  /** `withContext`, with the key names of this set */
  with<T>(values: ContextValues<K>, fn: () => T): T;
  /** `contextValue`, with the key names of this set */
  get(key: K, from?: Context): string | undefined;
}

/** The default of `maxLength` */
export const DEFAULT_MAX_LENGTH = 256;

/*
 * The W3C baggage key is a token (RFC 7230): letters, digits and
 * !#$%&'*+-.^_`|~. A dot is the separator of the semantic conventions.
 */
const KEY_PATTERN = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/*
 * The registry is on globalThis, so two copies of this package in one program
 * share their keys, as the copies of @opentelemetry/api share their globals.
 */
const REGISTRY = Symbol.for("@mark1russell7/otel-ts/context-keys");
type Registry = Map<string, ContextKeyRule>;
function registry(): Registry {
  const holder = globalThis as { [REGISTRY]?: Registry };
  return (holder[REGISTRY] ??= new Map());
}

/** The context entry of the keys with `propagate: "none"` */
const LOCAL_VALUES = createContextKey("@mark1russell7/otel-ts/context local values");
/** The context entry of the internal mark */
const INTERNAL_CALL = createContextKey("@mark1russell7/otel-ts/context internal call");

function ruleOf(key: string, spec: ContextKeySpec): ContextKeyRule {
  if (!KEY_PATTERN.test(key)) throw new TypeError(`The context key "${key}" is not a W3C baggage key: use letters, digits and . _ -`);
  if (spec.cardinality !== "low" && spec.cardinality !== "high") throw new TypeError(`The context key "${key}" has no cardinality "low" or "high"`);
  if (spec.propagate !== "internal" && spec.propagate !== "none") throw new TypeError(`The context key "${key}" has no propagate "internal" or "none"`);
  const maxLength = spec.maxLength ?? DEFAULT_MAX_LENGTH;
  if (!Number.isInteger(maxLength) || maxLength < 1) throw new TypeError(`The maxLength of the context key "${key}" is not a positive integer`);
  return { key, cardinality: spec.cardinality, propagate: spec.propagate, maxLength };
}

function sameRule(a: ContextKeyRule, b: ContextKeyRule): boolean {
  return a.cardinality === b.cardinality && a.propagate === b.propagate && a.maxLength === b.maxLength;
}

/**
 * Define context keys, one time for each program part. A second definition of
 * a key with the same rules is accepted, so a library and an app can both
 * define `request.id`. A second definition with other rules is an error.
 */
export function defineContextKeys<K extends string>(specs: { readonly [P in K]: ContextKeySpec }): ContextKeys<K> {
  const rules = new Map<K, ContextKeyRule>();
  for (const key of Object.keys(specs) as K[]) rules.set(key, ruleOf(key, specs[key]));
  const known = registry();
  // Check all keys first, so a refused set registers no key
  for (const rule of rules.values()) {
    const earlier = known.get(rule.key);
    if (earlier && !sameRule(earlier, rule)) {
      throw new Error(`The context key "${rule.key}" is defined already with other rules (${describe(earlier)}), not ${describe(rule)}`);
    }
  }
  for (const rule of rules.values()) known.set(rule.key, rule);
  return {
    rules,
    with: (values, fn) => withContext(values, fn),
    get: (key, from) => contextValue(key, from),
  };
}

function describe(rule: ContextKeyRule): string {
  return `cardinality ${rule.cardinality}, propagate ${rule.propagate}, maxLength ${rule.maxLength}`;
}

function knownRule(key: string): ContextKeyRule {
  const rule = registry().get(key);
  if (!rule) throw new Error(`The context key "${key}" is not defined: call defineContextKeys first`);
  return rule;
}

/** The rules of a defined key, or undefined. The processors and the propagator read them. */
export function contextKeyRule(key: string): ContextKeyRule | undefined {
  return registry().get(key);
}

/** The rules of each defined key */
export function contextKeyRules(): readonly ContextKeyRule[] {
  return [...registry().values()];
}

/**
 * Run `fn` in a new context with these values, on top of the values of the
 * active context. The async storage keeps the context through `await`,
 * timers and callbacks. A key that is not defined, a value that is not a
 * string and a value longer than the `maxLength` of its key are errors.
 */
export function withContext<T>(values: ContextValues, fn: () => T): T {
  return context.with(contextWith(values), fn);
}

/** The active context (or `from`) with these values: `withContext` without the call */
export function contextWith(values: ContextValues, from: Context = context.active()): Context {
  let baggage = propagation.getBaggage(from) ?? propagation.createBaggage();
  let local: Map<string, string> | undefined;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const rule = knownRule(key);
    if (typeof value !== "string") throw new TypeError(`The value of the context key "${key}" is not a string`);
    if (value.length > rule.maxLength) throw new RangeError(`The value of the context key "${key}" has ${value.length} characters, more than its maxLength ${rule.maxLength}`);
    if (rule.propagate === "internal") {
      baggage = baggage.setEntry(key, { value });
    } else {
      local ??= new Map(localValues(from));
      local.set(key, value);
    }
  }
  let next = propagation.setBaggage(from, baggage);
  if (local) next = next.setValue(LOCAL_VALUES, local);
  return next;
}

function localValues(from: Context): ReadonlyMap<string, string> {
  return (from.getValue(LOCAL_VALUES) as ReadonlyMap<string, string> | undefined) ?? new Map();
}

/** The value of a defined key in the active context (or `from`), or undefined */
export function contextValue(key: string, from: Context = context.active()): string | undefined {
  const rule = knownRule(key);
  if (rule.propagate === "none") return localValues(from).get(key);
  return propagation.getBaggage(from)?.getEntry(key)?.value;
}

/**
 * The value of each defined key in the active context (or `from`). A baggage
 * entry of a key that is not defined is not in the result: an entry from
 * outside does not become an attribute.
 */
export function contextValues(from: Context = context.active()): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  const known = registry();
  for (const [key, entry] of propagation.getBaggage(from)?.getAllEntries() ?? []) {
    if (known.get(key)?.propagate === "internal") result[key] = entry.value;
  }
  for (const [key, value] of localValues(from)) result[key] = value;
  return result;
}

/**
 * Run `fn` with the internal mark: the propagator of otel-ts sends the baggage
 * only on a call that starts in such a context. `@procedures/client` sets the
 * mark around the send of each of its transports.
 */
export function withInternalCall<T>(fn: () => T): T {
  return context.with(context.active().setValue(INTERNAL_CALL, true), fn);
}

/** True when the active context (or `from`) has the internal mark */
export function isInternalCall(from: Context = context.active()): boolean {
  return from.getValue(INTERNAL_CALL) === true;
}

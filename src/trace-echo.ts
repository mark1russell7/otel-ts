/**
 * The trace of a write, carried to its echo. A write ends its request, and a
 * change stream (or another queue) reports the change later, without the
 * context of the request. The write handler keeps the trace context of the
 * write for some seconds, keyed by what the echo can name (for example the
 * collection and the id). The handler of the echo takes it, and the clients
 * then apply the echo in the trace of the write.
 *
 * @packageDocumentation
 */
import { context, propagation } from "@opentelemetry/api";

const TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

/**
 * The W3C trace context to pass on: the context of the active span when the
 * SDK operates, else the `traceparent` header of the request.
 */
export function outgoingTraceparent(header: unknown): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const value = carrier["traceparent"] ?? (typeof header === "string" ? header : undefined);
  return value && TRACEPARENT.test(value) ? value : undefined;
}

/** A store of the trace contexts of the writes, until their echoes arrive */
export interface TraceEcho {
  /** Keep the trace of a write to (`scope`, `id`). It ignores an empty trace. */
  remember(scope: string, id: unknown, traceparent: string | undefined, now?: number): void;
  /** The trace of the write that caused this echo, one time. Undefined when none or expired. */
  take(scope: string, id: unknown, now?: number): string | undefined;
  /** The count of the kept traces */
  readonly size: number;
}

/** A trace-echo store: each trace lives `ttlMs` (default 10 s), `maxEntries` at most (default 10,000). */
export function createTraceEcho(options: { ttlMs?: number; maxEntries?: number } = {}): TraceEcho {
  const ttl = options.ttlMs ?? 10_000;
  const max = options.maxEntries ?? 10_000;
  const pending = new Map<string, { traceparent: string; at: number }>();
  const keyOf = (scope: string, id: unknown): string => `${scope}\u0000${String(id)}`;
  /** Drop the expired entries, and when the store is full, the oldest half */
  const sweep = (now: number): void => {
    for (const [k, v] of pending) if (now - v.at > ttl) pending.delete(k);
    if (pending.size >= max) {
      let drop = Math.floor(pending.size / 2);
      for (const k of pending.keys()) {
        if (drop-- <= 0) break;
        pending.delete(k);
      }
    }
  };
  return {
    remember(scope, id, traceparent, now = Date.now()) {
      if (!traceparent) return;
      if (pending.size >= max) sweep(now);
      pending.set(keyOf(scope, id), { traceparent, at: now });
    },
    take(scope, id, now = Date.now()) {
      const key = keyOf(scope, id);
      const hit = pending.get(key);
      if (!hit) return undefined;
      pending.delete(key);
      return now - hit.at <= ttl ? hit.traceparent : undefined;
    },
    get size() {
      return pending.size;
    },
  };
}

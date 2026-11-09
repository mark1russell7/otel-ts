/**
 * The decoder of the bodies that Faro sends to its collector. It holds no state and no DOM, so a test can examine it.
 * The fields are the ones of `@grafana/faro-core` 2.x that the page shows.
 */

/** The span that was active when the app gave the item to Faro. Faro reads it from the context of otel-ts. */
export interface FaroTrace {
  readonly trace_id: string;
  readonly span_id: string;
}

interface FaroEntry {
  readonly timestamp: string;
  readonly trace?: FaroTrace;
}

/** The body of one request of Faro to its collector. */
export interface FaroBody {
  readonly meta?: { readonly session?: { readonly id?: string }; readonly app?: { readonly name?: string } };
  readonly logs?: readonly (FaroEntry & { readonly level: string; readonly message: string })[];
  readonly exceptions?: readonly (FaroEntry & { readonly type: string; readonly value: string })[];
  readonly events?: readonly (FaroEntry & { readonly name: string; readonly domain?: string })[];
  readonly measurements?: readonly (FaroEntry & { readonly type: string; readonly values: Readonly<Record<string, number>> })[];
}

/** The kinds of Faro items. */
export type FaroKind = "log" | "exception" | "event" | "measurement";

/** One item of a Faro body. */
export interface FaroItem {
  readonly kind: FaroKind;
  readonly text: string;
  readonly timeMs: number;
  /** The trace of the item, or undefined when no span was active. */
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
}

/** This function gives the text of the values of a measurement. */
function valuesText(values: Readonly<Record<string, number>>): string {
  return Object.entries(values)
    .map(([name, value]) => `${name} ${Number(value.toPrecision(4))}`)
    .join(", ");
}

/** This function gives the items of a Faro body, oldest first. */
export function decodeFaro(body: FaroBody): FaroItem[] {
  const item = (kind: FaroKind, text: string, entry: FaroEntry): FaroItem => ({
    kind,
    text,
    timeMs: Date.parse(entry.timestamp),
    traceId: entry.trace?.trace_id,
    spanId: entry.trace?.span_id,
  });
  return [
    ...(body.logs ?? []).map((log) => item("log", `${log.level}: ${log.message}`, log)),
    ...(body.exceptions ?? []).map((exception) => item("exception", `${exception.type}: ${exception.value}`, exception)),
    ...(body.events ?? []).map((event) => item("event", event.domain === undefined ? event.name : `${event.domain}: ${event.name}`, event)),
    ...(body.measurements ?? []).map((measurement) => item("measurement", `${measurement.type}: ${valuesText(measurement.values)}`, measurement)),
  ].sort((a, b) => a.timeMs - b.timeMs);
}

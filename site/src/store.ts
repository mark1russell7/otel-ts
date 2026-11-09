/**
 * The store of the page. It holds what the wire caught, and it groups the records for the views. It has no DOM, so a
 * test can examine it.
 */
import { decodeFaro } from "./faro.ts";
import type { FaroItem } from "./faro.ts";
import { decodeLogs, decodeMetrics, decodeSpans, recordCount, waterfallRows } from "./otlp.ts";
import type { LogRecord, MetricRecord, SpanRecord, WaterfallRow } from "./otlp.ts";
import type { ExportRecord, RequestRecord } from "./wire.ts";

/** One export, with the data that the page adds to it. */
export type Capture = ExportRecord & {
  /** The count of spans, data points, log records or Faro items. */
  readonly records: number;
  /** What started the export, as a short text. */
  readonly cause: string;
};

/** The spans of one trace. */
export interface TraceGroup {
  readonly traceId: string;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly rows: readonly WaterfallRow[];
  readonly logs: readonly LogRecord[];
  /** The Faro items that have the trace. */
  readonly faro: readonly FaroItem[];
  readonly failed: boolean;
}

/** The sums of what the store got. */
export interface Totals {
  readonly spans: number;
  readonly points: number;
  readonly logs: number;
  readonly faro: number;
  readonly exports: number;
  readonly bytes: number;
}

/** The time after a flush in which an export counts as a result of that flush, in milliseconds. */
const FLUSH_WINDOW_MS = 250;

/** The counts of records that the page keeps. The page shows only the newest ones. */
const MAX_CAPTURES = 300;
const MAX_TRACES = 40;

/** This function gives the cause of an export that started with no flush. */
function timerCause(capture: Pick<ExportRecord, "signal">): string {
  return capture.signal === "metrics" ? "metric interval" : "batch timer";
}

/** The cause of each Faro request. Faro sends on its own timer, and a flush of otel-ts does not start it. */
const FARO_CAUSE = "Faro batch";

/** The store. */
export interface Store {
  /** This function notes a flush. The exports that follow it get this cause. */
  noteFlush(cause: string, at?: number): void;
  addExport(record: ExportRecord): Capture;
  addRequest(record: RequestRecord): void;
  captures(): readonly Capture[];
  capture(id: number): Capture | undefined;
  /** This function gives the traces, newest first. */
  traces(): TraceGroup[];
  /** This function gives the span with the ID. */
  span(spanId: string): SpanRecord | undefined;
  /** This function gives the request that a span made, when the store has it. */
  requestOf(span: SpanRecord): RequestRecord | undefined;
  /** This function gives the data points of the newest metrics export. */
  latestMetrics(): readonly MetricRecord[];
  /** This function gives the log records, newest first. */
  logs(): readonly LogRecord[];
  /** This function gives the Faro items, newest first. */
  faro(): readonly FaroItem[];
  totals(): Totals;
}

/** This function makes an empty store. */
export function createStore(): Store {
  const captures: Capture[] = [];
  const spans = new Map<string, SpanRecord>();
  const requests: RequestRecord[] = [];
  const logs: LogRecord[] = [];
  const faro: FaroItem[] = [];
  let metrics: readonly MetricRecord[] = [];
  let flush: { readonly cause: string; readonly at: number } | undefined;
  const totals = { spans: 0, points: 0, logs: 0, faro: 0, exports: 0, bytes: 0 };

  const forgetOldTraces = (): void => {
    const newest = [...new Set([...spans.values()].sort((a, b) => b.startMs - a.startMs).map((span) => span.traceId))];
    const keep = new Set(newest.slice(0, MAX_TRACES));
    for (const [id, span] of spans) if (!keep.has(span.traceId)) spans.delete(id);
  };

  return {
    noteFlush(cause, at = Date.now()) {
      flush = { cause, at };
    },
    addExport(record) {
      const inFlush = flush !== undefined && record.at - flush.at <= FLUSH_WINDOW_MS;
      const items = record.signal === "faro" ? decodeFaro(record.body) : [];
      const capture: Capture =
        record.signal === "faro"
          ? { ...record, records: items.length, cause: FARO_CAUSE }
          : { ...record, records: recordCount(record.signal, record.body), cause: inFlush && flush ? flush.cause : timerCause(record) };
      captures.push(capture);
      if (captures.length > MAX_CAPTURES) captures.shift();
      totals.exports += 1;
      totals.bytes += record.bytes;
      if (record.signal === "traces") {
        for (const span of decodeSpans(record.body)) spans.set(span.spanId, span);
        totals.spans += capture.records;
        forgetOldTraces();
      } else if (record.signal === "metrics") {
        metrics = decodeMetrics(record.body);
        totals.points += capture.records;
      } else if (record.signal === "logs") {
        logs.push(...decodeLogs(record.body));
        logs.splice(0, Math.max(logs.length - MAX_CAPTURES, 0));
        totals.logs += capture.records;
      } else {
        faro.push(...items);
        faro.splice(0, Math.max(faro.length - MAX_CAPTURES, 0));
        totals.faro += items.length;
      }
      return capture;
    },
    addRequest(record) {
      requests.push(record);
      requests.splice(0, Math.max(requests.length - MAX_CAPTURES, 0));
    },
    captures: () => captures,
    capture: (id) => captures.find((capture) => capture.id === id),
    traces() {
      const groups = new Map<string, SpanRecord[]>();
      for (const span of spans.values()) groups.set(span.traceId, [...(groups.get(span.traceId) ?? []), span]);
      const traces = [...groups].map(([traceId, list]): TraceGroup => {
        const rows = waterfallRows(list);
        return {
          traceId,
          name: rows[0]?.span.name ?? "",
          startMs: Math.min(...list.map((span) => span.startMs)),
          endMs: Math.max(...list.map((span) => span.endMs)),
          rows,
          logs: logs.filter((log) => log.traceId === traceId),
          faro: faro.filter((item) => item.traceId === traceId),
          failed: list.some((span) => span.status === "error"),
        };
      });
      return traces.sort((a, b) => b.startMs - a.startMs);
    },
    span: (spanId) => spans.get(spanId),
    requestOf(span) {
      const url = span.attributes["url.full"];
      if (typeof url !== "string") return undefined;
      const matches = requests.filter((request) => request.url === url);
      return matches.find((request) => request.traceparent?.includes(span.spanId)) ?? matches.filter((request) => request.traceparent === undefined).at(-1);
    },
    latestMetrics: () => metrics,
    logs: () => [...logs].reverse(),
    faro: () => [...faro].reverse(),
    totals: () => ({ ...totals }),
  };
}

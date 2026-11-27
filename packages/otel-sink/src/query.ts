/**
 * The queries of the store: the slowest spans, the errors, one trace with its logs, and the counts of each service.
 * Each time in a result is in milliseconds since the epoch, and each duration is in milliseconds.
 */
import type { DatabaseSync } from "node:sqlite";
import { readTransaction } from "@mark1russell7/sqlite";
import type { Value } from "./otlp.ts";

/** A span in a result */
export interface SpanView {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentId: string | null;
  readonly service: string;
  readonly name: string;
  readonly kind: number | null;
  readonly startMs: number;
  readonly durationMs: number;
  readonly status: number;
  readonly attributes: { readonly [key: string]: Value };
}

/** A log record in a result */
export interface LogView {
  readonly timeMs: number;
  readonly service: string;
  readonly severity: number | null;
  readonly body: string | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly attributes: { readonly [key: string]: Value };
}

/** The counts of the spans of one service */
export interface ServiceView {
  readonly service: string;
  readonly spans: number;
  readonly failed: number;
  /** The fraction of the spans with the status error */
  readonly errorRate: number;
  readonly slowestMs: number;
}

/** The window and the size of a query */
export interface Window {
  /** The start of the window, in milliseconds since the epoch */
  readonly sinceMs: number;
  /** The most rows of a result, from 1 up to `MAX_LIMIT` */
  readonly limit: number;
  /** Only the rows of this service, when it is given */
  readonly service?: string | undefined;
}

/** The most rows of one result */
export const MAX_LIMIT = 1000;

/** The severity number of OTLP from which a log record is an error */
export const ERROR_SEVERITY = 17;

const SPAN_COLUMNS = `trace_id AS traceId, span_id AS spanId, parent_id AS parentId, service, name, kind,
  start_ns / 1000000 AS startMs, (end_ns - start_ns) / 1e6 AS durationMs, status, attributes`;
const LOG_COLUMNS = "time_ns / 1000000 AS timeMs, service, severity, body, trace_id AS traceId, span_id AS spanId, attributes";

type Row = Record<string, unknown>;

const spanOf = (row: Row): SpanView => ({
  traceId: String(row["traceId"]),
  spanId: String(row["spanId"]),
  parentId: row["parentId"] === null ? null : String(row["parentId"]),
  service: String(row["service"]),
  name: String(row["name"]),
  kind: row["kind"] === null ? null : Number(row["kind"]),
  startMs: Number(row["startMs"]),
  durationMs: Number(row["durationMs"]),
  status: Number(row["status"]),
  attributes: JSON.parse(String(row["attributes"])) as SpanView["attributes"],
});

const logOf = (row: Row): LogView => ({
  timeMs: Number(row["timeMs"]),
  service: String(row["service"]),
  severity: row["severity"] === null ? null : Number(row["severity"]),
  body: row["body"] === null ? null : String(row["body"]),
  traceId: row["traceId"] === null ? null : String(row["traceId"]),
  spanId: row["spanId"] === null ? null : String(row["spanId"]),
  attributes: JSON.parse(String(row["attributes"])) as LogView["attributes"],
});

/** This function gives the problems of a window. The receiver answers a window with problems with 400. */
export const windowProblems = (window: Window): string[] => {
  const problems: string[] = [];
  if (!Number.isFinite(window.sinceMs) || window.sinceMs < 0) problems.push("since must be a time in milliseconds from 0");
  if (!Number.isSafeInteger(window.limit) || window.limit < 1 || window.limit > MAX_LIMIT) problems.push(`limit must be a whole number from 1 to ${MAX_LIMIT}`);
  return problems;
};

const sinceNs = (window: Window): bigint => BigInt(Math.floor(window.sinceMs)) * 1_000_000n;
const serviceFilter = (window: Window, column = "service"): string => (window.service === undefined ? "" : ` AND ${column} = ?`);
const serviceParam = (window: Window): string[] => (window.service === undefined ? [] : [window.service]);

/** This function gives the slowest spans that start in the window, the slowest first. */
export const slowest = (db: DatabaseSync, window: Window): SpanView[] =>
  db
    .prepare(`SELECT ${SPAN_COLUMNS} FROM spans WHERE start_ns >= ?${serviceFilter(window)} ORDER BY end_ns - start_ns DESC LIMIT ?`)
    .all(sinceNs(window), ...serviceParam(window), window.limit)
    .map(spanOf);

/** This function gives the spans with the status error and the error logs of the window, the newest first. */
export const errors = (db: DatabaseSync, window: Window): { readonly spans: SpanView[]; readonly logs: LogView[] } =>
  readTransaction(db, () => ({
    spans: db
      .prepare(`SELECT ${SPAN_COLUMNS} FROM spans WHERE status = 2 AND start_ns >= ?${serviceFilter(window)} ORDER BY start_ns DESC LIMIT ?`)
      .all(sinceNs(window), ...serviceParam(window), window.limit)
      .map(spanOf),
    logs: db
      .prepare(`SELECT ${LOG_COLUMNS} FROM logs WHERE severity >= ${ERROR_SEVERITY} AND time_ns >= ?${serviceFilter(window)} ORDER BY time_ns DESC LIMIT ?`)
      .all(sinceNs(window), ...serviceParam(window), window.limit)
      .map(logOf),
  }));

/** The pattern of a trace id: 32 hex digits */
export const TRACE_ID: RegExp = /^[0-9a-f]{32}$/;

/** This function gives the spans and the logs of one trace, in the order of their times. */
export const trace = (db: DatabaseSync, traceId: string): { readonly spans: SpanView[]; readonly logs: LogView[] } => {
  const id = traceId.toLowerCase();
  return readTransaction(db, () => ({
    spans: db.prepare(`SELECT ${SPAN_COLUMNS} FROM spans WHERE trace_id = ? ORDER BY start_ns LIMIT ${MAX_LIMIT}`).all(id).map(spanOf),
    logs: db.prepare(`SELECT ${LOG_COLUMNS} FROM logs WHERE trace_id = ? ORDER BY time_ns LIMIT ${MAX_LIMIT}`).all(id).map(logOf),
  }));
};

/** This function gives the counts of the spans of each service in the window, the most failed spans first. */
export const services = (db: DatabaseSync, window: Window): ServiceView[] =>
  db
    .prepare(
      `SELECT service, COUNT(*) AS spans, SUM(status = 2) AS failed, MAX(end_ns - start_ns) / 1e6 AS slowestMs
       FROM spans WHERE start_ns >= ?${serviceFilter(window)} GROUP BY service ORDER BY failed DESC, spans DESC LIMIT ?`,
    )
    .all(sinceNs(window), ...serviceParam(window), window.limit)
    .map((row) => {
      const spans = Number(row["spans"]);
      const failed = Number(row["failed"]);
      return { service: String(row["service"]), spans, failed, errorRate: spans === 0 ? 0 : failed / spans, slowestMs: Number(row["slowestMs"]) };
    });

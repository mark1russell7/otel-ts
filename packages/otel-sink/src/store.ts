/**
 * The store of the sink: one SQLite file with a table for each signal. Each row has its size in bytes, and triggers
 * keep the sum of each table in the table `sizes`. Thus the prune reads one row to know the size of a signal.
 */
import { migrate, openDatabase, transaction, type Migration } from "@mark1russell7/sqlite";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { LogRow, PointRow, SpanRow } from "./otlp.ts";
import { DEFAULT_RETENTION, retentionProblems, SIGNALS, type RetentionRules, type Signal } from "./retention.ts";

/** The column of the time of each signal, in nanoseconds since the epoch */
export const TIME_COLUMN: { readonly [signal in Signal]: string } = { spans: "start_ns", logs: "time_ns", points: "time_ns" };

const sizeTriggers = (signal: Signal): string =>
  `CREATE TRIGGER ${signal}_insert AFTER INSERT ON ${signal} BEGIN UPDATE sizes SET rows = rows + 1, bytes = bytes + NEW.bytes WHERE signal = '${signal}'; END;
   CREATE TRIGGER ${signal}_delete AFTER DELETE ON ${signal} BEGIN UPDATE sizes SET rows = rows - 1, bytes = bytes - OLD.bytes WHERE signal = '${signal}'; END;`;

/** The steps of the schema. Do not change a step: add a new one. */
export const MIGRATIONS: readonly Migration[] = [
  `CREATE TABLE spans (trace_id TEXT NOT NULL, span_id TEXT NOT NULL, parent_id TEXT, service TEXT NOT NULL, name TEXT NOT NULL,
     kind INTEGER, start_ns INTEGER NOT NULL, end_ns INTEGER NOT NULL, status INTEGER NOT NULL, attributes TEXT NOT NULL, bytes INTEGER NOT NULL);
   CREATE INDEX spans_start ON spans (start_ns);
   CREATE INDEX spans_service_start ON spans (service, start_ns);
   CREATE INDEX spans_trace ON spans (trace_id);
   CREATE INDEX spans_errors ON spans (start_ns) WHERE status = 2;
   CREATE TABLE logs (time_ns INTEGER NOT NULL, service TEXT NOT NULL, severity INTEGER, body TEXT, trace_id TEXT, span_id TEXT,
     attributes TEXT NOT NULL, bytes INTEGER NOT NULL);
   CREATE INDEX logs_time ON logs (time_ns);
   CREATE INDEX logs_service_time ON logs (service, time_ns);
   CREATE INDEX logs_trace ON logs (trace_id);
   CREATE INDEX logs_errors ON logs (time_ns) WHERE severity >= 17;
   CREATE TABLE points (time_ns INTEGER NOT NULL, service TEXT NOT NULL, metric TEXT NOT NULL, attributes TEXT NOT NULL,
     value REAL, histogram TEXT, bytes INTEGER NOT NULL);
   CREATE INDEX points_time ON points (time_ns);
   CREATE INDEX points_metric_time ON points (metric, time_ns);
   CREATE TABLE sizes (signal TEXT PRIMARY KEY, rows INTEGER NOT NULL, bytes INTEGER NOT NULL);
   INSERT INTO sizes (signal, rows, bytes) VALUES ('spans', 0, 0), ('logs', 0, 0), ('points', 0, 0);
   ${SIGNALS.map(sizeTriggers).join("\n")}`,
];

/** The size of a signal in the store */
export interface SignalSize {
  readonly rows: number;
  readonly bytes: number;
}

/** The rows that a prune deleted for one signal: past the age, and past the size */
export interface SignalPrune {
  readonly aged: number;
  readonly capped: number;
}

/** The result of a prune: the rows that it deleted for each signal, and if it is done */
export type Pruned = { readonly [signal in Signal]: SignalPrune } & { readonly done: boolean };

/** The rows of one export */
export interface Rows {
  readonly spans?: readonly SpanRow[];
  readonly logs?: readonly LogRow[];
  readonly points?: readonly PointRow[];
}

/** The store of the sink */
export interface Store {
  /** The connection, for the queries. Do not write through it: each write goes through the store. */
  readonly db: DatabaseSync;
  readonly rules: RetentionRules;
  /** This method writes the rows in one transaction. Then it prunes each signal that is past its size. */
  insert(rows: Rows): void;
  /**
   * This method deletes the rows past the age of each signal at `nowMs`, then the oldest rows past each size. Each
   * delete is one transaction of at most `batch` rows. The prune stops after `batches` deletes (no bound by default),
   * and then `done` is false. Thus a caller can let other work go between two parts of a long prune.
   */
  prune(nowMs: number, batches?: number): Pruned;
  /** This method gives the count and the size of the rows of each signal. */
  sizes(): { readonly [signal in Signal]: SignalSize };
  /** This method gives the size of the file in bytes, without its write-ahead log. */
  fileBytes(): number;
  close(): void;
}

/** The options of `openStore` */
export interface StoreOptions {
  readonly rules?: RetentionRules | undefined;
  /** The most rows that one delete of the prune by size removes. The default is 5000. */
  readonly batch?: number | undefined;
}

const textBytes = (text: string | null): number => (text === null ? 0 : Buffer.byteLength(text, "utf8"));

/** The size that the store counts for a row: the bytes of its text, 8 bytes for each number, and 32 bytes for the row */
export const ROW_OVERHEAD = 32;
const spanBytes = (row: SpanRow): number =>
  ROW_OVERHEAD + 8 * 4 + textBytes(row.traceId) + textBytes(row.spanId) + textBytes(row.parentId) + textBytes(row.service) + textBytes(row.name) + textBytes(row.attributes);
const logBytes = (row: LogRow): number =>
  ROW_OVERHEAD + 8 * 2 + textBytes(row.service) + textBytes(row.body) + textBytes(row.traceId) + textBytes(row.spanId) + textBytes(row.attributes);
const pointBytes = (row: PointRow): number =>
  ROW_OVERHEAD + 8 * 2 + textBytes(row.service) + textBytes(row.metric) + textBytes(row.attributes) + textBytes(row.histogram);

/**
 * This function opens the store at a path, or in memory at `:memory:`. It makes the folder and the tables when they are
 * not there. It throws when the rules have problems.
 */
export const openStore = (path: string, options: StoreOptions = {}): Store => {
  const rules = options.rules ?? DEFAULT_RETENTION;
  const problems = retentionProblems(rules);
  if (problems.length > 0) throw new RangeError(`the retention rules have problems: ${problems.join("; ")}`);
  const batch = options.batch ?? 5000;
  if (!Number.isSafeInteger(batch) || batch < 1) throw new RangeError(`batch must be a whole number from 1: ${batch}`);

  const db = openDatabase(path, { synchronous: "NORMAL", busyTimeoutMs: 5000, makeFolder: path !== ":memory:" });
  try {
    // Only a file with no tables takes this pragma. Thus it must come before the first step of the schema.
    db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    migrate(db, MIGRATIONS, { name: "otel-sink" });
  } catch (error) {
    db.close();
    throw error;
  }

  const insertSpan = db.prepare(
    "INSERT INTO spans (trace_id, span_id, parent_id, service, name, kind, start_ns, end_ns, status, attributes, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertLog = db.prepare("INSERT INTO logs (time_ns, service, severity, body, trace_id, span_id, attributes, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertPoint = db.prepare("INSERT INTO points (time_ns, service, metric, attributes, value, histogram, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const readSize = db.prepare("SELECT rows, bytes FROM sizes WHERE signal = ?");
  const deleteAged = Object.fromEntries(
    SIGNALS.map((signal) => [
      signal,
      db.prepare(`DELETE FROM ${signal} WHERE rowid IN (SELECT rowid FROM ${signal} WHERE ${TIME_COLUMN[signal]} < ? ORDER BY ${TIME_COLUMN[signal]} LIMIT ?)`),
    ]),
  ) as Record<Signal, StatementSync>;
  const deleteOldest = Object.fromEntries(
    SIGNALS.map((signal) => [signal, db.prepare(`DELETE FROM ${signal} WHERE rowid IN (SELECT rowid FROM ${signal} ORDER BY ${TIME_COLUMN[signal]} LIMIT ?)`)]),
  ) as Record<Signal, StatementSync>;

  const size = (signal: Signal): SignalSize => {
    const row = readSize.get(signal);
    return { rows: Number(row?.["rows"] ?? 0), bytes: Number(row?.["bytes"] ?? 0) };
  };

  /** A budget of deletes. Each delete takes one unit of it. `complete` is false when a prune stopped with work left. */
  interface Budget {
    left: number;
    complete: boolean;
  }
  const unbounded = (): Budget => ({ left: Number.POSITIVE_INFINITY, complete: true });

  const age = (signal: Signal, cutoff: bigint, budget: Budget): number => {
    let deleted = 0;
    for (;;) {
      if (budget.left <= 0) {
        budget.complete = false;
        return deleted;
      }
      budget.left--;
      const changes = Number(transaction(db, () => deleteAged[signal].run(cutoff, batch)).changes);
      deleted += changes;
      if (changes < batch) return deleted;
    }
  };

  const cap = (signal: Signal, budget: Budget): number => {
    let deleted = 0;
    for (;;) {
      const { rows, bytes } = size(signal);
      const excess = bytes - rules[signal].maxBytes;
      if (excess <= 0 || rows === 0) return deleted;
      if (budget.left <= 0) {
        budget.complete = false;
        return deleted;
      }
      budget.left--;
      const count = Math.min(batch, rows, Math.max(1, Math.ceil(excess / (bytes / rows))));
      deleted += Number(transaction(db, () => deleteOldest[signal].run(count)).changes);
    }
  };

  let closed = false;
  return {
    db,
    rules,
    insert(rows) {
      transaction(db, () => {
        for (const r of rows.spans ?? [])
          insertSpan.run(r.traceId, r.spanId, r.parentId, r.service, r.name, r.kind, r.startNs, r.endNs, r.status, r.attributes, spanBytes(r));
        for (const r of rows.logs ?? []) insertLog.run(r.timeNs, r.service, r.severity, r.body, r.traceId, r.spanId, r.attributes, logBytes(r));
        for (const r of rows.points ?? []) insertPoint.run(r.timeNs, r.service, r.metric, r.attributes, r.value, r.histogram, pointBytes(r));
      });
      for (const signal of SIGNALS) if ((rows[signal]?.length ?? 0) > 0) cap(signal, unbounded());
    },
    prune(nowMs, batches = Number.POSITIVE_INFINITY) {
      if (!(batches >= 1)) throw new RangeError(`batches must be 1 or more: ${batches}`);
      const budget: Budget = { left: batches, complete: true };
      const result = {} as Record<Signal, SignalPrune>;
      for (const signal of SIGNALS) {
        const cutoff = BigInt(Math.floor(nowMs - rules[signal].maxAgeMs)) * 1_000_000n;
        const aged = age(signal, cutoff, budget);
        result[signal] = { aged, capped: cap(signal, budget) };
      }
      db.exec("PRAGMA incremental_vacuum");
      return { ...result, done: budget.complete };
    },
    sizes() {
      return { spans: size("spans"), logs: size("logs"), points: size("points") };
    },
    fileBytes() {
      const pages = Number(db.prepare("PRAGMA page_count").get()?.["page_count"] ?? 0);
      const pageSize = Number(db.prepare("PRAGMA page_size").get()?.["page_size"] ?? 0);
      return pages * pageSize;
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
};

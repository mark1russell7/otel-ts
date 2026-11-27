import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { ServiceBuilder } from "@mark1russell7/service";
import { handle, httpTransport, pathOf, type RequestHandler } from "@mark1russell7/service/http";
import { logRows, OtlpShapeError, pointRows, spanRows, type LogsExport, type MetricsExport, type TracesExport } from "./otlp.ts";
import { errors, services, slowest, trace, TRACE_ID, windowProblems, type Window } from "./query.ts";
import type { Rows, Store } from "./store.ts";

const unzip = promisify(gunzip);

/** These are the options of the API of the service. */
export interface ApiOptions {
  /** This number is the port of the API. */
  readonly port: number;
  /** This function gives the store. It throws before the store opens. */
  readonly store: () => Store;
  /** This function gives the time in milliseconds since the epoch. The default is `Date.now`. */
  readonly now?: (() => number) | undefined;
}

/** The most bytes of the body of one export, after gzip: 8 MiB */
export const MAX_BODY_BYTES: number = 8 * 1024 * 1024;

/** The paths of the OTLP/HTTP receiver, and the rows of each body */
const RECEIVERS: Readonly<Record<string, (body: unknown) => Rows>> = {
  "/v1/traces": (body) => ({ spans: spanRows(body as TracesExport) }),
  "/v1/logs": (body) => ({ logs: logRows(body as LogsExport) }),
  "/v1/metrics": (body) => ({ points: pointRows(body as MetricsExport) }),
};

/** The window of a query without `since`: the last hour */
export const DEFAULT_WINDOW_MS: number = 60 * 60 * 1000;
/** The most rows of a query without `limit` */
export const DEFAULT_LIMIT = 50;

/** The routes of the queries. Each one is idempotent. */
export const QUERY_ROUTES = ["GET /api/slowest", "GET /api/errors", "GET /api/services", "GET /api/trace", "GET /api/stats"] as const;

const s = (value: number) => ({ value, unit: "s" });

const reply = (res: ServerResponse, status: number, body: unknown): true => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
  return true;
};

class TooLargeError extends Error {}

/** The most bytes that the receiver reads and drops after a refusal. Past it, the receiver closes the connection. */
export const MAX_DISCARD_BYTES: number = 8 * MAX_BODY_BYTES;

/**
 * This function reads the rest of a body and drops it, up to `MAX_DISCARD_BYTES`. Thus the client reads the refusal
 * before the connection closes, and it does not get a reset. Past that size, it destroys the connection.
 */
const discard = (req: IncomingMessage, already = 0): Promise<void> =>
  new Promise((resolve) => {
    if (req.readableEnded) return resolve();
    let size = already;
    req.removeAllListeners("data");
    req.on("data", (part: Buffer) => {
      size += part.length;
      if (size > MAX_DISCARD_BYTES) {
        req.destroy();
        resolve();
      }
    });
    req.once("end", () => resolve());
    req.once("close", () => resolve());
    req.once("error", () => resolve());
  });

/** This function reads a body up to `MAX_BODY_BYTES`. Past that size, it drops the rest and rejects with a `TooLargeError`. */
const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_DISCARD_BYTES) {
      req.destroy();
      return reject(new TooLargeError());
    }
    if (declared > MAX_BODY_BYTES) return void discard(req).then(() => reject(new TooLargeError()));
    const parts: Buffer[] = [];
    let size = 0;
    const onData = (part: Buffer): void => {
      size += part.length;
      if (size <= MAX_BODY_BYTES) return void parts.push(part);
      req.off("end", onEnd);
      void discard(req, size).then(() => reject(new TooLargeError()));
    };
    const onEnd = (): void => resolve(Buffer.concat(parts));
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", reject);
  });

/**
 * This function gives the handler of the OTLP/HTTP receiver: `POST /v1/traces`, `/v1/logs` and `/v1/metrics` with a
 * body of OTLP JSON, with gzip or without it. It answers 415 to another type, 413 to a large body and 400 to a body
 * that is not OTLP JSON. The handler writes its own status, so it is a mount of the transport, not a route of `handle`.
 */
export const receiver = (store: () => Store): RequestHandler => {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const toRows = req.method === "POST" ? RECEIVERS[pathOf(req.url)] : undefined;
    if (toRows === undefined) return false;
    const type = String(req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") {
      await discard(req);
      return reply(res, 415, { error: "the sink takes only OTLP JSON. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json in the sender." });
    }
    const encoding = String(req.headers["content-encoding"] ?? "identity").toLowerCase();
    if (encoding !== "identity" && encoding !== "gzip") {
      await discard(req);
      return reply(res, 415, { error: `the sink takes no content encoding ${encoding}: only gzip or none` });
    }
    let rows: Rows;
    try {
      const raw = await readBody(req);
      const text = encoding === "gzip" ? await unzip(raw, { maxOutputLength: MAX_BODY_BYTES }) : raw;
      rows = toRows(JSON.parse(text.toString("utf8")) as unknown);
    } catch (error) {
      if (error instanceof TooLargeError || (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE")
        return reply(res, 413, { error: `the body is larger than ${MAX_BODY_BYTES} bytes` });
      if (error instanceof SyntaxError || error instanceof OtlpShapeError || (error as { code?: unknown }).code === "Z_DATA_ERROR")
        return reply(res, 400, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    store().insert(rows);
    // The success of OTLP/HTTP JSON: an empty response message, thus no partial success
    return reply(res, 200, {});
  };
  return handler;
};

/** This function gives the window of a query from the query string of its target. */
export const windowOf = (url: string | undefined, nowMs: number): Window => {
  const query = new URL(url ?? "/", "http://sink").searchParams;
  const since = query.get("since");
  const limit = query.get("limit");
  const service = query.get("service");
  return {
    sinceMs: since === null ? nowMs - DEFAULT_WINDOW_MS : Number(since),
    limit: limit === null ? DEFAULT_LIMIT : Number(limit),
    ...(service === null || service === "" ? {} : { service }),
  };
};

const traceIdOf = (url: string | undefined): string => new URL(url ?? "/", "http://sink").searchParams.get("id")?.toLowerCase() ?? "";

/**
 * This function gives the handler that answers 400 to a query with bad parameters. It gives false for each other
 * request, so the next handler gets it.
 */
const queryCheck = (now: () => number): RequestHandler => {
  const handler = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (req.method !== "GET") return false;
    const path = pathOf(req.url);
    if (!QUERY_ROUTES.includes(`GET ${path}` as (typeof QUERY_ROUTES)[number])) return false;
    const problems = path === "/api/trace" ? (TRACE_ID.test(traceIdOf(req.url)) ? [] : ["id must be a trace id of 32 hex digits"]) : windowProblems(windowOf(req.url, now()));
    return problems.length === 0 ? false : reply(res, 400, { problems });
  };
  return handler;
};

/**
 * This function gives the API to the service of the entry: an HTTP server with the OTLP/HTTP receiver and the
 * queries. The API is a component. It does not start the server, and it does not use `run()`.
 */
export const attachApi = (svc: ServiceBuilder, options: ApiOptions): ServiceBuilder => {
  const now = options.now ?? Date.now;
  const store = options.store;
  // The transport has no defaults: the idle close, the sweep of idle connections and the Retry-After of each 503.
  const http = httpTransport(
    createServer(),
    { server_idle_close: s(65), server_idle_sweep_interval: s(1), server_retry_after: s(1) },
    { listen: { port: options.port } },
  );
  http.mount(receiver(store));
  http.mount(queryCheck(now));
  // Each query goes through the service. Thus the drain waits for it, and the shutdown can cut it.
  http.mount(handle("api", "GET /api/slowest", (req) => slowest(store().db, windowOf(req.url, now()))));
  http.mount(handle("api", "GET /api/errors", (req) => errors(store().db, windowOf(req.url, now()))));
  http.mount(handle("api", "GET /api/services", (req) => services(store().db, windowOf(req.url, now()))));
  http.mount(handle("api", "GET /api/trace", (req) => trace(store().db, traceIdOf(req.url))));
  http.mount(
    handle("api", "GET /api/stats", () => {
      const opened = store();
      return { sizes: opened.sizes(), fileBytes: opened.fileBytes(), rules: opened.rules };
    }),
  );
  const api = svc.controller("api").requires("store");
  for (const route of QUERY_ROUTES) api.route(route, { idempotent: true });
  return svc.server("http", http.knobs, http);
};

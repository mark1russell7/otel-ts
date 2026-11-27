import { createServer, type IncomingMessage } from "node:http";
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

/** A JSON reply is the status and the JSON body of one response. */
interface JsonReply {
  readonly status: number;
  readonly body: unknown;
}

/** These options of `handle` write a JSON reply with its status. A 4xx is a reply, not a failure of the work. */
const asJson = {
  done: (reply: JsonReply) => ({ status: reply.status, headers: { "content-type": "application/json" }, body: JSON.stringify(reply.body) }),
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

/** The routes of the OTLP/HTTP receiver. A retry of an export can add the same rows again, so no route is idempotent. */
export const RECEIVER_ROUTES = ["POST /v1/traces", "POST /v1/logs", "POST /v1/metrics"] as const;

const refusal = (status: number, error: string): JsonReply => ({ status, body: { error } });

/** This function gives the name of the receiver route of a request, or null for a request of another handler. */
const receiverRouteOf = (req: IncomingMessage): string | null => {
  const name = `${req.method ?? "GET"} ${pathOf(req.url)}`;
  return (RECEIVER_ROUTES as readonly string[]).includes(name) ? name : null;
};

/**
 * This function reads one export and stores its rows. A refusal is a reply with its status, not a failure of the
 * work: a 4xx is an error of the client, thus the request tracking records it as done.
 */
const receive = async (req: IncomingMessage, store: () => Store): Promise<JsonReply> => {
  const toRows = RECEIVERS[pathOf(req.url)];
  if (toRows === undefined) throw new Error(`no receiver for ${pathOf(req.url)}`);
  const type = String(req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    await discard(req);
    return refusal(415, "the sink takes only OTLP JSON. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json in the sender.");
  }
  const encoding = String(req.headers["content-encoding"] ?? "identity").toLowerCase();
  if (encoding !== "identity" && encoding !== "gzip") {
    await discard(req);
    return refusal(415, `the sink takes no content encoding ${encoding}: only gzip or none`);
  }
  let rows: Rows;
  try {
    const raw = await readBody(req);
    const text = encoding === "gzip" ? await unzip(raw, { maxOutputLength: MAX_BODY_BYTES }) : raw;
    rows = toRows(JSON.parse(text.toString("utf8")) as unknown);
  } catch (error) {
    if (error instanceof TooLargeError || (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE")
      return refusal(413, `the body is larger than ${MAX_BODY_BYTES} bytes`);
    if (error instanceof SyntaxError || error instanceof OtlpShapeError || (error as { code?: unknown }).code === "Z_DATA_ERROR")
      return refusal(400, error instanceof Error ? error.message : String(error));
    throw error;
  }
  store().insert(rows);
  // The success of OTLP/HTTP JSON: an empty response message, thus no partial success
  return { status: 200, body: {} };
};

/**
 * This function gives the handler of the OTLP/HTTP receiver: `POST /v1/traces`, `/v1/logs` and `/v1/metrics` with a
 * body of OTLP JSON, with gzip or without it. It answers 415 to another type, 413 to a large body and 400 to a body
 * that is not OTLP JSON. Each export goes through the service, as each query does. Thus the drain waits for it.
 */
export const receiver = (store: () => Store): RequestHandler =>
  handle<JsonReply>("receiver", receiverRouteOf, (req) => receive(req, store), asJson);

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
 * This function gives the handler of one query route. It answers 400 with the problems of bad parameters, and else
 * 200 with the answer as JSON. Each query goes through the service. Thus the drain waits for it, and the shutdown can
 * cut it.
 */
const query = (route: (typeof QUERY_ROUTES)[number], answer: (window: Window, req: IncomingMessage) => unknown, now: () => number): RequestHandler =>
  handle<JsonReply>(
    "api",
    route,
    (req) => {
      const window = windowOf(req.url, now());
      const problems = route === "GET /api/trace" ? (TRACE_ID.test(traceIdOf(req.url)) ? [] : ["id must be a trace id of 32 hex digits"]) : windowProblems(window);
      return problems.length === 0 ? { status: 200, body: answer(window, req) } : { status: 400, body: { problems } };
    },
    asJson,
  );

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
  // Each export and each query goes through the service, with its own status. No handler writes a raw response.
  http.mount(receiver(store));
  http.mount(query("GET /api/slowest", (window) => slowest(store().db, window), now));
  http.mount(query("GET /api/errors", (window) => errors(store().db, window), now));
  http.mount(query("GET /api/services", (window) => services(store().db, window), now));
  http.mount(query("GET /api/trace", (_window, req) => trace(store().db, traceIdOf(req.url)), now));
  http.mount(
    query(
      "GET /api/stats",
      () => {
        const opened = store();
        return { sizes: opened.sizes(), fileBytes: opened.fileBytes(), rules: opened.rules };
      },
      now,
    ),
  );
  const received = svc.controller("receiver").requires("store");
  for (const route of RECEIVER_ROUTES) received.route(route, { idempotent: false });
  const api = svc.controller("api").requires("store");
  for (const route of QUERY_ROUTES) api.route(route, { idempotent: true });
  return svc.server("http", http.knobs, http);
};

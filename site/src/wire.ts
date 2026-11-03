/**
 * The in-page collector. The exporters of `init()` send each batch with `fetch`. This module replaces `fetch` before
 * `init()` runs, so that the fetch instrumentation wraps it and the OTLP transport finds it as the original. A request to
 * the collector URL or to the stand-in API ends here, and its bytes never go to a network. A request to the origin of
 * the page goes on to the browser `fetch`.
 */
import type { OtlpBody, Signal } from "./otlp.ts";

/** The collector URL of the demo. The top-level domain `.invalid` does not resolve (RFC 2606). */
export const COLLECTOR = "https://collector.invalid";

/** The API on another origin. This module answers its requests. */
export const OTHER_ORIGIN = "https://api.example.invalid";

/** This function tells if a URL is at an origin. It parses the URL, so a longer host name does not match. */
export function isAt(url: string, origin: string): boolean {
  return URL.canParse(url) && new URL(url).origin === origin;
}

/** One export, as the transport of the package gave it. */
export interface ExportRecord {
  readonly id: number;
  /** The time of the export, in `Date.now()` time. */
  readonly at: number;
  readonly signal: Signal;
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: number;
  /** The body, as the transport gave it. */
  readonly text: string;
  readonly body: OtlpBody;
}

/** One request of the page, after the fetch instrumentation added its headers. */
export interface RequestRecord {
  readonly url: string;
  /** The value of the `traceparent` header, or undefined when the request has none. */
  readonly traceparent: string | undefined;
  /** True when this module answered the request, and false when the request went to the browser `fetch`. */
  readonly stubbed: boolean;
}

/** The function that gets each export. */
export type ExportListener = (record: ExportRecord) => void;

/** The function that gets each request of the page. */
export type RequestListener = (record: RequestRecord) => void;

const SIGNALS: Readonly<Record<string, Signal>> = { "/v1/traces": "traces", "/v1/metrics": "metrics", "/v1/logs": "logs" };

/** This function gives the text of a request body. The OTLP transport gives a `Uint8Array`. */
export function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  return "";
}

/** The objects of the collector. */
export interface Wire {
  /** The function that goes in place of the browser `fetch`. */
  readonly fetch: typeof globalThis.fetch;
  /** This function adds a listener of the exports. The listener first gets the earlier exports. */
  onExport(listener: ExportListener): void;
  /** This function adds a listener of the requests. */
  onRequest(listener: RequestListener): void;
}

/** This function makes the collector. `network` is the browser `fetch`. */
export function createWire(network: typeof globalThis.fetch): Wire {
  const records: ExportRecord[] = [];
  const exportListeners: ExportListener[] = [];
  const requestListeners: RequestListener[] = [];

  const collect = (url: string, options: RequestInit | undefined): Response => {
    const signal = SIGNALS[new URL(url).pathname];
    if (signal === undefined) return new Response(null, { status: 404 });
    const text = bodyText(options?.body);
    const record: ExportRecord = {
      id: records.length + 1,
      at: Date.now(),
      signal,
      url,
      method: options?.method ?? "GET",
      headers: Object.fromEntries([...new Headers(options?.headers).entries()].map(([name, value]) => [name.toLowerCase(), value])),
      bytes: new TextEncoder().encode(text).length,
      text,
      body: JSON.parse(text) as OtlpBody,
    };
    records.push(record);
    for (const listener of exportListeners) listener(record);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  const inPage: typeof globalThis.fetch = (input, options) => {
    const url = input instanceof Request ? input.url : String(input);
    if (isAt(url, COLLECTOR)) return Promise.resolve(collect(url, options));
    const headers = new Headers(input instanceof Request ? input.headers : options?.headers);
    const stubbed = isAt(url, OTHER_ORIGIN);
    const request: RequestRecord = { url, traceparent: headers.get("traceparent") ?? undefined, stubbed };
    for (const listener of requestListeners) listener(request);
    if (!stubbed) return network(input, options);
    return Promise.resolve(new Response('{"answer":"from this page"}', { status: 200, headers: { "content-type": "application/json" } }));
  };

  return {
    fetch: inPage,
    onExport(listener) {
      exportListeners.push(listener);
      for (const record of records) listener(record);
    },
    onRequest(listener) {
      requestListeners.push(listener);
    },
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { init } from "../src/index.js";
import type { OtelTsConfig, OtelTsInstance } from "../src/index.js";

// Real tracing and the real fetch instrumentation. Only the network is
// replaced: the exporter, and the fetch() that the instrumentation wraps.
vi.mock("@opentelemetry/exporter-trace-otlp-http", async () => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return { OTLPTraceExporter: FakeExporter };
});

/** The traceparent header of each request that reached the network, by URL */
const sent = new Map<string, string | null>();

let otel: OtelTsInstance | undefined;
let realFetch: typeof fetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  // A new fetch() for each test: the instrumentation of the test wraps it
  globalThis.fetch = async (input: RequestInfo | URL, options?: RequestInit) => {
    const request = new Request(input, options);
    sent.set(request.url, request.headers.get("traceparent"));
    return new Response("ok");
  };
});

afterEach(async () => {
  await otel?.shutdown();
  otel = undefined;
  globalThis.fetch = realFetch;
  sent.clear();
  trace.disable();
  context.disable();
  propagation.disable();
  sessionStorage.clear();
});

function start(config: OtelTsConfig = {}): void {
  otel = init({
    faro: false,
    metrics: false,
    logs: false,
    instrumentDocumentLoad: false,
    instrumentUserInteraction: false,
    instrumentXhr: false,
    instrumentLongTask: false,
    ...config,
  });
}

const sameOrigin = () => `${location.origin}/api/items`;
const otherOrigin = "https://third-party.example/collect";
const ownApi = "https://api.example.com/items";

describe("trace headers of fetch()", () => {
  it("go only to the origin of the page by default", async () => {
    start();

    await fetch(sameOrigin());
    await fetch(otherOrigin);

    expect(sent.get(sameOrigin())).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    // Before, the default [/.*/] sent it to each origin, and a server without
    // traceparent in its CORS headers refused the request
    expect(sent.get(otherOrigin)).toBeNull();
  });

  it("also go to the origins of propagateTraceHeaderCorsUrls", async () => {
    start({ propagateTraceHeaderCorsUrls: [/^https:\/\/api\.example\.com\//] });

    await fetch(ownApi);
    await fetch(otherOrigin);

    expect(sent.get(ownApi)).toMatch(/^00-/);
    expect(sent.get(otherOrigin)).toBeNull();
  });
});

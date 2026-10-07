// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  context,
  diag,
  DiagLogLevel,
  propagation,
  trace,
} from "@opentelemetry/api";
import { initializeFaro } from "@grafana/faro-web-sdk";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { init } from "../src/init.js";
import { getOrCreateSessionId } from "../src/session.js";
import { SESSION_TTL_MS } from "../src/constants.js";
import { FakeExporter, exportedTo } from "./support/fake-exporter.js";

// Real providers and instrumentations; only the network layer is replaced
vi.mock("@opentelemetry/exporter-trace-otlp-http", async () => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return { OTLPTraceExporter: FakeExporter };
});
vi.mock("@opentelemetry/exporter-metrics-otlp-http", async (importOriginal) => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return {
    ...(await importOriginal<
      typeof import("@opentelemetry/exporter-metrics-otlp-http")
    >()),
    OTLPMetricExporter: FakeExporter,
  };
});
vi.mock("@opentelemetry/exporter-logs-otlp-http", async () => {
  const { FakeExporter } = await import("./support/fake-exporter.js");
  return { OTLPLogExporter: FakeExporter };
});
vi.mock("@grafana/faro-web-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grafana/faro-web-sdk")>()),
  initializeFaro: vi.fn(),
}));

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("without a DOM (Web Worker)", () => {
  beforeEach(() => {
    // Make Node look like a dedicated worker: no Web Storage (Node 25+ has
    // it), but XMLHttpRequest (Node lacks it)
    vi.stubGlobal("sessionStorage", undefined);
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        open(): void {}
        send(): void {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    diag.disable();
    trace.disable();
    context.disable();
    propagation.disable();
    FakeExporter.instances.length = 0;
  });

  it("runs where document, window and sessionStorage do not exist", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    expect(typeof sessionStorage).toBe("undefined");
  });

  it("initializes, flushes and shuts down", async () => {
    const errors: unknown[][] = [];
    diag.setLogger(
      {
        error: (...args) => errors.push(args),
        warn: () => {},
        info: () => {},
        debug: () => {},
        verbose: () => {},
      },
      DiagLogLevel.ERROR,
    );

    // With a collector URL, so only the missing DOM keeps Faro out
    const otel = init({ faroCollectorUrl: "https://faro.example.com/collect" });

    expect(otel.getSessionId()).toMatch(UUID);
    // Faro and the DOM-only instrumentations are skipped, not failed
    expect(initializeFaro).not.toHaveBeenCalled();
    expect(errors).toEqual([]);

    await expect(otel.forceFlush()).resolves.toBeUndefined();
    await expect(otel.shutdown()).resolves.toBeUndefined();
  });

  it("keeps one session in memory, with the same TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const otel = init({ tracing: false, metrics: false });
    const logger = otel.getLogger("test");
    const sessionId = otel.getSessionId();

    logger.emit({ body: "first" });
    vi.setSystemTime(Date.now() + SESSION_TTL_MS - 1);
    logger.emit({ body: "second" });
    vi.setSystemTime(Date.now() + SESSION_TTL_MS);
    logger.emit({ body: "after 30 idle minutes" });
    await otel.shutdown();

    const [first, second, third] = exportedTo<ReadableLogRecord>(
      "/v1/logs",
    ).map((record) => record.attributes["session.id"]);
    expect([first, second]).toEqual([sessionId, sessionId]);
    expect(third).toMatch(UUID);
    expect(third).not.toBe(sessionId);
  });

  it("gives every init() its own service.instance.id", async () => {
    for (let i = 0; i < 2; i++) {
      const otel = init({ tracing: false, metrics: false });
      otel.getLogger("test").emit({ body: "hello" });
      await otel.shutdown();
    }

    const ids = exportedTo<ReadableLogRecord>("/v1/logs").map(
      (record) => record.resource.attributes["service.instance.id"],
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(UUID);
    expect(ids[1]).toMatch(UUID);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("creates a session ID without sessionStorage", () => {
    const sessionId = getOrCreateSessionId(60_000);

    expect(sessionId).toMatch(UUID);
    // Nothing to persist it in
    expect(getOrCreateSessionId(60_000)).not.toBe(sessionId);
  });
});

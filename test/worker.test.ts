// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diag, DiagLogLevel } from "@opentelemetry/api";
import { initializeFaro } from "@grafana/faro-web-sdk";
import { init } from "../src/init.js";
import { getOrCreateSessionId } from "../src/session.js";

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
    diag.disable();
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

    const otel = init();

    expect(otel.getSessionId()).toMatch(UUID);
    // Faro and the DOM-only instrumentations are skipped, not failed
    expect(initializeFaro).not.toHaveBeenCalled();
    expect(errors).toEqual([]);

    await expect(otel.forceFlush()).resolves.toBeUndefined();
    await expect(otel.shutdown()).resolves.toBeUndefined();
  });

  it("creates a session ID without sessionStorage", () => {
    const sessionId = getOrCreateSessionId(60_000);

    expect(sessionId).toMatch(UUID);
    // Nothing to persist it in
    expect(getOrCreateSessionId(60_000)).not.toBe(sessionId);
  });
});

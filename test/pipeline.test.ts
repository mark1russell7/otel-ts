import { afterEach, describe, expect, it, vi } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { initializeFaro } from "@grafana/faro-web-sdk";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import type { ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { OtelTsConfig, OtelTsInstance } from "../src/index.js";
import { init } from "../src/init.js";
import { SESSION_TTL_MS } from "../src/constants.js";
import { FakeExporter, exportedTo } from "./support/fake-exporter.js";
import { hidePage, resetVisibility, setVisibility } from "./support/page.js";
import { UUID_V4 } from "./support/uuid.js";

// Real providers and processors; only the network layer is replaced
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

// No auto-instrumentation: the tests make their own spans
const QUIET: OtelTsConfig = {
  faro: false,
  instrumentDocumentLoad: false,
  instrumentFetch: false,
  instrumentXhr: false,
  instrumentUserInteraction: false,
  instrumentLongTask: false,
};

let otel: OtelTsInstance | undefined;

async function run(
  config: OtelTsConfig,
  emit: (otel: OtelTsInstance) => void,
): Promise<OtelTsInstance> {
  otel = init({ ...QUIET, ...config });
  emit(otel);
  await otel.forceFlush();
  return otel;
}

afterEach(async () => {
  await otel?.shutdown();
  otel = undefined;
  FakeExporter.instances.length = 0;
  trace.disable();
  context.disable();
  propagation.disable();
  resetVisibility();
  vi.useRealTimers();
  vi.clearAllMocks();
  sessionStorage.clear();
});

/** The value of counter `name` in the latest metrics export, if any */
function exportedCount(name: string): unknown {
  return exportedTo<ResourceMetrics>("/v1/metrics")
    .at(-1)
    ?.scopeMetrics.flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === name)?.dataPoints[0]?.value;
}

describe("exported telemetry", () => {
  it("has service.instance.id and no session.id on the metrics resource", async () => {
    await run({ tracing: false, logs: false }, (otel) => {
      otel.getMeter("test").createCounter("test.count").add(1);
    });

    const [metrics] = exportedTo<ResourceMetrics>("/v1/metrics");
    expect(metrics!.resource.attributes).toMatchObject({
      "service.name": "frontend-app",
      "service.instance.id": expect.stringMatching(UUID_V4),
    });
    expect(metrics!.resource.attributes).not.toHaveProperty(["session.id"]);
  });

  it("has the current session.id on each log record, not on the resource", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const sessions: string[] = [];

    await run({ tracing: false, metrics: false }, (otel) => {
      const logger = otel.getLogger("test");
      logger.emit({ body: "first" });
      sessions.push(otel.getSessionId());

      // 30 minutes without activity rotate the session
      vi.setSystemTime(Date.now() + SESSION_TTL_MS);
      logger.emit({ body: "second" });
      sessions.push(otel.getSessionId());
    });

    const records = exportedTo<ReadableLogRecord>("/v1/logs");
    expect(sessions[0]).not.toBe(sessions[1]);
    expect(records.map((record) => record.attributes["session.id"])).toEqual(
      sessions,
    );
    for (const record of records) {
      expect(record.resource.attributes).not.toHaveProperty(["session.id"]);
    }
  });

  it("has the current session.id on each span, not on the resource", async () => {
    const { getSessionId } = await run(
      { metrics: false, logs: false },
      () => {
        trace.getTracer("test").startSpan("work").end();
      },
    );

    const [span] = exportedTo<ReadableSpan>("/v1/traces");
    expect(span!.attributes["session.id"]).toBe(getSessionId());
    expect(span!.resource.attributes).not.toHaveProperty(["session.id"]);
  });

  it("uses one service.instance.id for metrics, logs and spans", async () => {
    await run({}, (otel) => {
      otel.getMeter("test").createCounter("test.count").add(1);
      otel.getLogger("test").emit({ body: "hello" });
      trace.getTracer("test").startSpan("work").end();
    });

    const [metrics] = exportedTo<ResourceMetrics>("/v1/metrics");
    const [record] = exportedTo<ReadableLogRecord>("/v1/logs");
    const [span] = exportedTo<ReadableSpan>("/v1/traces");
    const instanceId = metrics!.resource.attributes["service.instance.id"];

    expect(instanceId).toMatch(UUID_V4);
    expect(record!.resource.attributes["service.instance.id"]).toBe(instanceId);
    expect(span!.resource.attributes["service.instance.id"]).toBe(instanceId);
  });
});

describe("onBeforeFlush", () => {
  function startWithFinalValue(): OtelTsInstance {
    otel = init({ ...QUIET, tracing: false, logs: false });
    const final = otel.getMeter("test").createCounter("test.final");
    // Stands in for a monitor that records its pending values on demand
    otel.onBeforeFlush(() => final.add(5));
    return otel;
  }

  it("exports what listeners record in the page-hide flush", async () => {
    startWithFinalValue();

    setVisibility("hidden");

    await vi.waitFor(() => expect(exportedCount("test.final")).toBe(5));
  });

  it("exports what listeners record in the final shutdown", async () => {
    const otel = startWithFinalValue();

    // The page is discarded: the only export left is the shutdown's
    hidePage(false);
    await otel.shutdown();

    expect(exportedCount("test.final")).toBe(5);
  });
});

describe("Faro", () => {
  it("starts with faroCollectorUrl", () => {
    otel = init({
      ...QUIET,
      tracing: false,
      faro: true,
      faroCollectorUrl: "https://faro.example.com/collect",
    });

    expect(initializeFaro).toHaveBeenCalledOnce();
    expect(initializeFaro).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://faro.example.com/collect" }),
    );
  });

  it("does not start without faroCollectorUrl, so it logs no error", () => {
    // Faro without a URL or transports logs:
    // either "url" or "transports" must be defined
    otel = init({ ...QUIET, tracing: false, faro: true });

    expect(initializeFaro).not.toHaveBeenCalled();
  });
});

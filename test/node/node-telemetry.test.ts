import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExportResultCode } from "@opentelemetry/core";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { startNodeTelemetry, type NodeTelemetry } from "../../src/node.js";
import { startStubCollector, type StubCollector } from "../../src/node-testing.js";

let telemetry: NodeTelemetry | undefined;
let collector: StubCollector | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  await collector?.close();
  telemetry = undefined;
  collector = undefined;
});

describe("startNodeTelemetry", () => {
  it("starts nothing when OTEL_EXPORTER_OTLP_ENDPOINT has no value", async () => {
    telemetry = startNodeTelemetry({ env: {}, importMetaUrl: import.meta.url });
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.esmHook).toBe(false);
    await telemetry.shutdown();
  });

  it("exports the spans to the collector of the endpoint", async () => {
    collector = await startStubCollector();
    telemetry = startNodeTelemetry({
      serviceName: "otel-ts-node-test",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint },
      traceExporter: new OTLPTraceExporter({ url: `${collector.endpoint}/v1/traces` }),
      stopOnSignals: false,
    });
    expect(telemetry.enabled).toBe(true);
    expect(telemetry.esmHook).toBe(false);

    trace.getTracer("otel-ts-node-test-scope").startSpan("work").end();
    await telemetry.shutdown(); // the stop flushes the spans

    expect(collector.exports).toBeGreaterThan(0);
    expect(collector.spansByScope().get("otel-ts-node-test-scope")).toEqual(new Set(["work"]));
    expect(collector.has(["otel-ts-node-test-scope"])).toBe(true);
    expect(collector.missing(["otel-ts-node-test-scope", "absent-scope"])).toEqual(["absent-scope"]);
  });

  it("does nothing at a second stop", async () => {
    collector = await startStubCollector();
    telemetry = startNodeTelemetry({
      enabled: true,
      env: {},
      traceExporter: new OTLPTraceExporter({ url: `${collector.endpoint}/v1/traces` }),
      stopOnSignals: false,
    });
    await telemetry.shutdown();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});

describe("startNodeTelemetry at SIGTERM and SIGINT", () => {
  const signals = ["SIGTERM", "SIGINT"] as const;
  let saved: Map<NodeJS.Signals, Array<(...args: unknown[]) => void>>;

  // The listeners of the test runner stay out of the count of the service's listeners
  beforeEach(() => {
    saved = new Map(signals.map((signal) => [signal, process.rawListeners(signal) as Array<(...args: unknown[]) => void>]));
    for (const signal of signals) process.removeAllListeners(signal);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const signal of signals) {
      process.removeAllListeners(signal);
      for (const listener of saved.get(signal) ?? []) process.on(signal, listener);
    }
  });

  /** Start the SDK with an exporter that records its stop, and a process.kill that does nothing */
  function start(): { stopped: () => boolean; kill: ReturnType<typeof vi.spyOn> } {
    let stopped = false;
    const exporter: SpanExporter = {
      export: (_spans, done) => done({ code: ExportResultCode.SUCCESS }),
      shutdown: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        stopped = true;
      },
    };
    telemetry = startNodeTelemetry({ enabled: true, env: {}, traceExporter: exporter });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    return { stopped: () => stopped, kill };
  }

  for (const signal of signals) {
    it(`flushes, then raises ${signal} again when the service has no listener of its own`, async () => {
      const { stopped, kill } = start();
      let stoppedBeforeKill = false;
      kill.mockImplementation(() => {
        stoppedBeforeKill = stopped();
        return true;
      });

      process.emit(signal, signal);

      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, signal));
      expect(kill).toHaveBeenCalledTimes(1);
      expect(stoppedBeforeKill).toBe(true);
      // The listener is gone, so the raised signal gets the default action of Node.js
      expect(process.listenerCount(signal)).toBe(0);
    });
  }

  it("flushes, and lets the listener of the service end the process", async () => {
    const own = vi.fn();
    process.once("SIGTERM", own);
    const { stopped, kill } = start();

    process.emit("SIGTERM", "SIGTERM");
    await telemetry?.shutdown(); // waits for the flush that the signal started

    expect(stopped()).toBe(true);
    expect(own).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  // Windows has no signals: there, process.kill() always ends the process
  it.skipIf(process.platform === "win32")("ends a service that has no listener at SIGTERM", async () => {
    // The built entry (CI builds before the tests): a child process cannot load the TypeScript source
    const entry = new URL("../../dist/node.js", import.meta.url).href;
    const service = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          `import { startNodeTelemetry } from ${JSON.stringify(entry)};`,
          "startNodeTelemetry({ enabled: true, env: {}, traceExporter: { export: (s, done) => done({ code: 0 }), shutdown: async () => {} } });",
          "setInterval(() => {}, 1000);",
          "console.log('ready');",
        ].join("\n"),
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const exit = once(service, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
    // "ready", or an exit when the service fails to start
    await Promise.race([once(service.stdout, "data"), exit]);
    service.kill("SIGTERM");
    const timeout = setTimeout(() => service.kill("SIGKILL"), 10_000);
    const [, signal] = await exit;
    clearTimeout(timeout);
    // Before, the service continued to run, and only SIGKILL ended it
    expect(signal).toBe("SIGTERM");
  }, 20_000);

  it("adds no listener when stopOnSignals is false", () => {
    telemetry = startNodeTelemetry({ enabled: true, env: {}, stopOnSignals: false });
    expect(signals.map((signal) => process.listenerCount(signal))).toEqual([0, 0]);
  });
});

describe("startStubCollector", () => {
  it("gives the scopes that are still missing when the time is up", async () => {
    collector = await startStubCollector();
    let pokes = 0;
    const missing = await collector.waitFor(["absent-scope"], {
      timeoutMs: 300,
      intervalMs: 50,
      poke: async () => {
        pokes++;
      },
    });
    expect(missing).toEqual(["absent-scope"]);
    expect(pokes).toBeGreaterThan(1);
  });

  it("answers an export that is not JSON, and counts it", async () => {
    collector = await startStubCollector();
    const res = await fetch(`${collector.endpoint}/v1/traces`, { method: "POST", body: "\u0000binary" });
    expect(res.status).toBe(200);
    expect(collector.exports).toBe(1);
    expect(collector.spansByScope().size).toBe(0);
  });
});

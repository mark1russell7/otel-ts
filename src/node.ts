/**
 * The Node.js entry, `@mark1russell7/otel-ts/node`: OpenTelemetry for a Node
 * service, with the order that an ES module service needs.
 *
 * Load the module that calls `startNodeTelemetry()` with `node --import`,
 * before the service: the instrumentations patch `http`, `express` and the
 * database drivers when those modules load. In an ES module service, the
 * require hook does not see a package that an ES module imports. The loader
 * hook of OpenTelemetry (`@opentelemetry/instrumentation/hook.mjs`) patches
 * those imports. `startNodeTelemetry()` registers it before the SDK starts.
 *
 * The SDK, the exporters and the instrumentations come from the dependencies
 * of the service (the OpenTelemetry packages must have one version line), so
 * `@opentelemetry/sdk-node` is a peer dependency of this entry.
 *
 * @packageDocumentation
 */
import { register } from "node:module";
import { NodeSDK, type NodeSDKConfiguration } from "@opentelemetry/sdk-node";

export { outgoingTraceparent, createTraceEcho, runInRemoteTrace, type RemoteTraceOptions, type TraceEcho } from "./trace-echo.js";

/** The configuration of `startNodeTelemetry()` */
export interface NodeTelemetryOptions {
  /** The service name. Default: `OTEL_SERVICE_NAME`, else "node-service". */
  serviceName?: string;
  /**
   * The `import.meta.url` of the module that calls this function. The loader
   * hook resolves from it, so it is the instance of the service's
   * instrumentations. Without it, no loader hook is registered.
   */
  importMetaUrl?: string;
  /** The instrumentations, from the dependencies of the service */
  instrumentations?: NodeSDKConfiguration["instrumentations"];
  /** The trace exporter. Default: the exporter that the SDK makes from the `OTEL_*` variables. */
  traceExporter?: NodeSDKConfiguration["traceExporter"];
  /** The metric readers. Default: none. */
  metricReaders?: NodeSDKConfiguration["metricReaders"];
  /** On or off. Default: on when `OTEL_EXPORTER_OTLP_ENDPOINT` has a value. */
  enabled?: boolean;
  /**
   * Stop the SDK (and flush) at SIGTERM and SIGINT. Default: true. When the
   * service has no listener of its own for the signal, the process then ends
   * with the signal, as it does without this option.
   */
  stopOnSignals?: boolean;
  /**
   * The environment that sets `enabled` and the service name. Default:
   * `process.env`. The SDK reads its exporter settings (`OTEL_EXPORTER_OTLP_*`)
   * from `process.env`, not from this object. To send the spans to an
   * endpoint of this object, give `traceExporter`.
   */
  env?: NodeJS.ProcessEnv;
}

/** The signals that stop the SDK when `stopOnSignals` is true */
const STOP_SIGNALS = ["SIGTERM", "SIGINT"] as const;

/** The result of `startNodeTelemetry()` */
export interface NodeTelemetry {
  /** True when the SDK started */
  readonly enabled: boolean;
  /** True when the loader hook was registered */
  readonly esmHook: boolean;
  /** Stop the SDK and flush the spans and metrics. It does nothing when the SDK did not start. */
  shutdown(): Promise<void>;
}

/** Start OpenTelemetry for a Node service: the loader hook first, then the SDK. */
export function startNodeTelemetry(options: NodeTelemetryOptions = {}): NodeTelemetry {
  const env = options.env ?? process.env;
  const enabled = options.enabled ?? !!env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  if (!enabled) return { enabled: false, esmHook: false, shutdown: async () => {} };

  let esmHook = false;
  if (options.importMetaUrl) {
    register("@opentelemetry/instrumentation/hook.mjs", options.importMetaUrl);
    esmHook = true;
  }
  const sdk = new NodeSDK({
    serviceName: options.serviceName ?? env["OTEL_SERVICE_NAME"] ?? "node-service",
    ...(options.traceExporter ? { traceExporter: options.traceExporter } : {}),
    ...(options.metricReaders ? { metricReaders: options.metricReaders } : {}),
    ...(options.instrumentations ? { instrumentations: options.instrumentations } : {}),
  });
  sdk.start();

  // One stop: a second call waits for the flush of the first
  let stopping: Promise<void> | undefined;
  const shutdown = (): Promise<void> =>
    (stopping ??= sdk.shutdown().catch(() => {
      // a flush that fails at the stop loses its spans, and nothing else
    }));
  if (options.stopOnSignals ?? true) {
    for (const signal of STOP_SIGNALS) {
      // First in the list, so it sees each listener of the service before that listener runs
      process.prependOnceListener(signal, () => {
        // A listener for a signal removes the default action of Node.js, which ends the
        // process. This listener is gone now. When the service has no listener of its own,
        // raise the signal again after the flush: the default action then ends the process.
        // Before, a service without a listener continued to run after SIGTERM or SIGINT.
        const serviceListens = process.listenerCount(signal) > 0;
        void shutdown().finally(() => {
          if (!serviceListens) process.kill(process.pid, signal);
        });
      });
    }
  }
  return { enabled: true, esmHook, shutdown };
}

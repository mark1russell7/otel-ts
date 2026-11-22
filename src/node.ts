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
 * It registers the one context (docs/CONTEXT-DESIGN.md) also with export
 * off: AsyncLocalStorage, the propagator of otel-ts (the trace context on each
 * call, the baggage on internal calls only), and the metric view that removes
 * the keys of high cardinality. With export on, the context processors add the
 * context keys to each span and each log record. Only one part of a program
 * registers it.
 *
 * This entry loads the SDK and each exporter also with export off. A service
 * that exports nothing imports the entry `/node/context`, which loads none of them.
 *
 * @packageDocumentation
 */
import { register } from "node:module";
import { context, logs, metrics, propagation, trace, type Attributes } from "@opentelemetry/api";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { NodeSDK, type NodeSDKConfiguration } from "@opentelemetry/sdk-node";
import type { LogRecordExporter } from "@opentelemetry/sdk-logs";
import { NoopSpanProcessor, type SpanExporter } from "@opentelemetry/sdk-trace";
import { ContextPropagator, claimContextRegistration } from "./context-propagator.js";
import { contextMetricViews } from "./context-processors.js";
import { histogramAggregation, nodeLogRecordProcessors, nodeSpanProcessors } from "./node-exporters.js";
import { nodeResourceDetectors, nodeServiceName, registerNodeContext } from "./node-registration.js";

export { exporterNames, histogramAggregation, otlpProtocol, type ExporterName, type OtlpProtocol, type OtlpSignal } from "./node-exporters.js";

export { outgoingTraceparent, createTraceEcho, runInRemoteTrace, type RemoteTraceOptions, type TraceEcho } from "./trace-echo.js";

/** The configuration of `startNodeTelemetry()` */
export interface NodeTelemetryOptions {
  /** The service name. Default: `OTEL_SERVICE_NAME`, else "node-service". */
  serviceName?: string;
  /**
   * The attributes of the resource of the service, for example `service.version` and `service.instance.id`
   * (the copy of the service). They win over the detected attributes and over `OTEL_RESOURCE_ATTRIBUTES`.
   * `service.name` comes from `serviceName`. Default: none, and the resource is the resource of the SDK.
   */
  resourceAttributes?: Attributes;
  /**
   * The `import.meta.url` of the module that calls this function. The loader
   * hook resolves from it, so it is the instance of the service's
   * instrumentations. Without it, no loader hook is registered.
   */
  importMetaUrl?: string;
  /** The instrumentations, from the dependencies of the service */
  instrumentations?: NodeSDKConfiguration["instrumentations"];
  /**
   * The trace exporter. Default: the exporters of `OTEL_TRACES_EXPORTER`
   * (`otlp`, `console` or `none`; default `otlp`), with the protocol of
   * `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` or `OTEL_EXPORTER_OTLP_PROTOCOL`
   * (`http/protobuf` or `http/json`; default `http/protobuf`).
   */
  traceExporter?: SpanExporter;
  /** The log record exporter. Default: the exporters of `OTEL_LOGS_EXPORTER`, with the same rules as the traces. */
  logExporter?: LogRecordExporter;
  /** The metric readers. Default: none. */
  metricReaders?: NodeSDKConfiguration["metricReaders"];
  /**
   * Export on or off. Default: on when `OTEL_EXPORTER_OTLP_ENDPOINT` has a
   * value. With export off, it starts no SDK: it registers the context as
   * `startNodeContext()` of the entry `/node/context` does. Each span gets a
   * trace id, so the ids go through the service and into its own log lines.
   */
  enabled?: boolean;
  /**
   * Stop the SDK (and flush) at SIGTERM and SIGINT. Default: true. When the
   * service has no listener of its own for the signal, the process then ends
   * with the signal, as it does without this option. A service with a staged
   * shutdown of its own (for example `@mark1russell7/service`) gives false and
   * calls `shutdown()` in its last stage. With true, the stop removes the
   * context at the signal, while the service still drains its requests: the
   * log lines of the drain lose their trace ids, and the spans of the drained
   * requests go.
   */
  stopOnSignals?: boolean;
  /**
   * The environment that sets `enabled`, the service name, the exporter
   * names and the protocols. Default: `process.env`. An OTLP exporter and the
   * sampler of the SDK read their settings (endpoint, headers,
   * `OTEL_TRACES_SAMPLER`) from `process.env`, not from this object. To send
   * to an endpoint of this object, give `traceExporter` and `logExporter`.
   */
  env?: NodeJS.ProcessEnv;
}

/** The signals that stop the SDK when `stopOnSignals` is true */
const STOP_SIGNALS = ["SIGTERM", "SIGINT"] as const;

/** The signal listeners of otel-ts. They are not listeners of the service. */
const OWN_LISTENERS = new Set<Function>();

/** The result of `startNodeTelemetry()` */
export interface NodeTelemetry {
  /** True when export is on */
  readonly enabled: boolean;
  /** True when the loader hook was registered */
  readonly esmHook: boolean;
  /** Stop the SDK, flush the spans and metrics, and remove the registration of the context. A second call does nothing. */
  shutdown(): Promise<void>;
}

/**
 * Start OpenTelemetry for a Node service: the loader hook first, then the SDK.
 * A second call before the `shutdown()` of the first is an error.
 */
export function startNodeTelemetry(options: NodeTelemetryOptions = {}): NodeTelemetry {
  const env = options.env ?? process.env;
  const enabled = options.enabled ?? !!env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  let esmHook = false;
  // In the claim: a hook that does not resolve gives back the claim
  const registerHook = (): void => {
    if (options.importMetaUrl) {
      register("@opentelemetry/instrumentation/hook.mjs", options.importMetaUrl);
      esmHook = true;
    }
  };
  // With export off: the registration of the entry /node/context, and no SDK. Thus the two paths register the
  // same context, and nothing leaves the process. The instrumentations get the global tracer provider, as in the SDK.
  const stop = enabled
    ? startSdk(options, env, registerHook)
    : registerNodeContext("startNodeTelemetry()", { serviceName: options.serviceName, resourceAttributes: options.resourceAttributes, env }, () => {
        registerHook();
        if (options.instrumentations) registerInstrumentations({ instrumentations: options.instrumentations });
      }).stop;

  // The signal listeners of this start, removed at the stop
  const listeners: Array<[NodeJS.Signals, () => void]> = [];
  // One stop: a second call waits for the flush of the first
  let stopping: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (stopping) return stopping;
    // Before, the listeners stayed after the stop. At a signal after a new start, the
    // listener of the new start counted the old one as a listener of the service, and the
    // old one ended the process before the new SDK flushed.
    for (const [signal, listener] of listeners) {
      process.removeListener(signal, listener);
      OWN_LISTENERS.delete(listener);
    }
    return (stopping = stop());
  };
  if (options.stopOnSignals ?? true) {
    for (const signal of STOP_SIGNALS) {
      const listener = (): void => {
        // A listener for a signal removes the default action of Node.js, which ends the
        // process. This listener is gone now. When the service has no listener of its own,
        // raise the signal again after the flush: the default action then ends the process.
        // Before, a service without a listener continued to run after SIGTERM or SIGINT.
        const serviceListens = process.listeners(signal).some((other) => !OWN_LISTENERS.has(other));
        void shutdown().finally(() => {
          if (!serviceListens) process.kill(process.pid, signal);
        });
      };
      listeners.push([signal, listener]);
      OWN_LISTENERS.add(listener);
      // First in the list, so it sees each listener of the service before that listener runs
      process.prependOnceListener(signal, listener);
    }
  }
  return { enabled, esmHook, shutdown };
}

/** Start the SDK with export on, and give the function that stops it and removes the registration */
function startSdk(options: NodeTelemetryOptions, env: NodeJS.ProcessEnv, registerHook: () => void): () => Promise<void> {
  const release = claimContextRegistration("startNodeTelemetry()");
  let sdk: NodeSDK;
  try {
    registerHook();
    // The SDK registers its tracer provider only for a list of span processors that is not empty. Without the
    // provider, each span is the span of the API with the trace id zero. A processor that does nothing keeps the
    // provider, so each span gets a trace id, also with the traces exporter "none".
    const exporting = nodeSpanProcessors(env, options.traceExporter);
    sdk = new NodeSDK({
      serviceName: nodeServiceName(options.serviceName, env),
      textMapPropagator: new ContextPropagator(),
      // The aggregation of OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION:
      // the views replace the preference of each reader
      views: contextMetricViews(histogramAggregation(env)),
      spanProcessors: exporting.length > 0 ? exporting : [new NoopSpanProcessor()],
      logRecordProcessors: nodeLogRecordProcessors(env, options.logExporter),
      ...(options.metricReaders ? { metricReaders: options.metricReaders } : {}),
      ...(options.resourceAttributes ? { resourceDetectors: nodeResourceDetectors(env, options.resourceAttributes) } : {}),
      ...(options.instrumentations ? { instrumentations: options.instrumentations } : {}),
    });
    sdk.start();
  } catch (error) {
    release();
    throw error;
  }
  return () =>
    sdk
      .shutdown()
      .catch(() => {
        // a flush that fails at the stop loses its spans, and nothing else
      })
      .finally(() => {
        // The SDK leaves its globals at the stop. Remove them, so a next start registers its own.
        for (const api of [trace, metrics, logs, propagation, context]) api.disable();
        release();
      });
}

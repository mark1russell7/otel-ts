/**
 * The entry `@mark1russell7/otel-ts/node/context`: the context of a Node service that exports nothing, with no
 * SDK of `@opentelemetry/sdk-node`.
 *
 * It registers the one context (docs/CONTEXT-DESIGN.md) as the entry `/node` does with export off:
 * AsyncLocalStorage, the propagator of otel-ts (the trace context on each call, the baggage on internal calls
 * only), and a tracer provider with the resource of the service. Each span gets a trace id, so the ids go
 * through the service and into its own log lines. With the option `meterProvider`, it also registers the meter
 * provider of the service.
 *
 * The entry `/node` loads `@opentelemetry/sdk-node` and each exporter also with export off. This entry loads
 * none of them, and no instrumentation. Thus a small service pays only for the context. A service that exports
 * imports `/node`.
 *
 * Only one part of a program registers the context: `startNodeContext()` and `startNodeTelemetry()` refuse each
 * other until the `shutdown()` of the first.
 *
 * @packageDocumentation
 */
import type { Attributes } from "@opentelemetry/api";
import type { SpanProcessor } from "@opentelemetry/sdk-trace";
import type { NodeMeterProviderFactory } from "./node-meter.js";
import { registerNodeContext } from "./node-registration.js";

export type { NodeMeterProvider, NodeMeterProviderFactory } from "./node-meter.js";

/** The configuration of `startNodeContext()` */
export interface NodeContextOptions {
  /** The service name. Default: `OTEL_SERVICE_NAME`, else "node-service". */
  serviceName?: string;
  /**
   * The attributes of the resource of the service, for example `service.version` and `service.instance.id`
   * (the copy of the service). They win over the detected attributes and over `OTEL_RESOURCE_ATTRIBUTES`.
   */
  resourceAttributes?: Attributes;
  /**
   * The span processors. Default: none, and no span leaves the process. A test gives a processor with the
   * exporter of its capture.
   */
  spanProcessors?: readonly SpanProcessor[];
  /**
   * The meter provider of the service, from the resource of the service. Default: none, and the meters of the API
   * record nothing. `exportMeterProvider()` of the entry `/node/export` gives one that exports the metrics.
   */
  meterProvider?: NodeMeterProviderFactory;
  /** The environment of the service name and of `OTEL_NODE_RESOURCE_DETECTORS`. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** The result of `startNodeContext()` */
export interface NodeContext {
  /**
   * Flush the span processors and the meter provider, stop the two providers, and remove the registration of the
   * context. A second call does nothing. A service of `@mark1russell7/service` calls it in its last stage, `flush the output`.
   */
  shutdown(): Promise<void>;
}

/**
 * Register the context of a Node service that exports nothing. A second call before the `shutdown()` of the
 * first is an error. It adds no listener for a signal: the service calls `shutdown()` at its stop.
 */
export function startNodeContext(options: NodeContextOptions = {}): NodeContext {
  const registration = registerNodeContext("startNodeContext()", options);
  return { shutdown: () => registration.stop() };
}

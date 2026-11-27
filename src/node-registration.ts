/**
 * The registration of the context of a Node service with no SDK of `@opentelemetry/sdk-node`
 * (docs/CONTEXT-DESIGN.md, section 4). The entry `/node/context` and the export off of the entry `/node`
 * use it. Thus the two paths register the same context.
 *
 * This module imports no exporter, no instrumentation and no SDK of `@opentelemetry/sdk-node`.
 * The entries test holds this rule.
 */
import { context, metrics, propagation, trace, type Attributes } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  defaultResource,
  detectResources,
  envDetector,
  hostDetector,
  osDetector,
  processDetector,
  resourceFromAttributes,
  serviceInstanceIdDetector,
  type ResourceDetector,
} from "@opentelemetry/resources";
import { TracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { ContextPropagator, claimContextRegistration } from "./context-propagator.js";
import type { NodeMeterProvider, NodeMeterProviderFactory } from "./node-meter.js";

type Env = Readonly<Record<string, string | undefined>>;

/** The resource detectors of `OTEL_NODE_RESOURCE_DETECTORS`, with the names and the sequence of the NodeSDK. `env` is last. */
const RESOURCE_DETECTORS: ReadonlyMap<string, ResourceDetector> = new Map([
  ["host", hostDetector],
  ["os", osDetector],
  ["serviceinstance", serviceInstanceIdDetector],
  ["process", processDetector],
  ["env", envDetector],
]);

/**
 * The resource detectors that the NodeSDK uses: the names of `OTEL_NODE_RESOURCE_DETECTORS` (`host`, `os`,
 * `serviceinstance`, `process`, `env`, `all` or `none`; default `all`), then a detector that gives
 * `attributes`. That last detector wins over each other detector, also over `OTEL_RESOURCE_ATTRIBUTES` (the
 * detector `env`), as the option `resourceAttributes` of `startNodeSDK()` of the SDK does. Without it, a
 * `service.instance.id` of the service lost to the random id of the detector `serviceinstance`. The NodeSDK
 * ignores a name that it does not know, with a warning. This function ignores it too.
 */
export function nodeResourceDetectors(env: Env, attributes: Attributes): ResourceDetector[] {
  const names = (env["OTEL_NODE_RESOURCE_DETECTORS"] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const chosen = names.length === 0 || names.includes("all") ? [...RESOURCE_DETECTORS.values()] : names.includes("none") ? [] : names.flatMap((name) => RESOURCE_DETECTORS.get(name) ?? []);
  return [...chosen, { detect: () => ({ attributes: { ...attributes } }) }];
}

/** The service name of a start: the option, else `OTEL_SERVICE_NAME`, else "node-service" */
export function nodeServiceName(serviceName: string | undefined, env: Env): string {
  return serviceName ?? env["OTEL_SERVICE_NAME"] ?? "node-service";
}

/** The configuration of the registration of the context */
export interface NodeContextRegistrationOptions {
  readonly serviceName?: string | undefined;
  readonly resourceAttributes?: Attributes | undefined;
  readonly spanProcessors?: readonly SpanProcessor[] | undefined;
  readonly meterProvider?: NodeMeterProviderFactory | undefined;
  readonly env?: Env | undefined;
}

/** A registration of the context */
export interface NodeContextRegistration {
  /**
   * Flush and stop the tracer provider and the meter provider, and remove the registration. A second call gives
   * the same promise.
   */
  stop(): Promise<void>;
}

/**
 * Register the context for `caller`: the claim, AsyncLocalStorage as the context manager, the propagator of
 * otel-ts, and a tracer provider with the resource of the service. A tracer provider of the SDK gives each span
 * a trace id, also with no span processor. With `meterProvider`, the meter provider that it makes is the global
 * meter provider.
 *
 * `prepare` runs after the claim and before the context. When it throws, the claim goes back.
 */
export function registerNodeContext(caller: string, options: NodeContextRegistrationOptions, prepare?: () => void): NodeContextRegistration {
  const release = claimContextRegistration(caller);
  let tracerProvider: TracerProvider;
  let meterProvider: NodeMeterProvider | undefined;
  try {
    prepare?.();
    const env = options.env ?? process.env;
    // The sequence of the NodeSDK: the default resource, then the detectors, then the service name
    const resource = defaultResource()
      .merge(detectResources({ detectors: nodeResourceDetectors(env, options.resourceAttributes ?? {}) }))
      .merge(resourceFromAttributes({ [ATTR_SERVICE_NAME]: nodeServiceName(options.serviceName, env) }));
    tracerProvider = new TracerProvider({ resource, spanProcessors: [...(options.spanProcessors ?? [])] });
    meterProvider = options.meterProvider?.(resource);
  } catch (error) {
    release();
    throw error;
  }
  // OpenTelemetry JS 3.x has no register() on the provider: set the three globals here. A set does not throw.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new ContextPropagator());
  trace.setGlobalTracerProvider(tracerProvider);
  // A part of the program that set the global meter provider first keeps it. The stop then removes only the globals of this call.
  const meterSet = meterProvider !== undefined && metrics.setGlobalMeterProvider(meterProvider);

  let stopping: Promise<void> | undefined;
  return {
    stop: () =>
      (stopping ??= Promise.all([stopProvider(tracerProvider), stopProvider(meterProvider)])
        .then(() => undefined)
        .finally(() => {
          for (const api of [trace, propagation, context]) api.disable();
          if (meterSet) metrics.disable();
          release();
        })),
  };
}

/**
 * Flush, then stop, a provider. The shutdown of a tracer provider does not wait for an export that a
 * SimpleSpanProcessor started. That export first waits for the async attributes of the resource. Thus the stop
 * flushes first. A flush or a stop that fails loses its records, and nothing else.
 */
const stopProvider = (provider: { forceFlush(): Promise<void>; shutdown(): Promise<void> } | undefined): Promise<void> =>
  provider === undefined
    ? Promise.resolve()
    : provider
        .forceFlush()
        .then(() => provider.shutdown())
        .catch(() => undefined);

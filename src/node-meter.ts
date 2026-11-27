/**
 * The types of the meter provider of a Node service, for the option `meterProvider` of `startNodeContext()`. The
 * entries `/node/context` and `/node/export` use them. This module has types only, so an entry that imports it
 * loads no package.
 */
import type { MeterProvider } from "@opentelemetry/api";
import type { Resource } from "@opentelemetry/resources";

/** A meter provider that the context flushes and stops. The `MeterProvider` of `@opentelemetry/sdk-metrics` is one. */
export interface NodeMeterProvider extends MeterProvider {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * This function makes the meter provider of a service from the resource of the service. Thus the metrics have the
 * resource of the spans. `exportMeterProvider()` of the entry `/node/export` gives one.
 */
export type NodeMeterProviderFactory = (resource: Resource) => NodeMeterProvider;

/**
 * The OpenTelemetry dependencies of the monitors of `@mark1russell7/lag`, from one instance of
 * otel-ts (decision D7, roadmap C15). Without this entry, each app connects the meter, the logger,
 * the events, the spans and the flush by hand.
 *
 * The adapters are the adapters of lag. This entry only gives them the providers of the instance.
 * `@mark1russell7/lag` is an optional peer dependency: only an app that imports this entry needs it.
 *
 * @example
 * ```ts
 * import { init } from "@mark1russell7/otel-ts";
 * import { lagDeps } from "@mark1russell7/otel-ts/lag";
 * import { createBrowserDeps, setupAllMonitors } from "@mark1russell7/lag";
 *
 * const otel = init({ serviceName: "checkout-web" });
 * const lag = lagDeps(otel);
 * const monitors = setupAllMonitors(createBrowserDeps(window, lag));
 * lag.connect(monitors);
 * ```
 *
 * @packageDocumentation
 */
import { ROOT_CONTEXT, trace, type Tracer } from "@opentelemetry/api";
import {
  createOtelEventSink,
  createOtelLoggerAdapter,
  createOtelSpanSink,
  type EventSink,
  type Logger,
  type Meter,
  type SpanSink,
} from "@mark1russell7/lag";
import type { OtelTsInstance } from "./types.js";

/** The options of `lagDeps` */
export interface LagDepsOptions {
  /** The name of the meter, the logger and the tracer. Default: `lag`. */
  name?: string;
  /** The tracer of the spans of the monitors. Default: the global tracer of `name`. */
  tracer?: Tracer;
}

/** The monitors of lag, as `connect` needs them: the result of `setupAllMonitors()` fits. */
export interface LagFlushTarget {
  flush(): void;
}

/** The OpenTelemetry dependencies of the monitors of lag. Give them to `createBrowserDeps()` of lag. */
export interface LagDeps {
  /** The meter of the instance, with the name of the options */
  readonly meter: Meter;
  /** The diagnostics of lag, as log records of the instance */
  readonly logger: Logger;
  /** The events of the monitors, as log records with `eventName` */
  readonly events: EventSink;
  /** The spans of the monitors, through the tracer of the options */
  readonly spans: SpanSink;
  /**
   * Record the values that the monitors keep until a checkpoint before each flush of the instance.
   * Thus the final export of a page has the final values of the page view.
   *
   * @returns A function that removes the connection
   */
  connect(monitors: LagFlushTarget): () => void;
}

/**
 * The meter, the logger, the event sink and the span sink of the monitors of lag, from one instance
 * of otel-ts. `connect()` records the values of the monitors before each flush of the instance.
 */
export function lagDeps(
  instance: Pick<OtelTsInstance, "getMeter" | "getLogger" | "onBeforeFlush">,
  options: LagDepsOptions = {},
): LagDeps {
  const name = options.name ?? "lag";
  const logger = instance.getLogger(name);
  return {
    meter: instance.getMeter(name),
    logger: createOtelLoggerAdapter(logger),
    events: createOtelEventSink(logger),
    spans: createOtelSpanSink(options.tracer ?? trace.getTracer(name), { trace, ROOT_CONTEXT }),
    connect: (monitors) => instance.onBeforeFlush(() => monitors.flush()),
  };
}

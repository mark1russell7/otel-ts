/**
 * The lab: one real `init()` of the package, and the activity that a visitor starts from the page. No function here makes
 * a span, a metric or a log record by hand for the display. Each record that the page shows left the package through its
 * exporters, and `wire.ts` caught it. Faro starts too, with a collector on the same stub. Two actions give Faro an item
 * in a span, and Faro sends it with the IDs of that span.
 */
import { init, runInRemoteTrace } from "@mark1russell7/otel-ts";
import type { OtelTsConfig, OtelTsInstance } from "@mark1russell7/otel-ts";
import { context, propagation, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { faro } from "@grafana/faro-web-sdk";
import { COLLECTOR, FARO_COLLECTOR, OTHER_ORIGIN } from "./wire.ts";

/** The options that the page can change. Each change needs a new `init()`, so the page reloads. */
export interface LabOptions {
  readonly contextManager: "async" | "stack";
  readonly histogramAggregation: "explicit" | "exponential";
  readonly metricsTemporality: "cumulative" | "delta";
}

/** The values of each option. The first value of each list is the default of the package. */
export const OPTION_VALUES = {
  contextManager: ["async", "stack"],
  histogramAggregation: ["explicit", "exponential"],
  metricsTemporality: ["cumulative", "delta"],
} as const;

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback;
}

/** This function reads the options from a query string. It ignores a value that is not in `OPTION_VALUES`. */
export function readOptions(search: string): LabOptions {
  const query = new URLSearchParams(search);
  return {
    contextManager: pick(query.get("contextManager"), OPTION_VALUES.contextManager, "async"),
    histogramAggregation: pick(query.get("histogramAggregation"), OPTION_VALUES.histogramAggregation, "explicit"),
    metricsTemporality: pick(query.get("metricsTemporality"), OPTION_VALUES.metricsTemporality, "cumulative"),
  };
}

/** The interval of the metrics export. The default of the package is 15 seconds. */
const METRICS_INTERVAL_MS = 10_000;

/** This function gives the configuration of the `init()` of the page. */
export function labConfig(options: LabOptions, serviceVersion: string): OtelTsConfig {
  return {
    serviceName: "otel-ts-demo",
    serviceVersion,
    endpoint: COLLECTOR,
    faroCollectorUrl: FARO_COLLECTOR,
    metricsExportIntervalMs: METRICS_INTERVAL_MS,
    contextManager: options.contextManager,
    histogramAggregation: options.histogramAggregation,
    metricsTemporality: options.metricsTemporality,
  };
}

/** This function gives the `init()` call of a configuration, as source text. */
export function configText(config: OtelTsConfig): string {
  const lines = Object.entries(config).map(([key, value]) => `  ${key}: ${typeof value === "number" ? String(value) : JSON.stringify(value)},`);
  return `import { init } from "@mark1russell7/otel-ts";\n\nconst otel = init({\n${lines.join("\n")}\n});`;
}

/** The names of the actions of the page. */
export type ActionName = "fetch" | "other-origin" | "slow" | "failed-job" | "checkout" | "log";

/** The result of an action, as one sentence for the page. */
export type ActionResult = string;

/** The objects of a started lab. */
export interface Lab {
  readonly otel: OtelTsInstance;
  /** The time that `init()` took, in milliseconds. */
  readonly initMs: number;
  /** This function starts an action in the active span, and gives its result. */
  run(name: ActionName): Promise<ActionResult>;
}

/** The time of the busy loop of the slow task. A long task takes more than 50 ms. */
const SLOW_MS = 120;

/** This function gives the `traceparent` of the active span, as an instrumentation writes it into a request. */
function activeTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier["traceparent"];
}

/**
 * This function starts `init()` with the configuration, and gives the lab. The page calls it once. `fetch` must already
 * be the function of `wire.ts`.
 *
 * Each action uses timers and `then`, and no `await`. The `async` context manager keeps the span across timers and
 * `then` callbacks. It keeps the span after a native `await` only with its build transform, and this site has none.
 */
export function startLab(config: OtelTsConfig, orderUrl: string): Lab {
  const before = performance.now();
  const otel = init(config);
  const initMs = performance.now() - before;

  const tracer = trace.getTracer("otel-ts-demo");
  const logger = otel.getLogger("otel-ts-demo");
  const meter = otel.getMeter("otel-ts-demo");
  const actions = meter.createCounter("demo.actions", { description: "The actions that a visitor started" });
  const durations = meter.createHistogram("demo.action.duration", { unit: "ms", description: "The time of an action" });

  const getOrder = (): Promise<number> => fetch(orderUrl).then((response) => response.json().then(() => response.status));

  const handlers: Readonly<Record<ActionName, () => Promise<ActionResult>>> = {
    fetch: () => getOrder().then((status) => `The GET of demo/order.json gave ${status}. The request carried a traceparent header.`),

    "other-origin": () =>
      fetch(`${OTHER_ORIGIN}/orders`).then((response) => `The stand-in API answered ${response.status} in this page. The request had no traceparent, because its origin is not in the list.`),

    slow: () => {
      const end = performance.now() + SLOW_MS;
      while (performance.now() < end);
      return Promise.resolve(`The main thread stayed busy for ${SLOW_MS} ms. The browser reports a long task.`);
    },

    "failed-job": () => {
      const job = runInRemoteTrace(
        activeTraceparent(),
        () => new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error("The payment job failed on purpose")), 40)),
        { name: "payment job", attributes: { "demo.job": "payment" } },
      );
      return job.then(
        () => "The job ended with no error.",
        (error: unknown) => {
          const failure = error instanceof Error ? error : new Error(String(error));
          logger.emit({
            severityNumber: SeverityNumber.ERROR,
            severityText: "ERROR",
            body: failure.message,
            attributes: { "demo.job": "payment" },
          });
          // Faro reads the active span from otel-ts, so the error has the trace of the click
          faro.api.pushError(failure);
          return "The job failed. The page caught the error, the span has the status ERROR, and Faro got the error with the trace of the click.";
        },
      );
    },

    checkout: () =>
      new Promise<ActionResult>((resolve) => {
        tracer.startActiveSpan("checkout", { attributes: { "demo.cart.items": 3 } }, (root) => {
          setTimeout(() => {
            const pricing = tracer.startSpan("price the cart");
            setTimeout(() => {
              pricing.end();
              getOrder().then(() => {
                tracer.startActiveSpan("save the order", (save) => {
                  logger.emit({ severityNumber: SeverityNumber.INFO, severityText: "INFO", body: "The order is saved", attributes: { "demo.order": "A-1042" } });
                  faro.api.pushEvent("order saved", { order: "A-1042" });
                  save.end();
                });
                root.end();
                resolve("The checkout ended. It went through two timers, one fetch and one then callback.");
              });
            }, 40);
          }, 30);
        });
      }),

    log: () => {
      logger.emit({ severityNumber: SeverityNumber.INFO, severityText: "INFO", body: "A visitor pressed the log button", attributes: { "demo.source": "button" } });
      return Promise.resolve("The log record went into the batch with the IDs of the click span.");
    },
  };

  return {
    otel,
    initMs,
    run(name) {
      const started = performance.now();
      actions.add(1, { action: name });
      return handlers[name]().then((result) => {
        durations.record(performance.now() - started, { action: name });
        return result;
      });
    },
  };
}

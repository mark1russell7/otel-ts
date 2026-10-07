# otel-ts

OpenTelemetry and Grafana Faro for TypeScript web apps, with one `init()` call.

## Install

Install the package from GitHub:

```bash
pnpm add github:mark1russell7/otel-ts
```

The repository contains the compiled `dist/` folder. You do not need a build step.

## Quick start

```ts
import { init } from "@mark1russell7/otel-ts";

const otel = init({
  serviceName: "checkout-web",
  serviceVersion: "1.4.0",
  endpoint: "https://otel.example.com",
});

const meter = otel.getMeter("checkout");
meter.createHistogram("checkout.duration", { unit: "ms" }).record(120);
```

`init()` starts traces, metrics and logs. It sends them to `endpoint` with OTLP over HTTP. The paths are `/v1/traces`, `/v1/metrics` and `/v1/logs`.

`init()` also does these steps:

- It makes one resource for traces, metrics and logs.
- It sets a new `service.instance.id` for each `init()` call.
- It adds the `session.id` attribute to each log record and to each span.
- It exports metrics every 15 seconds.
- It flushes all telemetry each time the page becomes hidden.
- It stops all providers when the browser discards the page.
- It starts Grafana Faro only when you set `faroCollectorUrl`.

`init()` also runs in Web Workers. There, it does not start the parts that need a DOM.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | `string` | `"http://localhost:4318"` | The OTLP HTTP endpoint. |
| `serviceName` | `string` | `"frontend-app"` | The `service.name` resource attribute. |
| `serviceVersion` | `string` | `"0.0.0"` | The `service.version` resource attribute. |
| `serviceInstanceId` | `string` | A new random UUID v4 for each `init()` call | The `service.instance.id` resource attribute. Refer to [Writer identity](#writer-identity). |
| `resourceAttributes` | `Record<string, string>` | `{}` | More resource attributes. They replace the attributes above when the key is the same. |
| `tracing` | `boolean` | `true` | Starts the trace provider. |
| `propagateTraceHeaderCorsUrls` | `Array<string \| RegExp>` | All origins | The origins that get trace context headers. |
| `metrics` | `boolean` | `true` | Starts the meter provider. |
| `metricsExportIntervalMs` | `number` | `15000` | The time between two metric exports, in milliseconds. Refer to [Metric export](#metric-export). |
| `metricsTemporality` | `"cumulative" \| "delta"` | `"cumulative"` | The aggregation temporality that the OTLP metric exporter requests. |
| `histogramAggregation` | `"explicit" \| "exponential"` | `"explicit"` | The aggregation for histogram instruments. Refer to [Histograms](#histograms). |
| `logs` | `boolean` | `true` | Starts the logger provider. |
| `instrumentDocumentLoad` | `boolean` | `true` | Records document-load spans. This instrumentation needs a DOM. |
| `instrumentFetch` | `boolean` | `true` | Records a span for each `fetch()` request. |
| `instrumentXhr` | `boolean` | `true` | Records a span for each `XMLHttpRequest` request. |
| `instrumentUserInteraction` | `boolean` | `true` | Records user-interaction spans. This instrumentation needs a DOM. |
| `instrumentLongTask` | `boolean` | `true` | Records long-task spans. |
| `faro` | `boolean` | `true` | Starts Grafana Faro. Faro also needs `faroCollectorUrl` and a DOM. Refer to [Grafana Faro](#grafana-faro). |
| `faroCollectorUrl` | `string` | Not set | The Faro collector URL. Without this URL, Faro does not start. |
| `faroAppName` | `string` | The `serviceName` value | The Faro app name. |
| `sessionTracking` | `boolean` | `true` | Keeps the session ID in `sessionStorage`. Refer to [Sessions](#sessions). |
| `debug` | `boolean` | `false` | Writes the configuration to the console when `init()` runs. |

## The returned object

| Member | Description |
| --- | --- |
| `forceFlush(): Promise<void>` | Exports all pending telemetry now. The providers continue to run. |
| `shutdown(): Promise<void>` | Exports all pending telemetry and stops all providers. A second call returns the same promise. |
| `onBeforeFlush(listener: () => void): () => void` | Adds a function that runs before each flush. Refer to [Record values before a flush](#record-values-before-a-flush). |
| `getSessionId(): string` | Returns the current session ID. |
| `getMeter(name: string): Meter` | Returns a `Meter` for counters, histograms and gauges. |
| `getLogger(name: string): Logger` | Returns a `Logger` for log records. |

## Writer identity

Prometheus and Mimir make the `instance` label from the `service.instance.id` resource attribute. Each SDK instance writes its own metric series. Two SDK instances with the same identity write to the same series. Then Mimir rejects samples, and `rate()` gives incorrect values.

For this reason, `init()` sets a new random UUID v4 for each call. The metrics, logs and traces resources get the same value. The library does not store the value. It does not make the value from the session ID. Each page load and each Web Worker gets a different value.

To set your own value, use the `serviceInstanceId` option. Give each `init()` call a different value. The library replaces an empty string with a random value.

To know the value before `init()` runs, call `createInstanceId()`:

```ts
import { createInstanceId, init } from "@mark1russell7/otel-ts";

const serviceInstanceId = createInstanceId();
const otel = init({ serviceInstanceId });
```

`createInstanceId()` returns a random UUID v4. It uses `crypto.randomUUID()` when that function exists. Browsers supply `crypto.randomUUID()` only in secure contexts: HTTPS pages and `http://localhost`. On other `http://` pages, `createInstanceId()` uses `crypto.getRandomValues()`. Without Web Crypto, it uses `Math.random()`. The session IDs use the same method.

## Sessions

The library adds the `session.id` attribute to each log record and to each span. It reads the current session ID when the log record or the span starts. Thus, the next record shows a new session immediately.

The resources do not get `session.id`. A resource does not change, so it keeps an old session ID after the session changes. On the metrics resource, `session.id` also adds one `target_info` series for each session.

The library keeps the session ID and the time of the last activity in `sessionStorage`. A session ends after 30 minutes without activity. Activity is a log record, a span, a `getSessionId()` call or an `init()` call. The next activity then starts a new session with a new ID.

Some contexts have no usable `sessionStorage`. Examples are Web Workers, sandboxed iframes and a full storage quota. In these contexts, the library keeps the session in memory, with the same 30-minute limit.

If you set `session.id` on a log record or a span, the library keeps your value. Use this for a `session.end` event of the previous session.

When `sessionTracking` is `false`, each `init()` call gets one new random session ID. The library does not store this ID, and the ID does not change.

In Loki, find the attribute as the `session_id` structured metadata. In TraceQL, use `span.session.id` instead of `resource.session.id`.

## Histograms

By default, histogram instruments use explicit-bucket histograms. All OTLP backends can store them. The bucket boundaries come from the `advice` of the instrument, or from the SDK defaults.

To use base-2 exponential histograms, set `histogramAggregation` to `"exponential"`:

```ts
const otel = init({ histogramAggregation: "exponential" });
```

This setting applies to all histogram instruments. The library then ignores `advice.explicitBucketBoundaries`. Counters and gauges do not change. The library sets the aggregation through the `aggregationPreference` option of the OTLP metric exporter.

Mimir stores each exponential histogram as one native-histogram series. An explicit-bucket histogram uses one series for each bucket, and one series each for `_sum` and `_count`.

Mimir must accept native histograms. Make sure that the limits of the tenant set `native_histograms_ingestion_enabled` to `true`:

```yaml
limits:
  native_histograms_ingestion_enabled: true
```

Without this setting, you lose the histogram data. If your backend cannot store native histograms, keep the default `"explicit"`.

To query a native histogram, use the series name without the `_bucket` suffix:

```promql
histogram_quantile(0.95, sum(rate(checkout_duration[5m])))
```

The Mimir OTLP settings can add a unit suffix to the series name.

## Metric export

The library exports metrics every 15 seconds. To change the interval, set `metricsExportIntervalMs`. The default was `60000` before this version.

The library also flushes all telemetry each time the page becomes hidden. Thus, you do not lose the data of the last interval of a page.

A shorter interval sends more samples. Each series then costs more in Mimir and in Grafana Cloud. Use an interval of 15 to 30 seconds.

By default, the exporter requests cumulative temporality. In its default configuration, Mimir rejects delta sums and delta histograms. Keep `metricsTemporality` at `"cumulative"` for Mimir and Prometheus.

## Page lifecycle

The library listens to two page events:

- `visibilitychange` to `hidden`: The library flushes all telemetry. This event occurs at each tab switch. The providers continue to run.
- `pagehide` with `persisted` set to `true`: The page goes into the back/forward cache. The library flushes all telemetry.
- `pagehide` with `persisted` set to `false`: The browser discards the page. The library stops all providers.

The library does not listen to `beforeunload` or `unload`. These events can prevent the back/forward cache.

### Record values before a flush

Some monitors record their values at `pagehide`. An example is the final Web Vitals of a page. The order of `pagehide` listeners is not the same in all browsers. Chromium calls `window` listeners in registration order. Firefox and WebKit call capture listeners first. Thus, the library can stop before your listener records its values. Then you lose these values.

To prevent this problem, record the values in an `onBeforeFlush()` listener:

```ts
import { init } from "@mark1russell7/otel-ts";
import { createBrowserDeps, setupAllMonitors } from "@lag/core";

const otel = init({ serviceName: "checkout-web" });
const monitors = setupAllMonitors(createBrowserDeps(window, { /* options */ }));
otel.onBeforeFlush(() => monitors.flush());
```

The library calls each listener synchronously before each flush. These flushes include each page hide and the stop at `pagehide`. They also include each `forceFlush()` call and the first `shutdown()` call.

- The listeners run in registration order.
- An error in one listener does not stop the other listeners or the flush.
- The library writes only the first listener error to the console.
- The library does not wait for a promise that a listener returns.
- The listeners do not run after the providers stop.

`onBeforeFlush()` returns a function. Call this function to remove the listener.

## Grafana Faro

Faro starts only if `faro` is `true`, you set `faroCollectorUrl`, and a DOM exists. Without a collector URL, Faro has no destination for its data. Faro then also writes an error to the console. For this reason, the library does not start Faro without `faroCollectorUrl`.

To use Faro, set the collector URL:

```ts
const otel = init({ faroCollectorUrl: "https://faro.example.com/collect" });
```

## Web Workers

You can call `init()` in a Web Worker. The library does not use `window` or `document` there. It does not start Faro, document-load spans or user-interaction spans. It does not add page listeners. Call `forceFlush()` or `shutdown()` yourself before the worker stops.

## Development

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm test
```

Consumers install the package from GitHub. Thus, rebuild `dist/` after each change to `src/`. Then commit `dist/`.

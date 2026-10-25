# otel-ts

OpenTelemetry and Grafana Faro for TypeScript web apps, with one `init()` call.

## Install

Install the package from npm:

```bash
pnpm add @mark1russell7/otel-ts
```

The npm package contains the compiled `dist/` folder. You do not need a build step.

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
- It keeps the active span with async-browser-context. To use zone.js or no context library, import `init` from another entry. Refer to [Context manager](#context-manager).

`init()` also runs in Web Workers. There, it does not start the parts that need a DOM.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | `string` | `"http://localhost:4318"` | The OTLP HTTP endpoint. |
| `serviceName` | `string` | `"frontend-app"` | The `service.name` resource attribute. |
| `serviceVersion` | `string` | `"0.0.0"` | The `service.version` resource attribute. |
| `serviceInstanceId` | `string` | A new random UUID v4 for each `init()` call | The `service.instance.id` resource attribute. Refer to [Writer identity](#writer-identity). |
| `contextManager` | `"async" \| "stack" \| ContextManager` | `"async"` | The context manager of the tracer provider. The zone and core entries have other values. Refer to [Context manager](#context-manager). |
| `browserAttributes` | `boolean` | `true` | Puts `browser.brands`, `browser.platform`, `browser.mobile`, `browser.language` and `user_agent.original` (semantic conventions) on the resource, from `navigator`. The attributes of `resourceAttributes` replace them when the key is the same. |
| `resourceAttributes` | `Record<string, string>` | `{}` | More resource attributes. They replace the attributes above when the key is the same. |
| `tracing` | `boolean` | `true` | Starts the trace provider. |
| `propagateTraceHeaderCorsUrls` | `Array<string \| RegExp>` | `[]` (the origin of the page only) | The other origins that get trace context headers. Requests to the origin of the page always get them. Refer to [Trace headers to other origins](#trace-headers-to-other-origins). |
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

### Trace headers to other origins

The fetch and XHR instrumentations add the trace context headers (`traceparent`) to the requests to the origin of the page. A request to another origin gets them only when `propagateTraceHeaderCorsUrls` has a match for its URL. A custom header makes the browser send a CORS preflight, so each origin in the list must allow `traceparent` in `Access-Control-Allow-Headers`. Otherwise the browser refuses the request.

To join the spans of your API on another origin to the trace of the page, give that origin:

```ts
init({ propagateTraceHeaderCorsUrls: [/^https:\/\/api\.example\.com\//] });
```

Before 0.2.0, the default was `[/.*/]`: each cross-origin request got the headers, and third-party servers without `traceparent` in their CORS headers refused the requests.

## The returned object

| Member | Description |
| --- | --- |
| `forceFlush(): Promise<void>` | Exports all pending telemetry now. The providers continue to run. |
| `shutdown(): Promise<void>` | Exports all pending telemetry and stops all providers. A second call returns the same promise. |
| `onBeforeFlush(listener: (cause: FlushCause) => void): () => void` | Adds a function that runs before each flush. It gets the lifecycle transition that started the flush, if any. Refer to [Record values before a flush](#record-values-before-a-flush). |
| `getSessionId(): string` | Returns the current session ID. |
| `getMeter(name: string): Meter` | Returns a `Meter` for counters, histograms and gauges. |
| `getLogger(name: string): Logger` | Returns a `Logger` for log records. |

## Context manager

The context manager keeps the active span. A span that starts while a span is active gets the active span as its parent. Set the manager with the `contextManager` option.

zone.js and async-browser-context patch the same functions with different rules. Thus, they cannot share a page. The package has three entries, and each entry loads one context library or none:

| Entry | Context library | `contextManager` values | Default |
| --- | --- | --- | --- |
| `@mark1russell7/otel-ts` | [async-browser-context](https://github.com/mark1russell7/AsyncBrowserContext) | `"async"`, `"stack"`, a `ContextManager` | `"async"` |
| `@mark1russell7/otel-ts/zone` | zone.js | `"zone"`, `"stack"`, a `ContextManager` | `"zone"` |
| `@mark1russell7/otel-ts/core` | None | `"stack"`, a `ContextManager` | `"stack"` |

Each entry exports the same API. Only `init()` and the types `OtelTsConfig` and `ContextManagerOption` are different. Import from one entry in an app.

If you give a name that the entry does not have, `init()` throws an error before it starts. The error tells you which entry has the name. For example, `"zone"` in `@mark1russell7/otel-ts` gives this error:

```text
[otel-ts] contextManager: "zone" is not available in "@mark1russell7/otel-ts". This entry loads async-browser-context, and zone.js and async-browser-context cannot share a page: they patch the same functions with different rules. Import init from "@mark1russell7/otel-ts/zone" in place of "@mark1russell7/otel-ts".
```

| Manager | Where the active span stays |
| --- | --- |
| `"async"` | In synchronous code and in the callbacks of the patched APIs. With the transform, also after `await`. |
| `"zone"` | In synchronous code and in the callbacks of the patched APIs. Not after a native `await`. |
| `"stack"` | Only in synchronous code. A timer callback, a `then` callback and an event listener get no active span. |
| A `ContextManager` | As your manager operates. |

### The default: async-browser-context

`@mark1russell7/otel-ts` imports async-browser-context. When it loads, its runtime patches `Promise.prototype.then`, the timers, the event listeners, the observers and other callback APIs. Thus, a callback gets the active span of the code that registered it:

- A timer callback, for example of `setTimeout` or `requestAnimationFrame`.
- A `then`, `catch` or `finally` callback.
- An event listener. If the code that dispatches the event has no active span, the listener gets the span of the `addEventListener()` call. This is also true for a click of the user.

Import `@mark1russell7/otel-ts` before the other modules of the entry file. Code that keeps a reference to `setTimeout` or to another patched function before the runtime loads does not get the active span.

The runtime patches the page also when you set `"stack"` in this entry. For a page without patches, use `@mark1russell7/otel-ts/core`.

Profilers and the Long Animation Frames API of Chromium show the wrapper `asyncBrowserContextWrapper` of the runtime in place of the callback. With zone.js, they show the wrapper functions of zone.js.

On Node.js, the `node` export condition of async-browser-context selects the native `AsyncLocalStorage`. Nothing is patched, and the active span stays also after `await`. Server-side rendering and tests in Node.js get this entry. A bundler gives a Web Worker the browser runtime, which does not need a DOM.

### Keep the span after `await`

A native `await` does not use code that a library can patch. Thus, without a transform, the code after an `await` gets no active span. The Vite plugin and the Babel preset of async-browser-context change each async function. Then the runtime sets the active span again after each `await`.

1. Add async-browser-context to the dependencies of the app. The transformed code imports `async-browser-context/runtime`, and with pnpm, a module can import only the dependencies of its own package. Use the version range of otel-ts, so that the package manager installs one copy:

   ```bash
   pnpm add async-browser-context@^0.2.2
   ```

2. Add the Vite plugin to `vite.config.ts`:

   ```ts
   import { defineConfig } from "vite";
   import { asyncContext } from "async-browser-context/vite";

   export default defineConfig({
     plugins: [asyncContext()],
   });
   ```

   For other build tools, put the Babel preset `async-browser-context/babel-preset` last in the `presets` list. The [build tools guide](https://mark1russell7.github.io/AsyncBrowserContext/docs/guides/build-tools) gives the setup for webpack, Rollup, esbuild and Next.js.

The transform adds a small cost to each `await` step. The plugin has the options `include` and `exclude`. Use them to transform only the code that needs the active span after `await`. Code without the transform does not get the span of a different operation: after its own `await`, it gets no active span.

Firefox has a fast path for an `await` of a promise. A patch of `Promise.prototype.then` stops this fast path. Thus, with the runtime, each `await` of a promise takes approximately 0.8 µs more in Firefox, also in code without the transform. The patch of zone.js has the same cost. An `await` of a value that is not a promise does not change. If your app awaits many promises in hot code, measure it in Firefox.

Lag's experiment E8 compared the runtime without the transform with zone.js in Chromium, Firefox and WebKit. The runtime kept the active span in each case where zone.js kept it. It used less main-thread time, and it is smaller (5.7 KiB against 12.9 KiB with gzip). The [E8 results](https://mark1russell7.github.io/lag/research/local-experiments) give all the numbers.

### Use zone.js

Import `init` from the zone entry:

```ts
import { init } from "@mark1russell7/otel-ts/zone";

const otel = init();
```

The zone entry loads zone.js through `@opentelemetry/context-zone`. zone.js patches `Promise`, the timers and the event listeners of the page when it loads. The zone entry does not import async-browser-context.

`@opentelemetry/context-zone` is a dependency of otel-ts, not a peer dependency. Thus, the zone entry needs no other install, and its version agrees with the OpenTelemetry SDK of otel-ts. The package uses only disk space: a bundle gets zone.js only through the zone entry.

### Use no context library

Import `init` from the core entry:

```ts
import { init } from "@mark1russell7/otel-ts/core";

const otel = init();
```

The core entry imports no context library, and it patches nothing. Its default is `"stack"`: the `StackContextManager` of OpenTelemetry. You can also give your own `ContextManager`.

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

The library follows the state of the page with [`page-lifecycle-tracker`](https://github.com/mark1russell7/page-lifecycle-tracker). It uses the tracker that the page shares (`getPageLifecycle()`), and it subscribes in the `export` phase:

- To `hidden`: The library flushes all telemetry. This transition occurs at each tab switch. The providers continue to run.
- To `frozen`: The browser freezes the page, or the page goes into the back/forward cache (`pagehide` with `persisted`). The library flushes all telemetry.
- To `terminated`: The browser discards the page (`pagehide` without `persisted`). The library stops all providers.

The tracker does not listen to `beforeunload` or `unload`. These events can prevent the back/forward cache.

### Record values before a flush

Some monitors record their values at the end of the page. An example is the final Web Vitals of a page. The order of `pagehide` listeners is not the same in all browsers. Chromium calls `window` listeners in registration order. Thus, a library that stops in its own `pagehide` listener can stop before a monitor records its values.

This library flushes in the `export` phase of the shared lifecycle tracker. A monitor that subscribes to the same tracker in the `observe` phase records its values first, whatever the order of the scripts. `@lag/core` does this by default.

Values that a monitor keeps until a checkpoint can go out in each flush. Record them in an `onBeforeFlush()` listener:

```ts
import { init } from "@mark1russell7/otel-ts";
import { createBrowserDeps, setupAllMonitors } from "@lag/core";

const otel = init({ serviceName: "checkout-web" });
const monitors = setupAllMonitors(createBrowserDeps(window, { /* options */ }));
otel.onBeforeFlush(() => monitors.flush());
```

The listener gets the cause of the flush. For a page hide, `cause.transition` is the transition of the lifecycle state. For a call of `forceFlush()` or `shutdown()`, `cause.transition` is undefined.

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

The context managers also operate in a worker. In `@mark1russell7/otel-ts`, the runtime of async-browser-context patches the timers and the promises of the worker.

## Node.js services

The entry `@mark1russell7/otel-ts/node` starts OpenTelemetry in a Node.js service. It is separate from the browser entries and imports no browser library.

Install the SDK and the instrumentations in the service. The SDK is a peer dependency, so the service keeps one version line of the OpenTelemetry packages:

```bash
pnpm add @opentelemetry/sdk-node @opentelemetry/instrumentation @opentelemetry/instrumentation-http
```

Put the start in its own module:

```ts
// instrumentation.ts
import { startNodeTelemetry } from "@mark1russell7/otel-ts/node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";

export const telemetry = startNodeTelemetry({
  serviceName: "my-service",
  importMetaUrl: import.meta.url,
  instrumentations: [new HttpInstrumentation()],
});
```

Start the service with this module first:

```bash
node --import ./dist/instrumentation.js dist/server.js
```

The instrumentations patch a module when it loads, so this module must load before the modules of the service. In an ES module service, the CommonJS hook does not see a package that an ES module imports. When you give `importMetaUrl`, `startNodeTelemetry()` registers the loader hook of OpenTelemetry (`@opentelemetry/instrumentation/hook.mjs`) before the SDK starts. The hook then patches those imports too.

`startNodeTelemetry()` starts nothing when `OTEL_EXPORTER_OTLP_ENDPOINT` has no value. Set `enabled` to change this. By default, it stops the SDK and sends the last spans at `SIGTERM` and `SIGINT`. Then, when the service has no listener of its own for the signal, the process ends with the signal, as it does without `startNodeTelemetry()`. When the service has a listener, that listener ends the process. Set `stopOnSignals: false` to add no listener.

The option `env` sets only `enabled` and the service name. The SDK reads its exporter settings (`OTEL_EXPORTER_OTLP_*`) from `process.env`. To send the spans to another endpoint, give `traceExporter`.

### The trace of a write, in its echo

A change stream or a queue reports a write after its request ends, without the trace of the request. `createTraceEcho()` keeps the trace of each write for some seconds, and the handler of the echo takes it:

```ts
import { createTraceEcho, outgoingTraceparent } from "@mark1russell7/otel-ts/node";

const echoes = createTraceEcho();

// in the write handler
echoes.remember("orders", order.id, outgoingTraceparent(req.headers.traceparent));

// in the change-stream handler
const traceparent = echoes.take("orders", change.documentKey._id);
```

`outgoingTraceparent()` gives the context of the active span when the SDK operates. Otherwise it gives the `traceparent` header of the request.

### Apply a remote change in its trace

A client gets the change with the `traceparent` of the write. `runInRemoteTrace()` runs the apply in a consumer span whose parent is that trace. Thus one trace shows the click, the write, the server and each client that applies the change:

```ts
import { runInRemoteTrace } from "@mark1russell7/otel-ts";

socket.onChange((msg) =>
  runInRemoteTrace(msg.traceparent, () => store.apply(msg), {
    name: "realtime.echo",
    attributes: { "app.collection": msg.collection },
  }),
);
```

- Without a valid `traceparent`, it only runs the function.
- The span ends when the function returns, or when its promise settles. An error sets the status `ERROR` and passes through.
- Each entry exports it: the browser entries and `@mark1russell7/otel-ts/node`.

### Make sure that the spans arrive

A change of the load order breaks the instrumentations without an error: the service operates, and some spans are not there. The entry `@mark1russell7/otel-ts/node/testing` has a stand-in collector for a CI check:

```ts
import { startStubCollector } from "@mark1russell7/otel-ts/node/testing";

const collector = await startStubCollector();
// start the service with OTEL_EXPORTER_OTLP_ENDPOINT=collector.endpoint, then:
const missing = await collector.waitFor(
  ["@opentelemetry/instrumentation-http", "@opentelemetry/instrumentation-express"],
  { poke: () => fetch("http://127.0.0.1:8080/health") },
);
await collector.close();
if (missing.length > 0) throw new Error(`no spans from ${missing.join(", ")}`);
```

The collector reads OTLP/HTTP JSON, the format of `@opentelemetry/exporter-trace-otlp-http`.

## Development

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm test
```

`pnpm test` starts two Vitest projects:

- `browser runtime`: The tests in happy-dom. The project gives async-browser-context the browser runtime, as a browser does.
- `node`: The tests in `test/node/`. Node.js gives async-browser-context the native `AsyncLocalStorage`.

`pnpm run build` writes `dist/`. Git ignores `dist/`: the release workflow builds it from `src/` for each npm version (`RELEASING.md`).

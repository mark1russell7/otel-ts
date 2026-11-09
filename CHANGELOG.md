# Changelog

## 0.7.3

### Added

- The entry `@mark1russell7/otel-ts/lag`, with `lagDeps()` (decision D7). One call gives the monitors of `@mark1russell7/lag` the meter, the logger, the event sink and the span sink of an instance. `connect()` records the values of the monitors before each flush of the instance. Thus an app does not connect them by hand. The adapters are the adapters of lag. `@mark1russell7/lag` 0.4.2 or later is a new optional peer dependency, and no other entry imports it.

## 0.7.1

### Fixed

- When a part of `init()` failed after the claim of the context (the tracing, the metrics, the logs, Faro or the page handlers), the claim stayed. `init()` gave no instance, so nothing could call `shutdown()`, and each later `init()` or `startNodeTelemetry()` of the program threw "The context is registered already by init()". Now `init()` stops the providers that started, removes the globals of the context, gives back the claim, and throws the error.
- `startNodeTelemetry()` with an `importMetaUrl` whose loader hook did not resolve kept the claim of the context. Now it gives back the claim, so a next start can operate.
- The SIGTERM and SIGINT listeners of `startNodeTelemetry()` stayed after `shutdown()`. After a new start, a signal ended the process before the new SDK flushed: the new listener counted the old one as a listener of the service, and the old one raised the signal at once. Now `shutdown()` removes the listeners, and a listener of otel-ts is never counted as a listener of the service.
- An empty `OTEL_EXPORTER_OTLP_<SIGNAL>_PROTOCOL` or `OTEL_EXPORTER_OTLP_PROTOCOL` was an error at the start. Now an empty variable is not set, as in the OpenTelemetry specification.

## 0.7.0

### Breaking changes

- Faro has no tracing of its own. `init()` no longer gives Faro the `TracingInstrumentation` of `@grafana/faro-web-tracing`, and otel-ts no longer depends on that package. The traces go only through the OTLP exporter of otel-ts, so the Faro collector gets no traces. Before, with `tracing: false` and `faroCollectorUrl`, Faro sent its own traces to its collector. Faro still sends the errors, the logs, the Web Vitals and the views.

### Fixed

- With `faroCollectorUrl`, each `fetch()` and each XHR request had two spans. The `TracingInstrumentation` of Faro wrapped `fetch()` and XHR a second time with the global tracer provider, which is the provider of otel-ts. Its own tracer provider, propagator and context manager did not register, because otel-ts registers first. Now each request has one span.
- Each request of Faro to its collector had a span. The fetch and XHR instrumentations of otel-ts now ignore the URL of the Faro collector.
- An error or a log of Faro has the trace and the span of its context: Faro reads the context of otel-ts (`faro.api.initOTEL()`).

## 0.6.0

### Breaking changes

- The fetch and XHR spans use the stable HTTP semantic conventions, from `instrumentation-fetch` and `instrumentation-xml-http-request` 0.223 (through `auto-instrumentations-web` 0.68). The span name is the method (`GET`), not `HTTP GET`. The attributes are `url.full`, `http.request.method`, `http.response.status_code`, `server.address` and `server.port`, not `http.url`, `http.method`, `http.status_code` and `http.host`. Change the queries, dashboards and alerts that use the old names. The OpenTelemetry packages have no option for the old names.

### Security

- The OpenTelemetry packages move to the 2.12 and 0.223 lines: `@opentelemetry/core` `^2.12.0` (and `resources`, `sdk-metrics`, `sdk-trace-base`, `context-zone`, `sdk-trace-web`), the exporters, `instrumentation`, `sdk-logs` and `api-logs` `^0.223.0`, `auto-instrumentations-web` `^0.68.0` and `instrumentation-long-task` `^0.67.0`. Before 2.8.0, the W3C baggage propagator of `@opentelemetry/core` could allocate memory with no limit for a large `baggage` header (GHSA-8988-4f7v-96qf). The propagator of otel-ts uses it.
- `@grafana/faro-web-sdk` and `@grafana/faro-web-tracing` move to `^2.13.0`. The earlier versions brought `@opentelemetry/core` 2.6.0 through `otlp-transformer` 0.213.0.
- Vitest 4.1.12, for the development only (GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp).

No change to the TypeScript API of otel-ts.

## 0.5.0

### Breaking changes

- `init()` registers the propagator of otel-ts, as `startNodeTelemetry()` does. The fetch and XHR instrumentations add `traceparent` and `tracestate` to each request that `propagateTraceHeaderCorsUrls` permits, as before. They add `baggage` only to an internal call (`withInternalCall()`), with only the defined context keys. Before, each request to the origin of the page got the whole baggage. To send the context keys to your own API, start its call in `withInternalCall()`.
- A second `init()` with tracing on, before the `shutdown()` of the first, throws. Before, the second call did not register its context manager, and nothing told it. `shutdown()` now also removes the globals of the trace, propagation and context APIs, so a next `init()` registers its own.

### Added

- `init()`: each span and each log record gets the value of each context key of its context. Each metric loses the keys with `cardinality: "high"`.
- `histogramAggregation()` in `@mark1russell7/otel-ts/node`: the aggregation that `OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION` names.

### Fixed

- `startNodeTelemetry()` (0.4.0): the metric view of the context keys replaced the histogram aggregation of each reader. Thus `OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION=base2_exponential_bucket_histogram` gave explicit-bucket histograms. The views now take that aggregation. A reader of `metricReaders` with its own aggregation gets the aggregation of the variable: a view decides the aggregation.

## 0.4.0

### Breaking changes

- `startNodeTelemetry()` registers the context ids also when export is off (no `OTEL_EXPORTER_OTLP_ENDPOINT`): AsyncLocalStorage, the propagator of otel-ts and the metric view. Before, it registered nothing then.
- A second `startNodeTelemetry()` before the `shutdown()` of the first throws. `shutdown()` now also removes the globals of the API, so a next start registers its own.
- The propagator of otel-ts replaces the propagator of `OTEL_PROPAGATORS`: `traceparent` and `tracestate` go on each call, and `baggage` goes only on an internal call, with only the defined context keys.
- With export on, otel-ts makes the span and log processors. `OTEL_TRACES_EXPORTER` and `OTEL_LOGS_EXPORTER` take `otlp`, `console` or `none`, and the OTLP protocol is `http/protobuf` or `http/json`. Another value throws: for grpc, give `traceExporter` and `logExporter`.

### Added

- With export on, each span and each log record gets the value of each context key of its context. Each metric loses the keys with `cardinality: "high"`.
- The option `logExporter` of `startNodeTelemetry()`.
- `exporterNames()` and `otlpProtocol()` in `@mark1russell7/otel-ts/node`: the exporters and the protocol that the `OTEL_*` variables name.

## 0.3.1

### Added

- The entry `@mark1russell7/otel-ts/context`: `defineContextKeys`, `withContext`, `contextValue`, `contextValues`, `contextWith`, `withInternalCall` and `isInternalCall`. It adds context ids in one call, and it depends on `@opentelemetry/api` only. Refer to [Context ids](README.md#context-ids) and [docs/CONTEXT-DESIGN.md](docs/CONTEXT-DESIGN.md).

## 0.2.0

### Breaking changes

- The default of `propagateTraceHeaderCorsUrls` is `[]`: the fetch and XHR instrumentations add the trace headers (`traceparent`) only to the requests to the origin of the page, as OpenTelemetry does. Before, the default was `[/.*/]`, so each cross-origin request got the headers. A server without `traceparent` in `Access-Control-Allow-Headers` refused the preflight, and the request of the app failed. The trace IDs also went to third parties.
- To keep the trace of your own API on another origin, give its origin: `init({ propagateTraceHeaderCorsUrls: [/^https:\/\/api\.example\.com\//] })`. To get the old behavior, give `[/.*/]`.

Refer to [Trace headers to other origins](README.md#trace-headers-to-other-origins).

## 0.1.4

### Fixed

- `startNodeTelemetry()`: at `SIGTERM` and `SIGINT`, a service without a listener of its own now ends after the flush. Before, the listener of `stopOnSignals` removed the default action of Node.js, so the service continued to run until `SIGKILL`, and Ctrl+C had to be pressed two times. The listener now raises the signal again after the flush when no other listener exists. A service with its own listener ends the process itself, as before.
- The `shutdown()` of `startNodeTelemetry()`: a second call waits for the flush of the first call. Before, it returned at once.
- The documentation of the option `env` tells that the SDK reads its exporter settings from `process.env`.

## 0.1.3

### Changed

- The package has the MIT license: the file `LICENSE` and the field `license` in `package.json`. The code does not change.

## 0.1.2

### New

- `runInRemoteTrace()` in each entry: it runs the apply of a remote change in a consumer span whose parent is the `traceparent` of the message. It is the client side of `createTraceEcho()`.

Refer to [Apply a remote change in its trace](README.md#apply-a-remote-change-in-its-trace).

## 0.1.1

### New

- The entry `@mark1russell7/otel-ts/node`: `startNodeTelemetry()` starts OpenTelemetry in a Node.js service. It registers the ES module loader hook of OpenTelemetry before the SDK starts.
- `createTraceEcho()` and `outgoingTraceparent()` in `@mark1russell7/otel-ts/node`: they carry the trace of a write to its echo from a change stream or a queue.
- The entry `@mark1russell7/otel-ts/node/testing`: `startStubCollector()`, a stand-in OTLP collector for a CI check of the spans of a service.
- The optional peer dependency `@opentelemetry/sdk-node`. Only the Node entry uses it.

Refer to [Node.js services](README.md#nodejs-services).

## 0.1.0

### Breaking changes

- `@mark1russell7/otel-ts` keeps the active span with async-browser-context. The default of `contextManager` is `"async"`: the `AsyncContextManager` of async-browser-context. Before this version, the default was `"zone"`.
- `@mark1russell7/otel-ts` does not load zone.js. Before, it loaded zone.js for all values of `contextManager`, also for `"stack"`.
- `contextManager: "zone"` is only in the new entry `@mark1russell7/otel-ts/zone`. zone.js and async-browser-context patch the same functions with different rules, so they cannot share a page. In `@mark1russell7/otel-ts`, `"zone"` makes `init()` throw an error that tells you to import `init` from `@mark1russell7/otel-ts/zone`.
- When `@mark1russell7/otel-ts` loads, the runtime of async-browser-context patches `Promise.prototype.then`, the timers, the event listeners and other callback APIs. This is also true when you set `"stack"`. For a page without patches, use `@mark1russell7/otel-ts/core`.
- Each entry exports its own `OtelTsConfig` and `ContextManagerOption` types, with the `contextManager` values of the entry.

### New

- The `contextManager` value `"async"`.
- The entry `@mark1russell7/otel-ts/zone`: the same API, with zone.js. The default is `"zone"`.
- The entry `@mark1russell7/otel-ts/core`: the same API, without a context library. The default is `"stack"`.
- The type `ContextManagerName`.
- The dependency `async-browser-context` (`^0.2.2`).

Refer to [Context manager](README.md#context-manager).

## 0.0.1

- The first version.

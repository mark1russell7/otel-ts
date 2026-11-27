# Changelog

## 0.11.2

### Added

- The option `meterProvider` of `startNodeContext()`: a function that makes the meter provider of the service from the resource of the service. The context registers it as the global meter provider, and `shutdown()` flushes and stops it. A part of the program that set the global meter provider first keeps it. With no option, the entry `/node/context` does not change, and it loads no metric package.
- `exportMeterProvider({ env, exporter })` of the entry `/node/export` gives that function. The meter provider has the views of the entry `/node` and one periodic reader for each exporter of `OTEL_METRICS_EXPORTER`, with `OTEL_METRIC_EXPORT_INTERVAL` and `OTEL_METRIC_EXPORT_TIMEOUT`. With no value in `OTEL_EXPORTER_OTLP_ENDPOINT` and no exporter, it gives `undefined`. Thus a service of `/node/context` exports its metrics, for example the runtime metrics of `@opentelemetry/instrumentation-runtime-node`, with no SDK of `@opentelemetry/sdk-node`.
- The new types are `NodeMeterProvider`, `NodeMeterProviderFactory` and `ExportMetricOptions`. The type `OtlpSignal` has `"metrics"`.
- The new optional peer dependency `@opentelemetry/exporter-metrics-otlp-proto`, for the entry `/node/export`.

## 0.11.1

### Added

- `contextOwner()` and `OTHER_SDK` of `/context`: the part of the program that registered the context. It gives the call of otel-ts that holds it, `OTHER_SDK` when a part outside otel-ts registered the global tracer provider, context manager or propagator, or `undefined`. A runner starts the context only on `undefined`, so it does not replace the context of the program or the capture of a test.

## 0.11.0

### Changed (breaking)

- The package depends only on `@opentelemetry/api` and `@mark1russell7/text`. Each SDK, exporter, instrumentation and browser package is an optional peer dependency. Thus a library that imports `/context` installs 3 packages, not 101 (33 MiB). A program installs the packages of each entry that it imports. The README has the table of each entry and its packages, and a test holds the table equal to the imports of each entry.

## 0.10.5

### Added

- The entry `/node/export` has `exportSpanProcessors({ env, exporter })`. It gives the span processors of the entry `/node` for the option `spanProcessors` of `startNodeContext()`: the context processor, then a processor for each exporter of `OTEL_TRACES_EXPORTER`. With no value in `OTEL_EXPORTER_OTLP_ENDPOINT` and no exporter, it gives no processor. Thus a small service or a command line exports its spans with no SDK of `@opentelemetry/sdk-node`. The entry `/node/context` does not change, and it does not load the exporters.

## 0.10.4

### Changed

- The memory bench of the entry `/node/context` is TypeScript (`bench/*.ts`), with types and a test. The API does not change.

## 0.10.3

### Changed

- Each entry of `exports` has the condition `default`, with the file of `import`. Thus `require()` of an entry resolves on Node 22 and later, and it does not stop with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- The package has an API report, `test/api/public-api.txt`, and the script `check:api` compares it with the build in CI. Thus each change of the public API shows in the diff of a pull request. The API does not change.

## 0.10.2

### Added

- The entry `/call-trace` has `callTrace(options)`. It gives one outgoing call a trace context, also on a page with no SDK. With a valid span in the context, the call is in its trace. Else the call starts a new sampled trace with random ids, in a span that does not record. The result has `headers` (only `traceparent`) for the request, and `context` for `errorRecord()` and `reportError()`. Thus the record of a failed call has the trace id that the server got. The entry depends on `@opentelemetry/api` only.

## 0.10.1

### Added

- The entry `/incoming-span` has `runInIncomingSpan(name, headers, fn, options)`. It starts the handler of an incoming call in a SERVER span. The parent of the span is `incomingContext(headers, { trust })`, so with the default trust "trace" the span continues the trace of the caller and takes no baggage. The options `tracer` and `attributes` are optional. An error of the handler gives the span the status ERROR and passes through. The entry depends on `@opentelemetry/api` only. It is apart from `/context`, so the memory of `/node/context` does not change.

### Changed

- `runInRemoteTrace` and `runInIncomingSpan` use one internal rule for the end and the status of the span. An error of `fn` also gives the status its message.

## 0.10.0

The release train changes the range of `@mark1russell7/text` to a version outside the old range. The public types name @mark1russell7/text, so its new version outside the old range can change them.

### Breaking

- The range `^0.0.19` of `@mark1russell7/text` in `dependencies` does not hold `0.0.20`, so it changes.

## 0.9.1

### Changed

- CI runs the whole check of `@mark1russell7/conventions` (the script `check:conventions`). The rule `no-console` holds the 2 console calls of `src`: a new call fails at once, and the last ones fail from 2026-12-23. No API changes.
- The script `typecheck` also checks the tests and `vitest.config.ts` (`tsconfig.test.json`), and CI runs it.
- CI runs on each commit of `main`, on pull requests and on a manual start. A newer push cancels only the run of a pull request. The same holds for the security scans.
- The Pages site builds again after each release.
- `pnpm-workspace.yaml` sets the trust policy of pnpm (`no-downgrade`), and the dev dependency `@mark1russell7/grafana-infra` is pinned to a commit.

## 0.9.0

The release train changes the range of `@mark1russell7/text` to a version outside the old range. The public types name @mark1russell7/text, so its new version outside the old range can change them.

### Breaking

- The range `^0.0.18` of `@mark1russell7/text` in `dependencies` does not hold `0.0.19`, so it changes.

## 0.8.7

### Added

- The entry `/error-view`: one view of an error record, as a custom element with no framework (E1). It shows the message in plain words, the procedure and the time. Its actions are retry, copy the whole record, report, and open the trace. Its details give each id, the context keys and the cause chain.
- Retry and report are events (`otel-error-retry`, `otel-error-report`), so the page decides what they do. `waitUntil(promise)` keeps the retry button busy. Copy writes the text of `errorRecordText()` to the clipboard. When the clipboard refuses, the view opens the text for a manual copy.
- The trace link comes from the attribute `trace-url`, a template with `{traceId}` and `{spanId}`. Only an `http:` or `https:` link shows. With no template or no trace id, the link stays hidden.
- The colors follow the `color-scheme` of the page, and the custom properties `--otel-error-*` change them. The layout works from 320 px. The import registers nothing: call `defineErrorView()` or `errorView(record, options)`.
- `redactErrorRecord(record)` in `/error` redacts a record from another place, for example the JSON of a server. The view and `errorRecordText()` use it, so no secret reaches the view, the copy or a report. A test holds this.
- The site shows the view: "Fail a job" now gives an error view, with retry and a link that opens the trace in the page.

### Changed

- `init()` registers its logger provider as the global logger provider of the API, when it owns the globals (`tracing` on) and `logs` is on. `shutdown()` removes it. A library that logs through the API, for example `reportError()`, then reaches the export of the page, with the trace and the session.

## 0.8.6

### Added

- The entry `/error` makes an error record from the context manager (E1). An error that a page or a service shows as bare text loses its trace, its session and its procedure. The record keeps them.
- `errorRecord(error, options)` gives plain JSON: the name, the message and the code, the cause chain (`cause`, then the `errors` of an `AggregateError`, with no loop and at most 8 causes), the trace and span id of the active span, the values of the context keys, the procedure with the digest of its input, and the time. It never throws.
- Each text of the record goes through the redaction of `@mark1russell7/text/redact`. The stacks stay out unless the option `stacks` asks for them.
- `reportError(error, options)` makes the record, emits one log record of severity ERROR in the same context, and marks the active span as failed. The view, the log line and the span thus give the same ids. `errorLogAttributes(record)` gives the attributes of that log record.
- `errorRecordText(record)` gives the text to copy or to put in a report: the message, each id, the causes and the JSON.
- The entry needs only `@opentelemetry/api` and `@mark1russell7/text`. A test holds this rule. otel-ts now depends on `@mark1russell7/text`.

## 0.8.5

### Added

- The entry `/pull` reads the metrics of a process when the program asks (C26). It has `PullMetricReader`, `metricReadings` and `collectReadings`.
- `PullMetricReader` is a metric reader with no timer and no export. Its temporality is an option, and the default is `"cumulative"`.
- `metricReadings` gives the readings `{ series, at, value }` of one collection. Each set of attributes is a series by default. The option `attributes: "sum"` gives one sum for each metric. A histogram gives its count and its sum.
- The entry needs only `@opentelemetry/sdk-metrics`. A test holds this rule, and a gate test runs it on the real SDK.

## 0.8.4

### Added

- The entry `/node/context` with `startNodeContext()`: the context of a Node service that exports nothing. It registers AsyncLocalStorage, the propagator of otel-ts and a tracer provider with the resource of the service. Each span gets a trace id. It loads no SDK of `@opentelemetry/sdk-node`, no exporter and no instrumentation. A test holds this rule.
- `startNodeContext()` takes `spanProcessors`, so a test can capture the spans of the service. Its `shutdown()` flushes the processors before the stop of the provider: the stop of the provider alone does not wait for an export of a `SimpleSpanProcessor`.
- The workflow `measure-memory.yml`: a memory gate in CI. Each arm is a fresh process: the bare `@opentelemetry/api`, `/node/context` and `/node` with export off. The gate holds the bytes that `/node/context` adds to the bare API. Each run uploads its raw records.

### Changed

- `startNodeTelemetry()` with export off starts no SDK. It registers the context with the code of `startNodeContext()`, so the two paths cannot drift. The instrumentations and the loader hook stay. Two details change with export off: the tracer provider has the default sampler of the SDK (parent-based, always on) and does not read `OTEL_TRACES_SAMPLER`, and no logger provider is registered (a log record goes nowhere, as before).
- otel-ts depends on `@opentelemetry/context-async-hooks`, the AsyncLocalStorage context manager of the SDK.

## 0.8.3

### Fixed

- `startNodeTelemetry()` in the entry `/node` gives each span a trace id with export off, as its doc tells. Before, each span had the trace id zero and recorded nothing. The SDK registers its tracer provider only for a list of span processors that is not empty, and export off gave an empty list. Thus the log lines of a service had no trace id. The same fix applies with export on and `OTEL_TRACES_EXPORTER=none`. Nothing leaves the process with export off.

## 0.8.2

### Added

- `startNodeTelemetry()` in the entry `/node` takes `resourceAttributes`: the attributes of the resource of the service, for example `service.version` and `service.instance.id`. They win over the detected attributes and over `OTEL_RESOURCE_ATTRIBUTES`. Before, a `service.instance.id` of the service lost to the random id of the detector of the SDK.
- The README tells how a service of `@mark1russell7/service` starts telemetry: `stopOnSignals: false`, and `shutdown()` in the stage `flush the output`. Two tests show why: with `stopOnSignals: true`, the context goes at the signal, while the service still drains its requests.

## 0.8.1

### Fixed

- `incomingContext()` with trust `"trace"` (the default) keeps only the span context of the caller, as its doc tells. Before, it removed only the W3C baggage. A propagator of the program that reads the baggage header, or another header, into a key of its own then kept that key on a call that is not trusted. With the propagator of otel-ts, the result does not change.

## 0.8.0

### Changed (breaking)

- otel-ts uses OpenTelemetry JS 3.x: `@opentelemetry/sdk-trace`, `sdk-logs` and `sdk-metrics` 3.1, and the exporters and the instrumentation 0.301.
- The processors of the entries are processors of the 3.x SDK. Give them to a 3.x provider. A provider of the 2.x SDK does not take them.
- `startNodeTelemetry()` in the entry `/node` takes a `traceExporter` and a `logExporter` of the 3.x SDK. The optional peer `@opentelemetry/sdk-node` is now `>=0.300.0 <0.400.0`.
- `getLogger()` gives the `Logger` of `@opentelemetry/api`, because the logs API is in `@opentelemetry/api` 1.10. `@opentelemetry/api-logs` is not a dependency now.
- The minimum version of Node.js is 22.15, the minimum of the 3.x SDK (`engines`).

### Changed

- The tracer provider of 3.x has no `register()`. So `init()` sets the global tracer provider, the context manager and the propagator itself. The behavior does not change.

## 0.7.7

### Fixed

- The package builds with `@opentelemetry/api` 1.10. That version ships separate CommonJS and ES module types, and the CommonJS types of Faro did not take the ES module `trace` and `context`. No change to the behavior or the API.

## 0.7.6

### Added

- `incomingContext(headers, { trust })` in the entry `@mark1russell7/otel-ts/context`: the context of an incoming call, for its handler. The registered propagator reads the trace context and the baggage from the headers, from the root context. The headers are a record of `node:http` (a name in any case, a value or a list) or the `Headers` of Fetch (docs/CONTEXT-DESIGN.md, section 5).
- The option `trust` is `"all"` (the trace and the baggage), `"trace"` (the trace only) or `"none"` (the root context, for a public edge). The default is `"trace"`, the safe value. The types `IncomingTrust`, `IncomingContextOptions`, `IncomingHeaders` and `IncomingHeaderRecord` are new too.

## 0.7.5

### Fixed

- The package no longer ships `dist/.tsbuildinfo`, the build cache of `tsc`. The file changed on each build, also after a bump of a dev dependency, so the release of an unchanged version stopped. No change to the code or the API.

## 0.7.4

### Fixed

- With `faroCollectorUrl`, each export of the OTLP exporters made a fetch span, and the next export sent that span. The exporters send with `fetch.__original`, so that the fetch instrumentation does not see them. The request monitor of Faro replaced `fetch()` with a wrapper without `__original`. Now `init()` gives that wrapper the `__original` of the fetch that Faro replaced.

## 0.7.3

### Added

- The entry `@mark1russell7/otel-ts/lag`, with `lagDeps()` (decision D7). One call gives the monitors of `@mark1russell7/lag` the meter, the logger, the event sink and the span sink of an instance. `connect()` records the values of the monitors before each flush of the instance. Thus an app does not connect them by hand. The adapters are the adapters of lag. `@mark1russell7/lag` 0.4.2 or later is a new optional peer dependency, and no other entry imports it.

## 0.7.2

### Fixed

- `outgoingTraceparent()` and `runInRemoteTrace()` accepted a `traceparent` whose trace id or span id has only zeros. Such a value is not valid in W3C Trace Context. Now they check the value with `isSpanContextValid()` of `@opentelemetry/api` (decision D7). `outgoingTraceparent()` refuses the value, and `runInRemoteTrace()` only runs the function.
- `outgoingTraceparent()` gave a header of a later version (for example `01`) back with its extra fields. Now it gives the header in the form of version `00`, as W3C Trace Context tells a receiver to send it on.

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

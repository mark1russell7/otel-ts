# One context for logs, metrics and traces

Status: a proposal, 2026-11-08. The items are in [ROADMAP.md](ROADMAP.md), from C1.

## The problem

Mark asked for one context manager: code registers its context ids in one place, the ids go in async storage, and baggage takes them across the network. Today the parts do not join:

| Part | What it does today | What it does not do |
| --- | --- | --- |
| otel-ts, browser entries | Registers async-browser-context (or zone.js) as the context manager. The fetch and XHR instrumentations send `traceparent` and `baggage` to the origin of the page only (0.2.0). | It has no call that adds a context id. It copies only `session.id` to spans and log records. |
| otel-ts, `/node` | `startNodeTelemetry()` starts the NodeSDK. The SDK registers AsyncLocalStorage and the W3C trace context and baggage propagators. | With no OTLP endpoint, the SDK does not start. Then no context manager is registered, `context.with()` keeps nothing, and the logs get no ids. |
| `@procedures/client` | Its own W3C code (`tracing/traceparent.ts`, 61 lines) and its own span records (`tracingInterceptor`). It sends `traceparent` in the metadata of local, HTTP and WebSocket calls. | No OpenTelemetry API, no baggage, no async storage. Its spans do not go to an OpenTelemetry exporter. |
| `@mark1russell7/service` | Runs the service and writes its output. | No trace ids in its logs. Its HTTP and gRPC parts do not read `traceparent`. |
| `@procedures/peer` | Hosts procedures on HTTP, WebSocket and MCP. | It does not run the handler in the context of the caller. |

## The design

### 1. Libraries use the OpenTelemetry API only

`@procedures/client`, `@procedures/peer`, `@mark1russell7/service` and each other library depend on `@opentelemetry/api` only. The API has no dependencies, and it does nothing until a program registers an SDK. This is the rule of OpenTelemetry for libraries.

- A library sends context with `propagation.inject(context.active(), carrier)`.
- A library reads context with `propagation.extract(...)`, and runs the handler in `context.with(extracted, handler)`.
- A library makes its spans with `trace.getTracer("<package name>")`.
- No library registers a context manager, a propagator or a processor. A library that does it is a fault, and a test of the gate finds it (section 6).

So `@procedures/client` does not depend on otel-ts. The browser bundle of a client gets the API only, not Faro and not the SDK.

### 2. otel-ts is the one place that registers

otel-ts is the only package that calls `context.setGlobalContextManager`, `propagation.setGlobalPropagator` and adds span and log processors. Each program calls it one time, at its start:

| Program | Call | Context manager |
| --- | --- | --- |
| Browser page or Web Worker | `init()` (main entry) | async-browser-context (`/zone`: zone.js, `/core`: none or the app's own) |
| Node service | `startNodeTelemetry()` (`/node`) | `AsyncLocalStorageContextManager` of `@opentelemetry/context-async-hooks` |

The change: both calls register the context manager and the propagators **also when export is off**. Then ids go to the logs of a service with no collector. Today `/node` registers nothing when `OTEL_EXPORTER_OTLP_ENDPOINT` has no value.

A second registration is refused with an error that names the first caller. The OpenTelemetry API itself keeps the first registration and only writes a diagnostic message, which nobody reads.

### 3. One call adds context ids

The entry `@mark1russell7/otel-ts/context` is light: it depends on `@opentelemetry/api` only, so application code and tests can import it in the browser and on Node.

```ts
import { defineContextKeys, withContext, contextValue } from "@mark1russell7/otel-ts/context";

// One time, in the app: the keys, as data
export const keys = defineContextKeys({
  "tenant.id": { cardinality: "low", propagate: "internal" },
  "user.id": { cardinality: "high", propagate: "internal" },
  "request.id": { cardinality: "high", propagate: "internal" },
  "feature.flag": { cardinality: "low", propagate: "none" },
});

// Where the id is known
await withContext({ "user.id": user.id }, () => handle(request));

// Anywhere below, in the same async flow
contextValue("user.id");
```

- `withContext` puts the values in the baggage of a new context and runs the function in it. The async storage keeps the context through `await`, timers and callbacks.
- A key that `defineContextKeys` does not name is refused with an error. Thus a typing error does not become a silent new key.
- The keys are data. The processors (section 4), the propagator (section 5) and the gate (section 6) read the same data.

### 4. Where an id goes

| Signal | Low cardinality key | High cardinality key |
| --- | --- | --- |
| Span attributes | Yes | Yes |
| Log record attributes | Yes | Yes |
| Metric attributes | Yes | **No** |
| Metric exemplars | (none) | (none: see below) |

- A span processor copies each named key of the baggage to each new span. A log record processor does the same for each log record. These are the same processors as the `session.id` processors of today (`session-processors.ts`), made general.
- A metric attribute of high cardinality makes one time series for each value. Mimir then stores one series for each user. So a view of the meter provider removes each high cardinality key from the metric attributes, and a test holds it.
- **Exemplars: none in the SDK.** `@opentelemetry/sdk-metrics` 2.6.1 and 2.12.0 have the reservoir classes (`build/src/exemplar/`), but no aggregator or exporter uses them (read on 2026-11-08). So no metric point carries a trace id. The link from a metric to a trace comes from the storage: the metrics generator of Tempo makes the request rate, error and duration metrics from the spans, with exemplars. This is the link of a metric to its trace, and a part of item C9. Item C16 stays open: when an aggregator of the SDK records exemplars, the meter provider turns them on, and the gate reads one.

### 5. Baggage crosses only trusted calls

The W3C baggage propagator sends each baggage entry on each outgoing request. A user id must not go to a third party. So the rules are:

- `traceparent` goes on each call. It holds only random ids. A call to an untrusted origin gets it only when the existing option `propagateTraceHeaderCorsUrls` (browser) permits it.
- `baggage` goes only on a call to a trusted destination. The propagator of otel-ts injects baggage only when the active context has the mark `internal call`. `@procedures/client` sets the mark around the send of each of its transports. A program can set it with `withInternalCall(fn)`. Each other outgoing call (a fetch of a third party, a database driver) gets no baggage.
- A key with `propagate: "none"` never leaves the process.
- On the server side, `@procedures/peer` extracts baggage only from a caller that passed its token check. An untrusted caller keeps its `traceparent` (the trace joins), but its baggage is dropped.
- The propagator keeps the W3C limits: at most 180 entries and 8192 bytes. A value longer than its key's limit is dropped, not cut.

### 6. The propagation gate

A test helper of the rigor test helpers (the home of test helpers) holds the claim "one id goes everywhere":

1. The test starts an in-memory span exporter, log exporter and metric reader.
2. A client sets `request.id` with `withContext`, then calls a procedure of a server.
3. The handler on the server reads `contextValue("request.id")`, writes a log line and records a metric.
4. The gate reads: the server span has the client span as its parent, with the same trace id; the server span and the log record have `request.id`; the metric has no `request.id` attribute; a third-party call of the handler has no `baggage` header.
5. The gate runs on each transport: local, HTTP, WebSocket, port (a worker), MCP (`_meta`) and the CLI (the variables `TRACEPARENT` and `BAGGAGE` of the OpenTelemetry environment carrier).

The flip test: a transport that drops the header turns the gate red, and a clean copy stays green in the same job. A transport that the gate cannot reach is a "no read" line on the pull request, not a pass.

### 7. Sampling

- The root of a trace decides: the browser page, or the first service of a call with no `traceparent`. The default is all traces (ratio 1.0). `OTEL_TRACES_SAMPLER_ARG` sets a ratio.
- Each other part follows its parent (`ParentBased`), so a trace is never cut in the middle.
- A log record keeps its trace id and its context keys also when its trace is not sampled. Thus a log line always leads to its request.
- Tail sampling (keep each trace with an error) is a part of the collector, in item C9.

### 8. Storage

`grafana-infra` already has Alloy, Tempo, Loki and Mimir in Docker Compose, for local work. The plan for the home cluster waits on the talk about the home cluster. Until then, the collector and storage are local only. Item C9 adds: the OTLP of Node services, the link from a log line to its trace (a derived field on `trace_id`), the metrics generator of Tempo, and tail sampling.

## The decisions to make

| ID | Question | Proposal | Who |
| --- | --- | --- | --- |
| D1 | Where is the home of the context? | **Decided on 2026-11-08 by the strategist: yes.** otel-ts, with the entries `/context` (light) and `/node` (registers). The map area "Observability and context" has otel-ts as its home (template#262). No new package. | The strategist (a change of the map) |
| D2 | Do the libraries depend on otel-ts? | No. They depend on `@opentelemetry/api` only (section 1). | This role |
| D3 | Does baggage leave the process on each call? | No. Only on calls with the internal mark (section 5). | This role |
| D4 | Do ids of high cardinality go on metrics? | No, never as attributes. No exemplars in the JS SDK, so Tempo's span metrics give the link (section 4). | This role |
| D5 | Does `@procedures/client` keep its own W3C code and span records? | Its W3C code goes: the API propagator replaces it. `tracingInterceptor` and its `onSpan` records stay for the trace view of the site, and take their ids from the active OpenTelemetry span. | This role, with the owner of client |
| D6 | What does `@procedures/client` do when no program registered an SDK? | **Decided on 2026-11-08 with the client role.** The API propagator then does nothing. So C8 is additive: with an SDK, the client uses the API propagator and the active span. With no SDK, it keeps its W3C code, now `@deprecated`. A later break removes that code only when the site, MiniMongo, Graph and jarvis each register an SDK in a released version. | This role, with the owner of client |

## What this design does not do

- No new logger. Logs go through the OpenTelemetry Logs API, and a service's own lines get `trace_id` and `span_id` from the active span.
- No change of the browser instrumentations.
- No storage on the home cluster before its talk.

# Changelog

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

# Changelog

## 0.1.0

### Breaking changes

- The default of `contextManager` is `"async"`: the `AsyncContextManager` of async-browser-context. Before this version, the default was `"zone"`.
- `contextManager: "zone"` needs the zone entry. Add `import "@mark1russell7/otel-ts/zone";` before `init()` runs. Without this import, `init()` throws an error that tells you what to import.
- The main entry does not load zone.js. Before, it loaded zone.js for all values of `contextManager`, also for `"stack"`.
- The main entry loads async-browser-context. When it loads, its runtime patches `Promise.prototype.then`, the timers, the event listeners and other callback APIs, for all values of `contextManager`.

### New

- The `contextManager` value `"async"`.
- The entry `@mark1russell7/otel-ts/zone`.
- The dependency `async-browser-context` (`^0.2.1`).

Refer to [Context manager](README.md#context-manager).

## 0.0.1

- The first version.

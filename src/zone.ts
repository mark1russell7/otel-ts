/**
 * The opt-in entry for `contextManager: "zone"`.
 *
 * Import it once, before `init()` runs:
 *
 * ```ts
 * import "@mark1russell7/otel-ts/zone";
 * import { init } from "@mark1russell7/otel-ts";
 *
 * init({ contextManager: "zone" });
 * ```
 *
 * The import loads zone.js (through `@opentelemetry/context-zone`), and
 * zone.js patches `Promise`, the timers and the event listeners of the page
 * when it loads. The main entry does not import this module, so zone.js loads
 * only for the apps that import it.
 *
 * @packageDocumentation
 */
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { setZoneFactory } from "./zone-factory.js";

setZoneFactory(() => new ZoneContextManager());

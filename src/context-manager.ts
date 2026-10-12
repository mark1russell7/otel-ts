import type { ContextManager } from "@opentelemetry/api";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import type { ContextManagerOption } from "./types.js";
import { getZoneFactory } from "./zone-factory.js";

/** The error of `contextManager: "zone"` without the zone entry */
export const ZONE_NOT_LOADED =
  '[otel-ts] contextManager: "zone" needs zone.js, and otel-ts does not ' +
  'load zone.js by default. Import "@mark1russell7/otel-ts/zone" once, ' +
  'before init() runs: import "@mark1russell7/otel-ts/zone";';

/**
 * The context manager for the `contextManager` option.
 *
 * @throws For `"zone"` when `@mark1russell7/otel-ts/zone` did not load
 */
export function createContextManager(option: ContextManagerOption): ContextManager {
  switch (option) {
    case "async":
      return new AsyncContextManager();
    case "stack":
      return new StackContextManager();
    case "zone": {
      const createZoneContextManager = getZoneFactory();
      if (!createZoneContextManager) throw new Error(ZONE_NOT_LOADED);
      return createZoneContextManager();
    }
    default:
      return option;
  }
}

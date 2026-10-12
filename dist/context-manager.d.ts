import type { ContextManager } from "@opentelemetry/api";
import type { ContextManagerOption } from "./types.js";
/** The error of `contextManager: "zone"` without the zone entry */
export declare const ZONE_NOT_LOADED: string;
/**
 * The context manager for the `contextManager` option.
 *
 * @throws For `"zone"` when `@mark1russell7/otel-ts/zone` did not load
 */
export declare function createContextManager(option: ContextManagerOption): ContextManager;
//# sourceMappingURL=context-manager.d.ts.map
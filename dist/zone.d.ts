import type * as Types from "./types.js";
export * from "./common.js";
/** The context manager names of this entry: "zone" (default) and "stack" */
export type ContextManagerOption = Types.ContextManagerOption<"zone" | "stack">;
/** The configuration of `init()` in this entry */
export type OtelTsConfig = Types.OtelTsConfig<"zone" | "stack">;
/**
 * Starts traces, metrics and logs. The default `contextManager` is "zone".
 *
 * @throws For `contextManager: "async"`: async-browser-context cannot share
 * the page with zone.js. Import `init` from `@mark1russell7/otel-ts`.
 */
export declare function init(config?: OtelTsConfig): Types.OtelTsInstance;
//# sourceMappingURL=zone.d.ts.map
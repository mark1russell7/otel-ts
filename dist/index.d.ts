import type * as Types from "./types.js";
export * from "./common.js";
/** The context manager names of this entry: "async" (default) and "stack" */
export type ContextManagerOption = Types.ContextManagerOption<"async" | "stack">;
/** The configuration of `init()` in this entry */
export type OtelTsConfig = Types.OtelTsConfig<"async" | "stack">;
/**
 * Starts traces, metrics and logs. The default `contextManager` is "async".
 *
 * @throws For `contextManager: "zone"`: zone.js cannot share the page with
 * async-browser-context. Import `init` from `@mark1russell7/otel-ts/zone`.
 */
export declare function init(config?: OtelTsConfig): Types.OtelTsInstance;
//# sourceMappingURL=index.d.ts.map
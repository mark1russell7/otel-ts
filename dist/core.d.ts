import type * as Types from "./types.js";
export * from "./common.js";
/** The context manager names of this entry: only "stack" (default) */
export type ContextManagerOption = Types.ContextManagerOption<"stack">;
/** The configuration of `init()` in this entry */
export type OtelTsConfig = Types.OtelTsConfig<"stack">;
/**
 * Starts traces, metrics and logs. The default `contextManager` is "stack".
 *
 * @throws For `contextManager: "async"` or `"zone"`: import `init` from
 * `@mark1russell7/otel-ts` or from `@mark1russell7/otel-ts/zone`.
 */
export declare function init(config?: OtelTsConfig): Types.OtelTsInstance;
//# sourceMappingURL=core.d.ts.map
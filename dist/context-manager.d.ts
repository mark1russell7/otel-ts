import type { ContextManager } from "@opentelemetry/api";
import type { ContextManagerName, ContextManagerOption } from "./types.js";
/**
 * The entries of the package. Each entry loads at most one context library,
 * because zone.js and async-browser-context patch the same functions with
 * different rules: they cannot share a page.
 */
export declare const ENTRIES: {
    /** async-browser-context */
    readonly main: "@mark1russell7/otel-ts";
    /** zone.js */
    readonly zone: "@mark1russell7/otel-ts/zone";
    /** No context library */
    readonly core: "@mark1russell7/otel-ts/core";
};
export type Entry = keyof typeof ENTRIES;
/** The context managers of one entry */
export interface EntryContextManagers {
    readonly entry: Entry;
    /** The name that `init()` uses when the config has no `contextManager` */
    readonly defaultName: ContextManagerName;
    /** Makes the manager for each name that the entry has */
    readonly factories: Partial<Record<ContextManagerName, () => ContextManager>>;
}
/** The error message for a name that `entry` does not have */
export declare function unavailableMessage(name: string, entry: Entry): string;
/** Makes the stack manager. Each entry has it. */
export declare const createStackContextManager: () => ContextManager;
/**
 * The context manager for the `contextManager` option, in the entry of
 * `managers`. Gives back a `ContextManager` instance of the app.
 *
 * @throws For a name that the entry does not have
 */
export declare function createContextManager(option: ContextManagerOption, managers: EntryContextManagers): ContextManager;
//# sourceMappingURL=context-manager.d.ts.map
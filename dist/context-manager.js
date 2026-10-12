import { StackContextManager } from "@opentelemetry/sdk-trace-web";
/**
 * The entries of the package. Each entry loads at most one context library,
 * because zone.js and async-browser-context patch the same functions with
 * different rules: they cannot share a page.
 */
export const ENTRIES = {
    /** async-browser-context */
    main: "@mark1russell7/otel-ts",
    /** zone.js */
    zone: "@mark1russell7/otel-ts/zone",
    /** No context library */
    core: "@mark1russell7/otel-ts/core",
};
/** The entry that has each name. Each entry has "stack". */
const ENTRY_OF = {
    async: "main",
    zone: "zone",
    stack: "core",
};
/** The context library that each entry loads */
const LIBRARY_OF = {
    main: "async-browser-context",
    zone: "zone.js",
    core: undefined,
};
/** The error message for a name that `entry` does not have */
export function unavailableMessage(name, entry) {
    const home = Object.hasOwn(ENTRY_OF, name)
        ? ENTRY_OF[name]
        : undefined;
    if (home === undefined) {
        return `[otel-ts] Unknown contextManager "${name}". Use "async", "zone" or "stack", or a ContextManager.`;
    }
    const library = LIBRARY_OF[entry];
    const reason = library
        ? `This entry loads ${library}, and zone.js and async-browser-context cannot share a page: they patch the same functions with different rules.`
        : "This entry loads no context library.";
    return (`[otel-ts] contextManager: "${name}" is not available in "${ENTRIES[entry]}". ${reason} ` +
        `Import init from "${ENTRIES[home]}" in place of "${ENTRIES[entry]}".`);
}
/** Makes the stack manager. Each entry has it. */
export const createStackContextManager = () => new StackContextManager();
/**
 * The context manager for the `contextManager` option, in the entry of
 * `managers`. Gives back a `ContextManager` instance of the app.
 *
 * @throws For a name that the entry does not have
 */
export function createContextManager(option, managers) {
    if (typeof option !== "string")
        return option;
    const factory = Object.hasOwn(managers.factories, option)
        ? managers.factories[option]
        : undefined;
    if (!factory)
        throw new Error(unavailableMessage(option, managers.entry));
    return factory();
}
//# sourceMappingURL=context-manager.js.map
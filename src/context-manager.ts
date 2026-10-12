import type { ContextManager } from "@opentelemetry/api";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import type { ContextManagerName, ContextManagerOption } from "./types.js";

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
} as const;

export type Entry = keyof typeof ENTRIES;

/** The context managers of one entry */
export interface EntryContextManagers {
  readonly entry: Entry;
  /** The name that `init()` uses when the config has no `contextManager` */
  readonly defaultName: ContextManagerName;
  /** Makes the manager for each name that the entry has */
  readonly factories: Partial<Record<ContextManagerName, () => ContextManager>>;
}

/** The entry that has each name. Each entry has "stack". */
const ENTRY_OF: Record<ContextManagerName, Entry> = {
  async: "main",
  zone: "zone",
  stack: "core",
};

/** The context library that each entry loads */
const LIBRARY_OF: Record<Entry, string | undefined> = {
  main: "async-browser-context",
  zone: "zone.js",
  core: undefined,
};

/** The error message for a name that `entry` does not have */
export function unavailableMessage(name: string, entry: Entry): string {
  const home = Object.hasOwn(ENTRY_OF, name)
    ? ENTRY_OF[name as ContextManagerName]
    : undefined;
  if (home === undefined) {
    return `[otel-ts] Unknown contextManager "${name}". Use "async", "zone" or "stack", or a ContextManager.`;
  }
  const library = LIBRARY_OF[entry];
  const reason = library
    ? `This entry loads ${library}, and zone.js and async-browser-context cannot share a page: they patch the same functions with different rules.`
    : "This entry loads no context library.";
  return (
    `[otel-ts] contextManager: "${name}" is not available in "${ENTRIES[entry]}". ${reason} ` +
    `Import init from "${ENTRIES[home]}" in place of "${ENTRIES[entry]}".`
  );
}

/** Makes the stack manager. Each entry has it. */
export const createStackContextManager = (): ContextManager =>
  new StackContextManager();

/**
 * The context manager for the `contextManager` option, in the entry of
 * `managers`. Gives back a `ContextManager` instance of the app.
 *
 * @throws For a name that the entry does not have
 */
export function createContextManager(
  option: ContextManagerOption,
  managers: EntryContextManagers,
): ContextManager {
  if (typeof option !== "string") return option;
  const factory = Object.hasOwn(managers.factories, option)
    ? managers.factories[option]
    : undefined;
  if (!factory) throw new Error(unavailableMessage(option, managers.entry));
  return factory();
}

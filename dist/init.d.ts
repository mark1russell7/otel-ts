import type { OtelTsConfig, OtelTsInstance } from "./types.js";
import { type EntryContextManagers } from "./context-manager.js";
/**
 * The `init()` of each entry. `managers` are the context managers of the
 * entry: the entry imports at most one context library.
 */
export declare function initWith(managers: EntryContextManagers, config?: OtelTsConfig): OtelTsInstance;
//# sourceMappingURL=init.d.ts.map
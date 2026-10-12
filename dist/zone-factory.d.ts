import type { ContextManager } from "@opentelemetry/api";
/** Sets the factory for `contextManager: "zone"` */
export declare function setZoneFactory(factory: () => ContextManager): void;
/** The factory for `contextManager: "zone"`, if the zone entry loaded */
export declare function getZoneFactory(): (() => ContextManager) | undefined;
//# sourceMappingURL=zone-factory.d.ts.map
/**
 * Makes the manager for `contextManager: "zone"`. Only the
 * `@mark1russell7/otel-ts/zone` entry sets it, so the main entry does not
 * load zone.js. This module imports nothing, thus the zone entry loads only
 * zone.js and this module.
 */
let zoneFactory;
/** Sets the factory for `contextManager: "zone"` */
export function setZoneFactory(factory) {
    zoneFactory = factory;
}
/** The factory for `contextManager: "zone"`, if the zone entry loaded */
export function getZoneFactory() {
    return zoneFactory;
}
//# sourceMappingURL=zone-factory.js.map
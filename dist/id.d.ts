/**
 * Returns a new random version 4 UUID (RFC 9562).
 *
 * `crypto.randomUUID()` exists only in secure contexts: HTTPS pages and
 * http://localhost. Pages served over plain http:// from any other host lack
 * it but still have `crypto.getRandomValues()`, so this falls back to that,
 * and to `Math.random()` where there is no Web Crypto at all. The result is
 * an identifier, not a secret: the fallbacks only need to make collisions
 * unlikely.
 */
export declare function randomUuid(): string;
/**
 * Returns a new value for the `service.instance.id` resource attribute: a
 * random version 4 UUID.
 *
 * `init()` calls this once per call when no `serviceInstanceId` is given, so
 * every SDK instance (each page load, each Web Worker) is its own metric
 * writer. Call it yourself only to know the value before `init()`; never
 * persist it or derive it from the session ID.
 */
export declare function createInstanceId(): string;
//# sourceMappingURL=id.d.ts.map
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
export function randomUuid(): string {
  const webCrypto = getWebCrypto();

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant (10xx)

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10, 16),
  ]
    .map((group) => group.join(""))
    .join("-");
}

/**
 * Returns a new value for the `service.instance.id` resource attribute: a
 * random version 4 UUID.
 *
 * `init()` calls this once per call when no `serviceInstanceId` is given, so
 * every SDK instance (each page load, each Web Worker) is its own metric
 * writer. Call it yourself only to know the value before `init()`; never
 * persist it or derive it from the session ID.
 */
export function createInstanceId(): string {
  return randomUuid();
}

/** Web Crypto where it exists; missing members are checked by the caller */
function getWebCrypto(): Partial<Crypto> | undefined {
  return typeof crypto === "undefined" ? undefined : crypto;
}

/**
 * Returns a function that reports the current session ID. Log records and
 * spans call it as they are created, so a session rotation shows up on the
 * next record.
 *
 * Each call counts as activity: it resumes the session stored in
 * sessionStorage and refreshes its timestamp, or starts a new session once
 * `ttlMs` has passed without activity. A session that another tracker in the
 * same tab started or rotated is adopted, so all of them agree.
 *
 * Where sessionStorage is missing, blocked or full (Web Workers, sandboxed
 * iframes), the session lives in this tracker's memory, with the same TTL.
 */
export declare function createSessionTracker(ttlMs: number): () => string;
/**
 * Resumes the session stored in sessionStorage and refreshes its timestamp,
 * or starts a new session if there is none or it is older than `ttlMs`.
 * Where sessionStorage is missing or blocked, returns a new ID on every call.
 */
export declare function getOrCreateSessionId(ttlMs: number): string;
//# sourceMappingURL=session.d.ts.map
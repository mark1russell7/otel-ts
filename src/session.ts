import { SESSION_STORAGE_KEY } from "./constants.js";
import { randomUuid } from "./id.js";

interface StoredSession {
  id: string;
  timestamp: number;
}

/** sessionStorage, or undefined where it doesn't exist (e.g. Web Workers) */
function getSessionStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    // Reading it throws where storage is blocked (e.g. sandboxed iframes)
    return undefined;
  }
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const { id, timestamp } = value as Partial<StoredSession>;
  return typeof id === "string" && id !== "" && typeof timestamp === "number";
}

function readSession(storage: Storage): StoredSession | undefined {
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return undefined;
    const stored: unknown = JSON.parse(raw);
    return isStoredSession(stored) ? stored : undefined;
  } catch {
    // sessionStorage unavailable or corrupt — treat as no session
    return undefined;
  }
}

function writeSession(storage: Storage, session: StoredSession): void {
  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage full or unavailable — proceed without persistence
  }
}

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
export function createSessionTracker(ttlMs: number): () => string {
  // The session this tracker last reported
  let current: StoredSession | undefined;

  return () => {
    const now = Date.now();
    const storage = getSessionStorage();
    const stored = storage ? readSession(storage) : undefined;

    // Prefer storage: it is shared with the tab's other trackers
    const live = [stored, current].find(
      (session) => session !== undefined && now - session.timestamp < ttlMs,
    );

    current = { id: live?.id ?? randomUuid(), timestamp: now };
    if (storage) writeSession(storage, current);

    return current.id;
  };
}

/**
 * Resumes the session stored in sessionStorage and refreshes its timestamp,
 * or starts a new session if there is none or it is older than `ttlMs`.
 * Where sessionStorage is missing or blocked, returns a new ID on every call.
 */
export function getOrCreateSessionId(ttlMs: number): string {
  return createSessionTracker(ttlMs)();
}

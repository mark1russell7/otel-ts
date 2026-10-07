import { SESSION_STORAGE_KEY } from "./constants.js";
/** sessionStorage, or undefined where it doesn't exist (e.g. Web Workers) */
function getSessionStorage() {
    try {
        return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
    }
    catch {
        // Reading it throws where storage is blocked (e.g. sandboxed iframes)
        return undefined;
    }
}
export function getOrCreateSessionId(ttlMs) {
    const storage = getSessionStorage();
    // Nothing to resume or persist without storage
    if (!storage)
        return crypto.randomUUID();
    try {
        const raw = storage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
            const stored = JSON.parse(raw);
            if (Date.now() - stored.timestamp < ttlMs) {
                // Refresh timestamp on access
                stored.timestamp = Date.now();
                storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored));
                return stored.id;
            }
        }
    }
    catch {
        // sessionStorage unavailable or corrupt — generate fresh
    }
    const session = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
    };
    try {
        storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
    catch {
        // Storage full or unavailable — proceed without persistence
    }
    return session.id;
}
//# sourceMappingURL=session.js.map
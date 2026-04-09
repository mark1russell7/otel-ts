import { SESSION_STORAGE_KEY } from "./constants.js";
export function getOrCreateSessionId(ttlMs) {
    try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
            const stored = JSON.parse(raw);
            if (Date.now() - stored.timestamp < ttlMs) {
                // Refresh timestamp on access
                stored.timestamp = Date.now();
                sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored));
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
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
    catch {
        // Storage full or unavailable — proceed without persistence
    }
    return session.id;
}
//# sourceMappingURL=session.js.map
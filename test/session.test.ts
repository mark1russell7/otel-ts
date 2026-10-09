import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionTracker, getOrCreateSessionId } from "../src/session.js";
import { SESSION_STORAGE_KEY } from "../src/constants.js";
import { UUID_V4 } from "./support/uuid.js";

const TTL_MS = 60_000;
const START = new Date("2026-10-07T12:00:00Z").getTime();

/** Moves the clock forward without running timers */
function wait(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

function blockSessionStorage(): () => void {
  // Reading sessionStorage throws in e.g. sandboxed iframes
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("Access denied", "SecurityError");
    },
  });
  return () => Object.defineProperty(globalThis, "sessionStorage", descriptor!);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("getOrCreateSessionId", () => {
  it("resumes the stored session", () => {
    const sessionId = getOrCreateSessionId(TTL_MS);

    expect(sessionId).toMatch(UUID_V4);
    expect(getOrCreateSessionId(TTL_MS)).toBe(sessionId);
  });

  it("creates a session ID when sessionStorage is blocked", () => {
    const restore = blockSessionStorage();

    try {
      expect(getOrCreateSessionId(TTL_MS)).toMatch(UUID_V4);
    } finally {
      restore();
    }
  });

  it("creates session IDs where crypto.randomUUID() is missing", () => {
    // Insecure contexts (plain http:// other than localhost) lack randomUUID
    const webCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => webCrypto.getRandomValues(bytes),
    });

    const sessionId = getOrCreateSessionId(TTL_MS);

    expect(sessionId).toMatch(UUID_V4);
    expect(getOrCreateSessionId(TTL_MS)).toBe(sessionId);
  });
});

describe("createSessionTracker", () => {
  it("reports the same session while there is activity", () => {
    const getSessionId = createSessionTracker(TTL_MS);
    const sessionId = getSessionId();

    // Each call refreshes the session, so it outlives the TTL
    for (let i = 0; i < 5; i++) {
      wait(TTL_MS - 1);
      expect(getSessionId()).toBe(sessionId);
    }
  });

  it("starts a new session after the TTL without activity", () => {
    const getSessionId = createSessionTracker(TTL_MS);
    const first = getSessionId();

    wait(TTL_MS);
    const second = getSessionId();

    expect(second).toMatch(UUID_V4);
    expect(second).not.toBe(first);
    expect(getSessionId()).toBe(second);
  });

  it("stores the session and refreshes its timestamp", () => {
    const getSessionId = createSessionTracker(TTL_MS);
    const sessionId = getSessionId();
    wait(1_000);
    getSessionId();

    expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)!)).toEqual({
      id: sessionId,
      timestamp: START + 1_000,
    });
  });

  it("resumes a session stored by an earlier page load", () => {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ id: "earlier-page", timestamp: START - 1_000 }),
    );

    expect(createSessionTracker(TTL_MS)()).toBe("earlier-page");
  });

  it("follows a rotation by another tracker in the same tab", () => {
    const first = createSessionTracker(TTL_MS);
    const second = createSessionTracker(TTL_MS);
    const sessionId = first();
    expect(second()).toBe(sessionId);

    wait(TTL_MS);
    const rotated = first();

    expect(rotated).not.toBe(sessionId);
    expect(second()).toBe(rotated);
  });

  it.each([
    ["not JSON", "{not json"],
    ["missing its ID", JSON.stringify({ timestamp: START })],
    ["missing its timestamp", JSON.stringify({ id: "no-timestamp" })],
  ])("replaces a stored session that is %s", (_, raw) => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, raw);

    const sessionId = createSessionTracker(TTL_MS)();

    expect(sessionId).toMatch(UUID_V4);
    expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)!)).toEqual({
      id: sessionId,
      timestamp: START,
    });
  });

  it("keeps the session in memory without sessionStorage (Web Workers)", () => {
    vi.stubGlobal("sessionStorage", undefined);
    const getSessionId = createSessionTracker(TTL_MS);
    const sessionId = getSessionId();

    wait(TTL_MS - 1);
    expect(getSessionId()).toBe(sessionId);

    wait(TTL_MS);
    expect(getSessionId()).not.toBe(sessionId);
  });

  it("keeps the session in memory when sessionStorage is blocked", () => {
    const restore = blockSessionStorage();

    try {
      const getSessionId = createSessionTracker(TTL_MS);
      expect(getSessionId()).toBe(getSessionId());
    } finally {
      restore();
    }
  });

  it("keeps the session in memory when sessionStorage is full", () => {
    // A full storage of its own: the global Storage is Node's own in Node 25
    // and happy-dom's in Node 24, and a spy on one prototype misses the other
    const stored = new Map<string, string>();
    const setItem = vi.fn((): void => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem,
      removeItem: (key: string) => stored.delete(key),
      clear: () => stored.clear(),
    });
    const getSessionId = createSessionTracker(TTL_MS);
    const sessionId = getSessionId();

    wait(1_000);

    expect(getSessionId()).toBe(sessionId);
    expect(setItem).toHaveBeenCalled();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

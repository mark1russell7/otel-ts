import { afterEach, describe, expect, it } from "vitest";
import { getOrCreateSessionId } from "../src/session.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("getOrCreateSessionId", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("resumes the stored session", () => {
    const sessionId = getOrCreateSessionId(60_000);

    expect(sessionId).toMatch(UUID);
    expect(getOrCreateSessionId(60_000)).toBe(sessionId);
  });

  it("creates a session ID when sessionStorage is blocked", () => {
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

    try {
      expect(getOrCreateSessionId(60_000)).toMatch(UUID);
    } finally {
      Object.defineProperty(globalThis, "sessionStorage", descriptor!);
    }
  });
});

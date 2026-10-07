import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstanceId } from "../src/index.js";
import { UUID_V4 } from "./support/uuid.js";

// The environment's Web Crypto, before any test replaces it
const webCrypto = globalThis.crypto;

function many(count: number): Set<string> {
  return new Set(Array.from({ length: count }, () => createInstanceId()));
}

describe("createInstanceId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns a new random UUID v4 on every call", () => {
    const ids = many(100);

    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it("uses crypto.randomUUID() where it exists", () => {
    const getRandomValues = vi.fn();
    vi.stubGlobal("crypto", {
      randomUUID: () => "0b6ed36e-6a8a-4e1c-9a4b-1c2d3e4f5a6b",
      getRandomValues,
    });

    expect(createInstanceId()).toBe("0b6ed36e-6a8a-4e1c-9a4b-1c2d3e4f5a6b");
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("falls back to crypto.getRandomValues() in insecure contexts", () => {
    // Plain http:// pages (other than localhost) have no crypto.randomUUID()
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set(Array.from({ length: 16 }, (_, i) => i));
        return bytes;
      },
    });
    const random = vi.spyOn(Math, "random");

    // Bytes 0x00…0x0f, with the version (byte 6) and variant (byte 8) bits set
    expect(createInstanceId()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(random).not.toHaveBeenCalled();
  });

  it("returns random UUIDs v4 from crypto.getRandomValues()", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => webCrypto.getRandomValues(bytes),
    });

    const ids = many(100);

    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it("falls back to Math.random() where there is no Web Crypto", () => {
    vi.stubGlobal("crypto", undefined);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);

    // Every byte is 0x80, with the version and variant bits set
    expect(createInstanceId()).toBe("80808080-8080-4080-8080-808080808080");
    expect(random).toHaveBeenCalledTimes(16);
  });

  it("returns random UUIDs v4 from Math.random()", () => {
    vi.stubGlobal("crypto", undefined);

    const ids = many(100);

    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});

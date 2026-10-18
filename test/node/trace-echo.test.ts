import { describe, expect, it } from "vitest";
import { createTraceEcho, outgoingTraceparent } from "../../src/trace-echo.js";

const TP = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

describe("outgoingTraceparent", () => {
  it("gives a valid header of the request when no span is active", () => {
    expect(outgoingTraceparent(TP)).toBe(TP);
    expect(outgoingTraceparent("garbage")).toBeUndefined();
    expect(outgoingTraceparent(undefined)).toBeUndefined();
    expect(outgoingTraceparent(42)).toBeUndefined();
  });
});

describe("createTraceEcho", () => {
  it("gives a kept trace to its echo one time", () => {
    const echo = createTraceEcho();
    echo.remember("config", "t1:theme", TP, 1_000);
    expect(echo.take("config", "t1:theme", 1_500)).toBe(TP);
    expect(echo.take("config", "t1:theme", 1_600)).toBeUndefined();
  });

  it("keys a trace by the scope and the id, and expires it after the TTL", () => {
    const echo = createTraceEcho({ ttlMs: 10_000 });
    echo.remember("a", "x", TP, 0);
    expect(echo.take("b", "x", 1)).toBeUndefined();
    expect(echo.take("a", "x", 10_001)).toBeUndefined();
  });

  it("keeps nothing for a write without a trace", () => {
    const echo = createTraceEcho();
    echo.remember("a", "y", undefined);
    expect(echo.size).toBe(0);
  });

  it("drops the expired traces, and then the oldest half, when it is full", () => {
    const echo = createTraceEcho({ ttlMs: 100, maxEntries: 4 });
    echo.remember("s", 1, TP, 0);
    echo.remember("s", 2, TP, 0);
    echo.remember("s", 3, TP, 150);
    echo.remember("s", 4, TP, 150);
    echo.remember("s", 5, TP, 160); // full: 1 and 2 expired
    expect(echo.size).toBe(3);
    echo.remember("s", 6, TP, 170);
    echo.remember("s", 7, TP, 170); // full, none expired: the oldest half goes
    expect(echo.take("s", 3, 170)).toBeUndefined();
    expect(echo.take("s", 7, 170)).toBe(TP);
  });

  it("keeps the stores apart", () => {
    const a = createTraceEcho();
    const b = createTraceEcho();
    a.remember("c", "x", TP, 0);
    expect(b.take("c", "x", 0)).toBeUndefined();
    expect(a.take("c", "x", 0)).toBe(TP);
  });
});

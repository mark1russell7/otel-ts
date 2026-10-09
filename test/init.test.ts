import { afterEach, describe, expect, it, vi } from "vitest";
import type { Resource } from "@opentelemetry/resources";
import type { OtelTsConfig, OtelTsInstance } from "../src/index.js";
import { init } from "../src/init.js";
import { setupTracing } from "../src/tracing.js";
import { setupMetrics } from "../src/metrics.js";
import { setupLogs } from "../src/logs.js";
import { setupFaro } from "../src/faro.js";
import { SESSION_STORAGE_KEY, SESSION_TTL_MS } from "../src/constants.js";
import { hidePage, resetVisibility, setVisibility } from "./support/page.js";
import { UUID_V4 } from "./support/uuid.js";

const providers = vi.hoisted(() => {
  const fakeProvider = () => ({
    forceFlush: vi.fn(() => Promise.resolve()),
    shutdown: vi.fn(() => Promise.resolve()),
  });
  return {
    tracer: fakeProvider(),
    meter: fakeProvider(),
    logger: fakeProvider(),
  };
});

vi.mock("../src/tracing.js", () => ({
  setupTracing: vi.fn(() => providers.tracer),
}));
vi.mock("../src/metrics.js", () => ({
  setupMetrics: vi.fn(() => providers.meter),
}));
vi.mock("../src/logs.js", () => ({
  setupLogs: vi.fn(() => providers.logger),
}));
vi.mock("../src/faro.js", () => ({ setupFaro: vi.fn() }));

const allProviders = Object.values(providers);

let instance: OtelTsInstance | undefined;

function start(config?: OtelTsConfig): OtelTsInstance {
  instance = init(config);
  return instance;
}

afterEach(async () => {
  await instance?.shutdown();
  instance = undefined;
  resetVisibility();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  sessionStorage.clear();
});

/** The resource each provider was set up with, from the latest init() */
function resources(): Record<"tracing" | "metrics" | "logs", Resource> {
  return {
    tracing: vi.mocked(setupTracing).mock.lastCall![0],
    metrics: vi.mocked(setupMetrics).mock.lastCall![0],
    logs: vi.mocked(setupLogs).mock.lastCall![0],
  };
}

function instanceId(): unknown {
  return resources().metrics.attributes["service.instance.id"];
}

/**
 * Everything the page has stored: sessionStorage (the only storage the
 * library uses) and cookies. Node 25's own `localStorage`, which has no
 * methods without `--localstorage-file`, hides happy-dom's here.
 */
function storedValues(): string {
  const session = Array.from({ length: sessionStorage.length }, (_, i) =>
    sessionStorage.getItem(sessionStorage.key(i)!),
  );
  return [...session, document.cookie].join("\n");
}

describe("init lifecycle", () => {
  it("exposes forceFlush, which flushes every provider", async () => {
    const otel = start();

    await otel.forceFlush();

    for (const provider of allProviders) {
      expect(provider.forceFlush).toHaveBeenCalledOnce();
      expect(provider.shutdown).not.toHaveBeenCalled();
    }
  });

  it("flushes every provider each time the page is hidden", () => {
    start();

    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");

    for (const provider of allProviders) {
      expect(provider.forceFlush).toHaveBeenCalledTimes(3);
    }
  });

  it("keeps providers running when the page is hidden", () => {
    start();

    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");

    for (const provider of allProviders) {
      expect(provider.shutdown).not.toHaveBeenCalled();
    }
  });

  it("shuts every provider down exactly once when the page is discarded", async () => {
    const otel = start();

    hidePage(false);

    for (const provider of allProviders) {
      expect(provider.shutdown).toHaveBeenCalledOnce();
    }

    hidePage(false);
    await otel.shutdown();

    for (const provider of allProviders) {
      expect(provider.shutdown).toHaveBeenCalledOnce();
    }
  });

  it("removes its page listeners on shutdown", async () => {
    const offWindow = vi.spyOn(window, "removeEventListener");
    const offDocument = vi.spyOn(document, "removeEventListener");
    const otel = start();

    await otel.shutdown();

    const events = [...offWindow.mock.calls, ...offDocument.mock.calls].map(
      ([type]) => type,
    );
    expect(events).toContain("visibilitychange");
    expect(events).toContain("pagehide");
  });

  it("does not flush providers after shutting down", async () => {
    const otel = start();

    // Unloading fires pagehide, then visibilitychange
    hidePage(false);
    setVisibility("hidden");
    await otel.forceFlush();

    for (const provider of allProviders) {
      expect(provider.forceFlush).not.toHaveBeenCalled();
    }
  });

  it("only flushes when the page enters the back/forward cache", () => {
    start();

    hidePage(true);

    for (const provider of allProviders) {
      expect(provider.forceFlush).toHaveBeenCalledOnce();
      expect(provider.shutdown).not.toHaveBeenCalled();
    }

    // Restored from the cache, then hidden again
    setVisibility("hidden");

    for (const provider of allProviders) {
      expect(provider.forceFlush).toHaveBeenCalledTimes(2);
    }
  });

  it("does not listen to beforeunload or unload", () => {
    const onWindow = vi.spyOn(window, "addEventListener");
    const onDocument = vi.spyOn(document, "addEventListener");

    start();

    const events = [...onWindow.mock.calls, ...onDocument.mock.calls].map(
      ([type]) => type,
    );
    expect(events).toContain("visibilitychange");
    expect(events).toContain("pagehide");
    expect(events).not.toContain("beforeunload");
    expect(events).not.toContain("unload");
  });

});

describe("onBeforeFlush", () => {
  /** When `mock` was first called, comparable across mocks */
  function firstCall(mock: { mock: { invocationCallOrder: number[] } }) {
    const [order] = mock.mock.invocationCallOrder;
    if (order === undefined) throw new Error("not called");
    return order;
  }

  it("runs listeners in registration order before the page-hide flush", () => {
    const otel = start();
    const first = vi.fn();
    const second = vi.fn();
    otel.onBeforeFlush(first);
    otel.onBeforeFlush(second);

    setVisibility("hidden");

    expect(firstCall(first)).toBeLessThan(firstCall(second));
    for (const provider of allProviders) {
      expect(firstCall(second)).toBeLessThan(firstCall(provider.forceFlush));
    }
  });

  it("gives listeners the page event that started the flush, and no event for a manual flush", async () => {
    const otel = start();
    const listener = vi.fn();
    otel.onBeforeFlush(listener);

    setVisibility("hidden");
    await otel.forceFlush();
    hidePage(false);

    const causes = listener.mock.calls.map(([cause]) => cause as { event?: Event });
    expect(causes.map((cause) => cause.event?.type)).toEqual(["visibilitychange", undefined, "pagehide"]);
    expect((causes[2]!.event as Event & { persisted: boolean }).persisted).toBe(false);
  });

  it("runs listeners on every page hide", () => {
    const listener = vi.fn();
    start().onBeforeFlush(listener);

    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("runs listeners before the shutdown when the page is discarded", () => {
    const listener = vi.fn();
    start().onBeforeFlush(listener);

    hidePage(false);

    expect(listener).toHaveBeenCalledOnce();
    for (const provider of allProviders) {
      expect(firstCall(listener)).toBeLessThan(firstCall(provider.shutdown));
    }
  });

  it("runs listeners at the start of a manual forceFlush()", async () => {
    const otel = start();
    const listener = vi.fn();
    otel.onBeforeFlush(listener);

    const flushed = otel.forceFlush();

    // Synchronously, before forceFlush() returns
    expect(listener).toHaveBeenCalledOnce();
    await flushed;
    for (const provider of allProviders) {
      expect(firstCall(listener)).toBeLessThan(firstCall(provider.forceFlush));
    }
  });

  it("runs listeners once at the start of a manual shutdown()", async () => {
    const otel = start();
    const listener = vi.fn();
    otel.onBeforeFlush(listener);

    await otel.shutdown();
    await otel.shutdown();
    await otel.forceFlush();
    hidePage(false);

    expect(listener).toHaveBeenCalledOnce();
    for (const provider of allProviders) {
      expect(firstCall(listener)).toBeLessThan(firstCall(provider.shutdown));
    }
  });

  it("keeps running listeners and flushing when a listener throws", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const otel = start();
    const after = vi.fn();
    otel.onBeforeFlush(() => {
      throw new Error("listener failed");
    });
    otel.onBeforeFlush(after);

    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");

    expect(after).toHaveBeenCalledTimes(2);
    for (const provider of allProviders) {
      expect(provider.forceFlush).toHaveBeenCalledTimes(2);
    }
    // Logged once, not on every flush
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]![0]).toContain("[otel-ts]");
    expect(logged.mock.calls[0]![1]).toEqual(new Error("listener failed"));
  });

  it("stops calling a listener once it is removed", () => {
    const otel = start();
    const removed = vi.fn();
    const kept = vi.fn();
    const remove = otel.onBeforeFlush(removed);
    otel.onBeforeFlush(kept);

    remove();
    remove();
    setVisibility("hidden");

    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledOnce();
  });

  it("removes only one registration of a listener added twice", () => {
    const otel = start();
    const listener = vi.fn();
    const remove = otel.onBeforeFlush(listener);
    otel.onBeforeFlush(listener);

    remove();
    setVisibility("hidden");

    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not run listeners again when a listener flushes", () => {
    const otel = start();
    const listener = vi.fn(() => void otel.forceFlush());
    otel.onBeforeFlush(listener);

    setVisibility("hidden");

    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("init Faro", () => {
  const url = "https://faro.example.com/collect";

  it("sets up Faro when faroCollectorUrl is set and there is a DOM", () => {
    start({ faroCollectorUrl: url });

    expect(setupFaro).toHaveBeenCalledOnce();
    expect(setupFaro).toHaveBeenCalledWith(expect.anything(), url);
  });

  it("does not start Faro without faroCollectorUrl", () => {
    // Faro has no transport then, and logs an error if it starts
    start();
    start({ faroCollectorUrl: "" });

    expect(setupFaro).not.toHaveBeenCalled();
  });

  it("does not start Faro when faro is false", () => {
    start({ faro: false, faroCollectorUrl: url });

    expect(setupFaro).not.toHaveBeenCalled();
  });
});

describe("init browser attributes", () => {
  it("puts the browser attributes on each resource by default", () => {
    start();

    const { tracing, metrics, logs } = resources();
    for (const resource of [tracing, metrics, logs]) {
      expect(resource.attributes["user_agent.original"]).toBe(navigator.userAgent);
      expect(resource.attributes["browser.language"]).toBe(navigator.language);
    }
  });

  it("leaves them out with browserAttributes: false, and the config attributes have priority", () => {
    start({ browserAttributes: false });
    expect(resources().metrics.attributes["user_agent.original"]).toBeUndefined();

    start({ resourceAttributes: { "browser.language": "x-test" } });
    expect(resources().metrics.attributes["browser.language"]).toBe("x-test");
  });
});

describe("init service.instance.id", () => {
  it("sets service.instance.id from serviceInstanceId", () => {
    start({ serviceInstanceId: "checkout-7f3a" });

    expect(resources().tracing.attributes["service.instance.id"]).toBe(
      "checkout-7f3a",
    );
  });

  it("generates a random UUID v4 by default", () => {
    start();

    expect(instanceId()).toMatch(UUID_V4);
  });

  it("generates a new one for every init()", async () => {
    const ids = new Set<unknown>();

    for (let i = 0; i < 3; i++) {
      await start().shutdown();
      ids.add(instanceId());
    }

    expect(ids.size).toBe(3);
  });

  it("replaces an empty serviceInstanceId", () => {
    // An empty instance label is the same as none
    start({ serviceInstanceId: "" });

    expect(instanceId()).toMatch(UUID_V4);
  });

  it("is the same on the metrics, logs and traces resources", () => {
    start();

    const { tracing, metrics, logs } = resources();
    expect(metrics.attributes["service.instance.id"]).toMatch(UUID_V4);
    expect(logs.attributes["service.instance.id"]).toBe(
      metrics.attributes["service.instance.id"],
    );
    expect(tracing.attributes["service.instance.id"]).toBe(
      metrics.attributes["service.instance.id"],
    );
  });

  it("is not the session ID and is never stored", () => {
    const otel = start();

    expect(instanceId()).not.toBe(otel.getSessionId());
    expect(storedValues()).toContain(otel.getSessionId());
    expect(storedValues()).not.toContain(instanceId());
  });

  it("works where crypto.randomUUID() is missing (insecure contexts)", () => {
    const webCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => webCrypto.getRandomValues(bytes),
    });

    const otel = start({ sessionTracking: false });

    expect(instanceId()).toMatch(UUID_V4);
    expect(otel.getSessionId()).toMatch(UUID_V4);
  });
});

describe("init session.id", () => {
  it("keeps session.id off every resource", () => {
    start();

    for (const resource of Object.values(resources())) {
      expect(resource.attributes).not.toHaveProperty(["session.id"]);
    }
  });

  it("gives logs and traces a reader for the current session ID", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const otel = start();
    const forLogs = vi.mocked(setupLogs).mock.lastCall![2];
    const forSpans = vi.mocked(setupTracing).mock.lastCall![2];
    const first = otel.getSessionId();

    expect(forLogs()).toBe(first);
    expect(forSpans()).toBe(first);

    // 30 minutes without activity rotate the session; the readers follow
    vi.setSystemTime(Date.now() + SESSION_TTL_MS);
    const rotated = forLogs();

    expect(rotated).toMatch(UUID_V4);
    expect(rotated).not.toBe(first);
    expect(forSpans()).toBe(rotated);
    expect(otel.getSessionId()).toBe(rotated);
  });

  it("resumes the stored session", async () => {
    const first = start().getSessionId();
    await instance!.shutdown();

    expect(start().getSessionId()).toBe(first);
  });

  it("uses one unstored session ID when sessionTracking is false", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const otel = start({ sessionTracking: false });
    const sessionId = otel.getSessionId();

    vi.setSystemTime(Date.now() + SESSION_TTL_MS);

    expect(sessionId).toMatch(UUID_V4);
    expect(otel.getSessionId()).toBe(sessionId);
    expect(vi.mocked(setupLogs).mock.lastCall![2]()).toBe(sessionId);
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

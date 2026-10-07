import { afterEach, describe, expect, it, vi } from "vitest";
import type { OtelTsConfig, OtelTsInstance } from "../src/index.js";
import { init } from "../src/init.js";
import { setupTracing } from "../src/tracing.js";
import { setupFaro } from "../src/faro.js";
import { hidePage, resetVisibility, setVisibility } from "./support/page.js";

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
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

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

  it("sets up Faro when there is a DOM", () => {
    start();

    expect(setupFaro).toHaveBeenCalledOnce();
  });
});

describe("init resource", () => {
  it("sets service.instance.id from serviceInstanceId", () => {
    start({ serviceInstanceId: "checkout-7f3a" });

    const [resource] = vi.mocked(setupTracing).mock.calls[0]!;
    expect(resource.attributes["service.instance.id"]).toBe("checkout-7f3a");
  });

  it("leaves service.instance.id unset by default", () => {
    start();

    const [resource] = vi.mocked(setupTracing).mock.calls[0]!;
    expect(resource.attributes).not.toHaveProperty(["service.instance.id"]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLifecycleHandlers } from "../src/lifecycle.js";
import { hidePage, resetVisibility, setVisibility } from "./support/page.js";
import { resetSharedPageLifecycle } from "page-lifecycle-tracker";

describe("registerLifecycleHandlers", () => {
  const handlers = {
    flush: vi.fn(() => Promise.resolve()),
    shutdown: vi.fn(() => Promise.resolve()),
  };
  const removers: Array<() => void> = [];

  function register(): () => void {
    const remove = registerLifecycleHandlers(handlers);
    removers.push(remove);
    return remove;
  }

  afterEach(() => {
    for (const remove of removers.splice(0)) remove();
    resetSharedPageLifecycle();
    resetVisibility();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("flushes every time the page is hidden", () => {
    register();

    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");

    expect(handlers.flush).toHaveBeenCalledTimes(3);
  });

  it("does not shut down when the page is hidden", () => {
    register();

    setVisibility("hidden");

    expect(handlers.shutdown).not.toHaveBeenCalled();
  });

  it("shuts down when the page is discarded", () => {
    register();

    hidePage(false);

    expect(handlers.shutdown).toHaveBeenCalledOnce();
    expect(handlers.flush).not.toHaveBeenCalled();
  });

  it("only flushes when the page enters the back/forward cache", () => {
    register();

    hidePage(true);

    expect(handlers.flush).toHaveBeenCalledOnce();
    expect(handlers.shutdown).not.toHaveBeenCalled();
  });

  it("gives each handler the transition that started it", () => {
    register();

    setVisibility("hidden");
    hidePage(true);
    hidePage(false);

    type Cause = { transition: { to: string; trigger: string } };
    expect(handlers.flush.mock.calls.map(([cause]) => (cause as Cause).transition.to)).toEqual(["hidden", "frozen"]);
    expect((handlers.shutdown.mock.calls[0]![0] as Cause).transition).toMatchObject({ to: "terminated", trigger: "pagehide" });
  });

  it("listens through the shared tracker to visibilitychange and pagehide, never to beforeunload or unload", () => {
    const onWindow = vi.spyOn(window, "addEventListener");
    const onDocument = vi.spyOn(document, "addEventListener");

    register();

    // The shared lifecycle tracker listens: also to freeze, resume, focus, blur and pageshow
    const events = [...onWindow.mock.calls, ...onDocument.mock.calls].map(([type]) => type);
    expect(events).toEqual(expect.arrayContaining(["visibilitychange", "pagehide", "pageshow"]));
    expect(events).not.toContain("beforeunload");
    expect(events).not.toContain("unload");
  });

  it("stops listening once removed", () => {
    const remove = register();

    remove();
    setVisibility("hidden");
    hidePage(false);

    expect(handlers.flush).not.toHaveBeenCalled();
    expect(handlers.shutdown).not.toHaveBeenCalled();
  });
});

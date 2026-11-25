import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOT_CONTEXT } from "@opentelemetry/api";
import { errorRecord, errorRecordText, type ErrorRecord } from "../src/error-record.js";
import { defineErrorView, ERROR_VIEW_TAG, errorView, ErrorViewElement, traceLink } from "../src/error-view.js";

const record = (): ErrorRecord =>
  errorRecord(new Error("the save failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) }), {
    from: ROOT_CONTEXT,
    id: "r-1",
    at: new Date("2026-11-25T18:00:00Z"),
    procedure: { name: "items.save", inputDigest: "sha256:ab" },
  });

const traced = (): ErrorRecord => ({ ...record(), traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", sampled: true });

const shadow = (element: Element): ShadowRoot => {
  const root = element.shadowRoot;
  if (!root) throw new Error("no shadow root");
  return root;
};
const action = (element: Element, name: string): HTMLElement | null => shadow(element).querySelector(`[data-action="${name}"]`);

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("traceLink", () => {
  it("fills the template with the ids, encoded", () => {
    expect(traceLink("https://grafana.example/explore?trace={traceId}&span={spanId}", traced())).toBe(
      "https://grafana.example/explore?trace=0af7651916cd43dd8448eb211c80319c&span=b7ad6b7169203331",
    );
  });

  it("gives nothing with no trace id, no template, or a scheme that is not http", () => {
    expect(traceLink("https://grafana.example/{traceId}", record())).toBeUndefined();
    expect(traceLink("", traced())).toBeUndefined();
    expect(traceLink("javascript:alert('{traceId}')", traced())).toBeUndefined();
  });

  it("resolves a relative template against a base", () => {
    expect(traceLink("/traces/{traceId}", traced(), "https://site.example/a/")).toBe("https://site.example/traces/0af7651916cd43dd8448eb211c80319c");
  });
});

describe("the element", () => {
  it("shows the message, the procedure, the ids and the causes as text", () => {
    const element = errorView(traced(), { retry: true, report: "Report it", traceUrl: "https://grafana.example/{traceId}" });
    document.body.append(element);

    const root = shadow(element);
    expect(root.querySelector(".title")?.textContent).toBe("the save failed");
    expect(root.querySelector(".meta")?.textContent).toContain("items.save");
    expect([...root.querySelectorAll("dt")].map((node) => node.textContent)).toEqual(["Trace", "Span", "Procedure", "Input digest", "Time", "Record"]);
    expect(root.querySelector("ol")?.textContent).toContain("Error: socket hang up");
    expect(action(element, "retry")?.textContent).toBe("Retry");
    expect(action(element, "report")?.textContent).toBe("Report it");
    expect(action(element, "trace")?.getAttribute("href")).toBe("https://grafana.example/0af7651916cd43dd8448eb211c80319c");
    expect(element.getAttribute("role")).toBe("alert");
  });

  it("puts a plain headline first, and the message below it", () => {
    const element = errorView(record(), { summary: "Your change was not saved." });
    document.body.append(element);

    expect(shadow(element).querySelector(".title")?.textContent).toBe("Your change was not saved.");
    expect(shadow(element).querySelector(".meta")?.textContent).toContain("the save failed");
  });

  it("shows no retry, no report and no trace link unless asked, and never parses the record as HTML", () => {
    const element = errorView({ ...record(), message: '<img src=x onerror="alert(1)">' });
    document.body.append(element);

    expect(action(element, "retry")).toBeNull();
    expect(action(element, "report")).toBeNull();
    expect(action(element, "trace")).toBeNull();
    expect(shadow(element).querySelector("img")).toBeNull();
    expect(shadow(element).querySelector(".title")?.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it("sends retry with the record, and stays busy until the promise of the page settles", async () => {
    const element = errorView(record(), { retry: true });
    document.body.append(element);
    let finish: () => void = () => {};
    const seen: ErrorRecord[] = [];
    element.addEventListener("otel-error-retry", (event) => {
      seen.push(event.detail.record);
      event.detail.waitUntil(new Promise<void>((resolve) => (finish = resolve)));
    });

    action(element, "retry")?.click();
    expect(seen.map((each) => each.id)).toEqual(["r-1"]);
    expect(action(element, "retry")?.getAttribute("aria-disabled")).toBe("true");
    action(element, "retry")?.click();
    expect(seen).toHaveLength(1);

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(action(element, "retry")?.getAttribute("aria-disabled")).toBeNull();
  });

  it("sends report with the record and its text", () => {
    const element = errorView(record(), { report: true });
    document.body.append(element);
    const texts: string[] = [];
    element.addEventListener("otel-error-report", (event) => texts.push(event.detail.text));

    action(element, "report")?.click();

    expect(texts).toEqual([errorRecordText(record())]);
  });

  it("copies the text of the record to the clipboard", async () => {
    const writes: string[] = [];
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => void writes.push(text));
    const element = errorView(record());
    document.body.append(element);

    await expect(element.copy()).resolves.toBe(true);

    expect(writes).toEqual([errorRecordText(record())]);
    expect(shadow(element).querySelector(".status")?.textContent).toBe("The details are on the clipboard.");
  });

  it("opens the text for a manual copy when the clipboard refuses", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const element = errorView(record());
    document.body.append(element);
    const copies: boolean[] = [];
    element.addEventListener("otel-error-copy", (event) => copies.push(event.detail.copied));

    await expect(element.copy()).resolves.toBe(false);

    const area = shadow(element).querySelector("textarea");
    expect(copies).toEqual([false]);
    expect(shadow(element).querySelector("details")?.open).toBe(true);
    expect(area?.hidden).toBe(false);
    expect(area?.value).toBe(errorRecordText(record()));
  });

  it("redacts a record from another place: no secret reaches the view, the copy or the report", async () => {
    const token = "ghp_" + "b".repeat(36);
    // A record as a server could send it, with no redaction
    const raw: ErrorRecord = {
      ...record(),
      message: `GET /api?access_token=${token} failed`,
      context: { "session.id": "s-1", "request.auth": `Bearer ${token}` },
      procedure: { name: `items.save --token ${token}` },
      attributes: { url: `https://user:${token}@host.example/` },
      causes: [{ name: "Error", message: `password=${token}` }],
    };
    const writes: string[] = [];
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => void writes.push(text));
    const element = errorView(raw, { report: true, retry: true });
    document.body.append(element);
    const reports: string[] = [];
    const retries: string[] = [];
    element.addEventListener("otel-error-report", (event) => reports.push(event.detail.text));
    element.addEventListener("otel-error-retry", (event) => retries.push(JSON.stringify(event.detail.record)));

    await element.copy();
    action(element, "report")?.click();
    action(element, "retry")?.click();

    const shown = [...shadow(element).querySelectorAll("p, dd, li, textarea")].map((node) => (node instanceof HTMLTextAreaElement ? node.value : node.textContent)).join("\n");
    for (const text of [shown, element.text, JSON.stringify(element.record), ...writes, ...reports, ...retries]) expect(text).not.toContain(token);
    expect(writes).toHaveLength(1);
    expect(reports).toHaveLength(1);
    expect(shown).toContain("s-1");
  });

  it("registers one time under each name", () => {
    expect(customElements.get("otel-error-other")).toBeUndefined();
    defineErrorView("otel-error-other");
    defineErrorView("otel-error-other");
    defineErrorView();

    expect(document.createElement("otel-error-other")).toBeInstanceOf(ErrorViewElement);
    expect(document.createElement(ERROR_VIEW_TAG)).toBeInstanceOf(ErrorViewElement);
  });
});

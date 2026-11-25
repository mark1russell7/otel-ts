/**
 * The entry `@mark1russell7/otel-ts/error-view`: one view of an error record, as a custom element with no framework.
 *
 * The element shows the record of `@mark1russell7/otel-ts/error`:
 * - the message in plain words, the procedure and the time;
 * - the actions: retry, copy the whole record, report it, and open its trace;
 * - the details: each id, the context keys and the cause chain.
 *
 * The element does no network call. Retry and report are events: the page decides what they do. Copy writes the
 * text of `errorRecordText()` to the clipboard. The trace link comes from the attribute `trace-url`, a template with
 * `{traceId}` and `{spanId}`.
 *
 * The import registers nothing. Call `defineErrorView()` one time, or register `ErrorViewElement` with a name of
 * your own.
 *
 * Colors follow the `color-scheme` of the page, with `light-dark()`. A page sets the custom properties
 * `--otel-error-*` to use its own colors.
 *
 * @packageDocumentation
 */
import { errorRecordText, redactErrorRecord, type ErrorRecord } from "./error-record.js";

/** The default name of the element */
export const ERROR_VIEW_TAG = "otel-error";

/** The detail of the event `otel-error-retry` */
export interface ErrorRetryDetail {
  readonly record: ErrorRecord;
  /** Keep the retry button busy until the promise settles */
  waitUntil(promise: PromiseLike<unknown>): void;
}

/** The detail of the events `otel-error-report` and `otel-error-copy` */
export interface ErrorTextDetail {
  readonly record: ErrorRecord;
  /** The text of `errorRecordText(record)` */
  readonly text: string;
}

/** The detail of the event `otel-error-copy` */
export interface ErrorCopyDetail extends ErrorTextDetail {
  /** True when the clipboard took the text. Else the view opens the details with the text selected. */
  readonly copied: boolean;
}

declare global {
  interface HTMLElementEventMap {
    "otel-error-retry": CustomEvent<ErrorRetryDetail>;
    "otel-error-report": CustomEvent<ErrorTextDetail>;
    "otel-error-copy": CustomEvent<ErrorCopyDetail>;
  }
}

/**
 * The link of a trace from a template, for example `https://grafana.example/explore?trace={traceId}`. It gives
 * undefined with no trace id, and for a link that is not `http:` or `https:`.
 */
export function traceLink(template: string | null | undefined, record: ErrorRecord, base?: string): string | undefined {
  if (!template || record.traceId === undefined) return undefined;
  const href = template
    .replaceAll("{traceId}", encodeURIComponent(record.traceId))
    .replaceAll("{spanId}", encodeURIComponent(record.spanId ?? ""));
  try {
    const url = base === undefined ? new URL(href) : new URL(href, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const STYLE = `
:host {
  --_bg: var(--otel-error-bg, light-dark(#fff7f7, #241417));
  --_ink: var(--otel-error-ink, light-dark(#1b1d24, #f1e9ea));
  --_muted: var(--otel-error-muted, light-dark(#5b5f6b, #b9adb0));
  --_rule: var(--otel-error-rule, light-dark(#efc9cb, #57323a));
  --_accent: var(--otel-error-accent, light-dark(#b3261e, #ff8a85));
  --_accent-ink: var(--otel-error-accent-ink, light-dark(#ffffff, #23090b));
  --_focus: var(--otel-error-focus, light-dark(#2346c4, #93abff));
  --_mono: var(--otel-error-mono, ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace);
  display: block;
  container-type: inline-size;
  font: inherit;
  color: var(--_ink);
}
:host([hidden]) { display: none; }
.box {
  background: var(--_bg);
  border: 1px solid var(--_rule);
  border-inline-start: 4px solid var(--_accent);
  border-radius: var(--otel-error-radius, 8px);
  padding: 14px 16px;
  display: grid;
  gap: 10px;
}
.head { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; }
.icon { width: 22px; height: 22px; color: var(--_accent); flex: none; margin-top: 1px; }
.title { margin: 0; font-size: 1rem; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
.meta { margin: 2px 0 0; color: var(--_muted); font-size: 0.875rem; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button, a.trace {
  font: inherit; font-size: 0.875rem; line-height: 1.2;
  min-height: 36px; padding: 8px 14px; border-radius: 6px;
  border: 1px solid var(--_rule); background: transparent; color: var(--_ink);
  cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
}
button.primary { background: var(--_accent); border-color: var(--_accent); color: var(--_accent-ink); font-weight: 600; }
button:hover, a.trace:hover { border-color: var(--_accent); }
button:focus-visible, a.trace:focus-visible, summary:focus-visible, textarea:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
button[aria-disabled="true"] { opacity: 0.6; cursor: progress; }
.status { margin: 0; min-height: 1.2em; font-size: 0.8125rem; color: var(--_muted); }
.status:empty { display: none; }
details { border-top: 1px solid var(--_rule); padding-top: 8px; }
summary { cursor: pointer; font-size: 0.875rem; color: var(--_muted); width: fit-content; border-radius: 4px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 10px 0 0; font-size: 0.8125rem; }
dt { color: var(--_muted); }
dd { margin: 0; font-family: var(--_mono); overflow-wrap: anywhere; }
ol { margin: 10px 0 0; padding-inline-start: 20px; font-size: 0.8125rem; display: grid; gap: 4px; }
ol .via { color: var(--_muted); }
textarea {
  width: 100%; box-sizing: border-box; margin-top: 10px; min-height: 8em; resize: vertical;
  font: 0.75rem/1.4 var(--_mono); color: var(--_ink); background: transparent;
  border: 1px solid var(--_rule); border-radius: 6px; padding: 8px;
}
@container (max-width: 420px) {
  dl { grid-template-columns: 1fr; gap: 0; }
  dd { margin-bottom: 6px; }
  .actions > * { flex: 1 1 auto; justify-content: center; }
}
@media (prefers-reduced-motion: no-preference) {
  button, a.trace { transition: border-color 120ms ease; }
}
`;

const ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>';

/** A local time for people, with the ISO text as its title */
function timeText(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The base class: `HTMLElement` in a browser, a stand-in in Node.js, so that an import on a server does not throw */
const ElementBase: typeof HTMLElement = (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement ?? (class {} as unknown as typeof HTMLElement);

/** The element of one error record. Set `record` to show it. */
export class ErrorViewElement extends ElementBase {
  static get observedAttributes(): string[] {
    return ["trace-url", "trace-target", "retry", "report", "summary", "open"];
  }

  #record: ErrorRecord | undefined;
  #busy = false;
  #status = "";
  readonly #root: ShadowRoot;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
  }

  /** The record that the element shows */
  get record(): ErrorRecord | undefined {
    return this.#record;
  }

  /** The setter keeps the redacted copy of the record (`redactErrorRecord`), so the view, the copy and the report hold no secret. */
  set record(record: ErrorRecord | undefined) {
    this.#record = record === undefined ? undefined : redactErrorRecord(record);
    this.#busy = false;
    this.#status = "";
    this.#render();
  }

  /** The text of the record, as the copy action gives it */
  get text(): string {
    return this.#record ? errorRecordText(this.#record) : "";
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "alert");
    this.#render();
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  /** Copy the text of the record. It gives true when the clipboard took it. */
  async copy(): Promise<boolean> {
    const record = this.#record;
    if (!record) return false;
    const text = errorRecordText(record);
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = false;
    }
    this.#setStatus(copied ? "The details are on the clipboard." : "The clipboard is not available. Select the text below and copy it.");
    if (!copied) this.#showText();
    this.dispatchEvent(new CustomEvent<ErrorCopyDetail>("otel-error-copy", { detail: { record, text, copied }, bubbles: true, composed: true }));
    return copied;
  }

  #setStatus(text: string): void {
    this.#status = text;
    const status = this.#root.querySelector(".status");
    if (status) status.textContent = text;
  }

  #showText(): void {
    const details = this.#root.querySelector("details");
    const area = this.#root.querySelector("textarea");
    if (details) details.open = true;
    if (area) {
      area.hidden = false;
      area.focus();
      area.select();
    }
  }

  #retry(): void {
    const record = this.#record;
    if (!record || this.#busy) return;
    let wait: PromiseLike<unknown> | undefined;
    this.dispatchEvent(
      new CustomEvent<ErrorRetryDetail>("otel-error-retry", {
        detail: { record, waitUntil: (promise) => void (wait = promise) },
        bubbles: true,
        composed: true,
      }),
    );
    if (!wait) return;
    this.#busy = true;
    this.#render();
    const settle = (): void => {
      // A new record during the retry already cleared the busy state
      if (this.#record !== record) return;
      this.#busy = false;
      this.#render();
    };
    wait.then(settle, settle);
  }

  #report(): void {
    const record = this.#record;
    if (!record) return;
    this.dispatchEvent(
      new CustomEvent<ErrorTextDetail>("otel-error-report", { detail: { record, text: errorRecordText(record) }, bubbles: true, composed: true }),
    );
  }

  #render(): void {
    const root = this.#root;
    const record = this.#record;
    const wasOpen = root.querySelector("details")?.open ?? this.hasAttribute("open");
    // A render keeps the focus on the same action, so a keyboard user does not lose the place
    const focused = (root.activeElement as HTMLElement | null)?.dataset?.["action"];
    root.replaceChildren();
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.append(style);
    if (!record) return;

    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
      const node = Object.assign(document.createElement(tag), props);
      node.append(...children);
      return node;
    };

    const box = make("div", { className: "box" });
    box.setAttribute("part", "box");

    const head = make("div", { className: "head" });
    const icon = document.createElement("template");
    icon.innerHTML = ICON;
    const summary = this.getAttribute("summary");
    const meta: string[] = [];
    if (summary) meta.push(record.message);
    if (record.procedure) meta.push(record.procedure.name);
    meta.push(timeText(record.at));
    if (record.code) meta.push(record.code);
    head.append(
      icon.content,
      make("div", {}, make("p", { className: "title", textContent: summary || record.message || record.name }), make("p", { className: "meta", textContent: meta.join(" · ") })),
    );
    box.append(head);

    const actions = make("div", { className: "actions" });
    if (this.hasAttribute("retry")) {
      const retry = make("button", { type: "button", className: "primary", textContent: this.#busy ? "Retrying…" : "Retry" });
      if (this.#busy) retry.setAttribute("aria-disabled", "true");
      retry.dataset["action"] = "retry";
      retry.addEventListener("click", () => this.#retry());
      actions.append(retry);
    }
    const copy = make("button", { type: "button", textContent: "Copy details" });
    copy.dataset["action"] = "copy";
    copy.addEventListener("click", () => void this.copy());
    actions.append(copy);
    if (this.hasAttribute("report")) {
      const report = make("button", { type: "button", textContent: this.getAttribute("report") || "Report" });
      report.dataset["action"] = "report";
      report.addEventListener("click", () => this.#report());
      actions.append(report);
    }
    const href = traceLink(this.getAttribute("trace-url"), record, document.baseURI);
    if (href) {
      // The default opens the trace in a new tab. `trace-target="_self"` opens it in the page, for example a view of the page.
      const target = this.getAttribute("trace-target") || "_blank";
      const link = make("a", { className: "trace", href, textContent: "Open the trace" });
      if (target !== "_self") Object.assign(link, { target, rel: "noopener noreferrer" });
      link.dataset["action"] = "trace";
      actions.append(link);
    }
    box.append(actions);

    const status = make("p", { className: "status", textContent: this.#status });
    status.setAttribute("role", "status");
    box.append(status);

    const rows: [string, string | undefined][] = [
      ["Trace", record.traceId],
      ["Span", record.spanId],
      ["Procedure", record.procedure?.name],
      ["Input digest", record.procedure?.inputDigest],
      ...Object.entries(record.context),
      ...Object.entries(record.attributes ?? {}).map(([key, value]): [string, string] => [key, String(value)]),
      ["Time", record.at],
      ["Record", record.id],
    ];
    const list = make("dl");
    for (const [label, value] of rows) if (value !== undefined && value !== "") list.append(make("dt", { textContent: label }), make("dd", { textContent: value }));
    const details = make("details", { open: wasOpen }, make("summary", { textContent: "Details" }), list);
    if (record.causes.length > 1) {
      const causes = make("ol");
      causes.setAttribute("aria-label", "The causes");
      for (const cause of record.causes.slice(1)) causes.append(make("li", {}, `${cause.name}: ${cause.message}`, make("span", { className: "via", textContent: cause.via ? ` (${cause.via})` : "" })));
      details.append(causes);
    }
    const area = make("textarea", { readOnly: true, hidden: true, value: errorRecordText(record) });
    area.setAttribute("aria-label", "The details as text");
    details.append(area);
    box.append(details);
    root.append(box);
    if (focused) root.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
  }
}

/** Register the element under `name`, one time. A second call with the same name does nothing. */
export function defineErrorView(name: string = ERROR_VIEW_TAG): void {
  if (!customElements.get(name)) customElements.define(name, class extends ErrorViewElement {});
}

/** The options of `errorView()` */
export interface ErrorViewOptions {
  /** Show a retry button */
  readonly retry?: boolean;
  /** Show a report button, with this label (default: Report) */
  readonly report?: boolean | string;
  /** The template of the trace link */
  readonly traceUrl?: string;
  /** Where the trace link opens. Default: `_blank`. */
  readonly traceTarget?: string;
  /** A headline in plain words. The message of the record then goes in the line below it. */
  readonly summary?: string;
  /** The name of the element. Default: `ERROR_VIEW_TAG`. */
  readonly tag?: string;
}

/** Make an element for `record`. It registers the element first, when it is not registered. */
export function errorView(record: ErrorRecord, options: ErrorViewOptions = {}): ErrorViewElement {
  const tag = options.tag ?? ERROR_VIEW_TAG;
  defineErrorView(tag);
  const element = document.createElement(tag) as ErrorViewElement;
  if (options.retry) element.setAttribute("retry", "");
  if (options.report) element.setAttribute("report", options.report === true ? "" : options.report);
  if (options.traceUrl) element.setAttribute("trace-url", options.traceUrl);
  if (options.traceTarget) element.setAttribute("trace-target", options.traceTarget);
  if (options.summary) element.setAttribute("summary", options.summary);
  element.record = record;
  return element;
}

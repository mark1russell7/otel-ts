/**
 * The views of the page. Each function draws one part of the page from the store. The views add no listener: `main.ts`
 * has one listener for each region, and it runs before `init()`, so that a click on a view makes no span.
 */
import { h } from "@mark1russell7/site-pages/chrome";
import { barPosition, formatBytes, formatMs } from "./otlp.ts";
import type { FaroItem } from "./faro.ts";
import type { Attributes, LogRecord, MetricRecord, SpanRecord } from "./otlp.ts";
import type { Capture, Store, TraceGroup, Totals } from "./store.ts";
import { FARO_PATH } from "./wire.ts";
import type { Lane } from "./wire.ts";

/** The most traces that the waterfall shows. */
const SHOWN_TRACES = 6;

/** The most exports that the list shows. */
const SHOWN_EXPORTS = 12;

/** The most log records that the list shows. */
const SHOWN_LOGS = 8;

/** The time that the lanes of the wire show, in milliseconds. */
export const WIRE_WINDOW_MS = 60_000;

/** The lanes of the wire, in their order. */
export const LANES: readonly Lane[] = ["traces", "metrics", "logs", "faro"];

/** This function gives the path of the collector that a lane shows. */
function lanePath(lane: Lane): string {
  return lane === "faro" ? FARO_PATH : `/v1/${lane}`;
}

/** The most Faro items that the list shows. */
const SHOWN_FARO = 8;

/** This function gives the first eight characters of an ID. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** This function gives the text of an attribute value. */
function valueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value) ?? "";
}

/** This function draws a table of attributes. */
function attributeTable(attributes: Attributes): HTMLElement {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return h("p", { class: "quiet" }, "No attributes.");
  return h(
    "dl",
    { class: "attrs" },
    entries.flatMap(([key, value]) => [h("dt", {}, key), h("dd", {}, valueText(value))]),
  );
}

/** This function draws one row of a waterfall. */
function spanRow(group: TraceGroup, span: SpanRecord, depth: number, selected: string | undefined, seen: Set<string>): HTMLElement {
  const { left, width } = barPosition(span, group.startMs, group.endMs);
  const logs = group.logs.filter((log) => log.spanId === span.spanId);
  const isNew = !seen.has(span.spanId);
  seen.add(span.spanId);
  const bar = h("span", { class: `bar${span.status === "error" ? " bar-error" : ""}`, style: `left:${left.toFixed(3)}%;width:max(${width.toFixed(3)}%,2px)` });
  const mark = (className: string, timeMs: number, title: string): HTMLElement => {
    const position = barPosition({ ...span, startMs: timeMs, endMs: timeMs }, group.startMs, group.endMs);
    return h("span", { class: className, style: `left:${position.left.toFixed(3)}%`, title });
  };
  const markers = [
    ...logs.map((log) => mark("log-mark", log.timeMs, `Log record: ${log.body}`)),
    ...group.faro.filter((item) => item.spanId === span.spanId).map((item) => mark("faro-mark", item.timeMs, `Faro ${item.kind}: ${item.text}`)),
  ];
  return h(
    "li",
    {},
    h(
      "button",
      {
        type: "button",
        class: `span-row${selected === span.spanId ? " is-selected" : ""}${isNew ? " is-new" : ""}`,
        "data-span": span.spanId,
        "data-parent": span.parentSpanId ?? "",
        "data-name": span.name,
        "data-status": span.status,
        "aria-pressed": selected === span.spanId ? "true" : "false",
        style: `--depth:${depth}`,
      },
      h("span", { class: "span-name" }, h("span", { class: "span-label" }, span.name), span.status === "error" ? h("span", { class: "tag tag-error" }, "error") : null),
      h("span", { class: "track" }, bar, markers),
      h("span", { class: "span-time" }, formatMs(span.endMs - span.startMs)),
    ),
  );
}

/** This function draws the waterfall of the newest traces. `seen` holds the IDs of the spans that are already on the page. */
export function drawWaterfall(target: HTMLElement, store: Store, selected: string | undefined, seen: Set<string>): void {
  const traces = store.traces().slice(0, SHOWN_TRACES);
  if (traces.length === 0) {
    target.replaceChildren(h("p", { class: "empty" }, "The first trace comes from the page load. It appears in a moment."));
    return;
  }
  const cards = traces.map((group) =>
    h(
      "article",
      { class: "trace", "data-trace": group.traceId },
      h(
        "header",
        { class: "trace-head" },
        h("span", { class: "trace-name" }, group.name),
        h("span", { class: "trace-meta" }, `${group.rows.length} ${group.rows.length === 1 ? "span" : "spans"}, ${formatMs(group.endMs - group.startMs)}`),
        h("code", { class: "trace-id" }, shortId(group.traceId)),
      ),
      h(
        "ol",
        { class: "rows" },
        group.rows.map(({ span, depth }) => spanRow(group, span, depth, selected, seen)),
      ),
    ),
  );
  target.replaceChildren(...cards);
}

/** This function draws the panel of one span. */
export function drawDetail(target: HTMLElement, store: Store, spanId: string | undefined): void {
  const span = spanId === undefined ? undefined : store.span(spanId);
  if (span === undefined) {
    target.replaceChildren(h("p", { class: "empty" }, "Press a span row to read its attributes."));
    return;
  }
  const request = store.requestOf(span);
  const requestPart =
    typeof span.attributes["url.full"] !== "string"
      ? null
      : h(
          "section",
          {},
          h("h4", {}, "Headers of the request"),
          request?.traceparent
            ? h("dl", { class: "attrs", id: "detail-traceparent" }, h("dt", {}, "traceparent"), h("dd", {}, request.traceparent))
            : h("p", { class: "quiet", id: "detail-traceparent" }, "This request has no traceparent header. Its origin is not the page origin, and it is not in propagateTraceHeaderCorsUrls."),
        );
  const events =
    span.events.length === 0
      ? null
      : h(
          "section",
          { id: "detail-events" },
          h("h4", {}, "Events"),
          span.events.map((event) => h("div", { class: "event" }, h("strong", {}, event.name), attributeTable(event.attributes))),
        );
  const parts = [
    h(
      "header",
      { class: "detail-head" },
      h("h3", { id: "detail-name" }, span.name),
      h("p", { class: "quiet" }, `${span.kind} span, ${formatMs(span.endMs - span.startMs)}, status ${span.status}. From ${span.scope}.`),
    ),
    h("section", {}, h("h4", {}, "Attributes"), h("div", { id: "detail-attrs" }, attributeTable(span.attributes))),
    requestPart,
    events,
    h("section", {}, h("h4", {}, "Resource"), attributeTable(span.resource)),
    h("details", { class: "raw" }, h("summary", {}, "The OTLP object of this span"), h("pre", { tabindex: "0" }, JSON.stringify(span.raw, null, 2))),
  ];
  target.replaceChildren(...parts.filter((part) => part !== null));
}

/** This function gives the left edge of a packet, in percent of its lane. */
export function packetPosition(at: number, now: number): number {
  return Math.min(Math.max(100 - ((now - at) / WIRE_WINDOW_MS) * 100, 0), 100);
}

/** This function gives the size of a packet in pixels. The area follows the bytes of the export. */
export function packetSize(bytes: number): number {
  return Math.round(Math.min(Math.max(Math.sqrt(bytes) / 4, 12), 34));
}

/** This function gives the text of an export for a tooltip. */
function captureLabel(capture: Capture): string {
  const units: Readonly<Record<Lane, string>> = { traces: "spans", metrics: "data points", logs: "log records", faro: "Faro items" };
  return `Export ${capture.id} to ${lanePath(capture.signal)}: ${capture.records} ${units[capture.signal]}, ${formatBytes(capture.bytes)}, ${capture.cause}`;
}

/** This function draws the four lanes of the wire. */
export function drawLanes(target: HTMLElement, store: Store, selected: number | undefined, now: number): void {
  const recent = store.captures().filter((capture) => now - capture.at <= WIRE_WINDOW_MS);
  const lanes = LANES.map((signal) => {
    const packets = recent
      .filter((capture) => capture.signal === signal)
      .map((capture) => {
        const size = packetSize(capture.bytes);
        return h("button", {
          type: "button",
          class: `packet packet-${signal}${capture.id === selected ? " is-selected" : ""}`,
          "data-export": capture.id,
          "aria-label": captureLabel(capture),
          title: captureLabel(capture),
          style: `left:${packetPosition(capture.at, now).toFixed(2)}%;--size:${size}px`,
        });
      });
    return h(
      "div",
      { class: "lane", "data-lane": signal },
      h("span", { class: "lane-name" }, h("span", { class: `key key-${signal}` }), lanePath(signal)),
      h("div", { class: "lane-track" }, packets),
    );
  });
  target.replaceChildren(...lanes);
}

/** This function draws the list of the newest exports. */
export function drawExports(target: HTMLElement, store: Store, selected: number | undefined): void {
  const rows = [...store.captures()].reverse().slice(0, SHOWN_EXPORTS);
  target.replaceChildren(
    ...rows.map((capture) =>
      h(
        "tr",
        { class: capture.id === selected ? "is-selected" : "" },
        h("td", {}, h("button", { type: "button", class: "link-button", "data-export": capture.id }, `#${capture.id}`)),
        h("td", {}, h("span", { class: `key key-${capture.signal}` }), capture.signal),
        h("td", { class: "num" }, String(capture.records)),
        h("td", { class: "num" }, formatBytes(capture.bytes)),
        h("td", {}, capture.cause),
      ),
    ),
  );
}

/** This function draws the payload of an export. */
export function drawPayload(line: HTMLElement, target: HTMLElement, capture: Capture | undefined): void {
  if (capture === undefined) {
    line.textContent = "Press an export to read its payload.";
    target.textContent = "";
    return;
  }
  line.textContent = `${capture.method} ${capture.url}, content-type: ${capture.headers["content-type"] ?? "none"}. This request ended in this page.`;
  target.textContent = JSON.stringify(capture.body, null, 2);
}

/** This function gives the label of the upper limit of a bucket. */
function bucketLabel(limit: number): string {
  if (limit === Number.POSITIVE_INFINITY) return "above";
  return `up to ${limit >= 100 ? Math.round(limit) : Number(limit.toPrecision(3))}`;
}

/** This function draws the bars of the histogram points. */
function drawHistogram(point: MetricRecord): HTMLElement {
  const buckets = point.buckets.filter((bucket) => bucket.count > 0);
  const largest = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return h(
    "div",
    { class: "histogram", "data-action": String(point.attributes["action"] ?? "") },
    h("p", { class: "histogram-head" }, h("code", {}, String(point.attributes["action"] ?? "")), ` ${point.count ?? 0} in ${formatMs(point.value)}`),
    buckets.map((bucket) =>
      h(
        "div",
        { class: "bucket" },
        h("span", { class: "bucket-label" }, bucketLabel(bucket.limit)),
        h("span", { class: "bucket-track" }, h("span", { class: "bucket-bar", style: `width:${((bucket.count / largest) * 100).toFixed(1)}%` })),
        h("span", { class: "bucket-count" }, String(bucket.count)),
      ),
    ),
  );
}

/** This function draws the data points of the newest metrics export. */
export function drawMetrics(table: HTMLElement, bars: HTMLElement, store: Store): void {
  const points = store.latestMetrics();
  const counters = points.filter((point) => point.type === "sum" || point.type === "gauge");
  const histograms = points.filter((point) => point.type.endsWith("histogram"));
  table.replaceChildren(
    ...counters.map((point) =>
      h(
        "tr",
        { "data-metric": point.name, "data-action": String(point.attributes["action"] ?? "") },
        h("td", {}, h("code", {}, String(point.attributes["action"] ?? point.name))),
        h("td", {}, point.temporality),
        h("td", { class: "num" }, String(point.value)),
      ),
    ),
  );
  const head = histograms[0];
  const caption =
    head === undefined
      ? null
      : h("p", { class: "quiet" }, h("code", {}, head.name), ` is ${head.type === "histogram" ? "an explicit" : "an exponential"} histogram, ${head.temporality}. The bars show the buckets with a count.`);
  bars.replaceChildren(...[caption, ...histograms.map(drawHistogram)].filter((node) => node !== null));
}

/** This function draws one log record. */
function logRow(log: LogRecord): HTMLElement {
  const failed = log.severityNumber >= 17;
  return h(
    "li",
    { class: "log", "data-trace": log.traceId ?? "", "data-severity": log.severity },
    h("span", { class: `tag${failed ? " tag-error" : ""}` }, log.severity),
    h("span", { class: "log-body" }, log.body),
    log.spanId === undefined ? h("span", { class: "quiet" }, "no trace") : h("button", { type: "button", class: "link-button", "data-span": log.spanId }, `span ${shortId(log.spanId)}`),
  );
}

/** This function draws the newest log records. */
export function drawLogs(target: HTMLElement, store: Store): void {
  const logs = store.logs().slice(0, SHOWN_LOGS);
  target.replaceChildren(...(logs.length === 0 ? [h("li", { class: "empty" }, "No log records yet. The buttons Write a log and Checkout make them.")] : logs.map(logRow)));
}

/** This function draws one Faro item. */
function faroRow(item: FaroItem): HTMLElement {
  return h(
    "li",
    { class: "log", "data-trace": item.traceId ?? "", "data-kind": item.kind },
    h("span", { class: `tag${item.kind === "exception" ? " tag-error" : ""}` }, item.kind),
    h("span", { class: "log-body" }, item.text),
    item.spanId === undefined ? h("span", { class: "quiet" }, "no trace") : h("button", { type: "button", class: "link-button", "data-span": item.spanId }, `span ${shortId(item.spanId)}`),
  );
}

/** This function draws the newest Faro items. */
export function drawFaro(target: HTMLElement, store: Store): void {
  const items = store.faro().slice(0, SHOWN_FARO);
  target.replaceChildren(...(items.length === 0 ? [h("li", { class: "empty" }, "No Faro items yet. The buttons Fail a job and Checkout give one to Faro.")] : items.map(faroRow)));
}

/** This function writes the totals into the status line. */
export function drawTotals(totals: Totals): void {
  const set = (id: string, text: string): void => {
    const element = document.getElementById(id);
    if (element !== null) element.textContent = text;
  };
  set("stat-spans", String(totals.spans));
  set("stat-points", String(totals.points));
  set("stat-logs", String(totals.logs));
  set("stat-faro", String(totals.faro));
  set("stat-exports", String(totals.exports));
  set("stat-bytes", formatBytes(totals.bytes));
}

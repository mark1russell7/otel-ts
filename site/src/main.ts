/**
 * The page. The order of this file is important:
 * 1. The listeners of the views and of the viewer controls start first. The click instrumentation wraps only the
 *    listeners that start after `init()`, so a click on a view makes no span.
 * 2. The wire replaces `fetch`, so that the exporters of `init()` find it.
 * 3. `init()` runs.
 * 4. The listeners of the action buttons start. A click on one of these buttons makes a real click span.
 */
import "./style.css";
import { byId, copyText, setupTheme, showBuild } from "@mark1russell7/site-pages/chrome";
import { configText, labConfig, OPTION_VALUES, readOptions, startLab } from "./lab.ts";
import type { ActionName, Lab, LabOptions } from "./lab.ts";
import { formatMs } from "./otlp.ts";
import { createStore } from "./store.ts";
import type { Capture } from "./store.ts";
import { drawDetail, drawExports, drawLanes, drawLogs, drawMetrics, drawPayload, drawTotals, drawWaterfall, shortId } from "./views.ts";
import { createWire } from "./wire.ts";

/** The time from an action to its flush. The fetch instrumentation ends a span about 300 ms after the response. */
const FLUSH_DELAY_MS = 450;

/** The time from the load event to the first flush. The document load spans end shortly after that event. */
const FIRST_FLUSH_MS = 900;

/** The key of the instance ID of the last load, in `sessionStorage`. */
const LAST_INSTANCE_KEY = "otel-ts-demo-instance";

const ACTIONS: readonly (readonly [string, ActionName])[] = [
  ["act-fetch", "fetch"],
  ["act-other-origin", "other-origin"],
  ["act-slow", "slow"],
  ["act-failed-job", "failed-job"],
  ["act-checkout", "checkout"],
  ["act-log", "log"],
];

setupTheme(byId<HTMLButtonElement>("theme"), "otel-ts-theme");
showBuild(byId("build"), __BUILD__, "mark1russell7/otel-ts");

const store = createStore();
const seenSpans = new Set<string>();
let selectedSpan: string | undefined;
let followSpans = true;
let selectedExport: number | undefined;
let followExports = true;
let drawnSpan: string | undefined;
let flushLabel: string | undefined;

const waterfall = byId("waterfall");
const detail = byId("detail");
const lanes = byId("lanes");
const exportsBody = byId("exports");
const payload = byId("payload");
const payloadLine = byId("payload-line");
const follow = byId<HTMLButtonElement>("follow");

/** This function redraws a region, and it gives the focus back to the same control. */
function keepFocus(region: HTMLElement, attribute: string, redraw: () => void): void {
  const active = document.activeElement;
  const value = active instanceof HTMLElement && region.contains(active) ? active.getAttribute(attribute) : null;
  redraw();
  if (value !== null) region.querySelector<HTMLElement>(`[${attribute}="${value}"]`)?.focus();
}

function drawSpans(): void {
  if (followSpans) selectedSpan = store.traces()[0]?.rows[0]?.span.spanId ?? selectedSpan;
  keepFocus(waterfall, "data-span", () => drawWaterfall(waterfall, store, selectedSpan, seenSpans));
  follow.hidden = followSpans && followExports;
  if (drawnSpan !== selectedSpan) {
    drawnSpan = selectedSpan;
    drawDetail(detail, store, selectedSpan);
  }
}

function drawWire(): void {
  keepFocus(lanes, "data-export", () => drawLanes(lanes, store, selectedExport, Date.now()));
  keepFocus(exportsBody, "data-export", () => drawExports(exportsBody, store, selectedExport));
}

function drawAll(capture: Capture | undefined): void {
  if (followExports && capture !== undefined) selectedExport = capture.id;
  drawSpans();
  drawWire();
  if (followExports && capture !== undefined) drawPayload(payloadLine, payload, capture);
  drawMetrics(byId("metrics"), byId("histograms"), store);
  drawLogs(byId("logs"), store);
  drawTotals(store.totals());
  drawLeft();
}

/** This function counts the requests of the page to other origins. The browser gives the list, not this page. */
function drawLeft(): void {
  const left = performance.getEntriesByType("resource").filter((entry) => new URL(entry.name).origin !== location.origin);
  byId("stat-left").textContent = String(left.length);
}

function selectSpan(spanId: string): void {
  selectedSpan = spanId;
  followSpans = false;
  drawSpans();
}

function selectExport(id: number): void {
  selectedExport = id;
  followExports = false;
  follow.hidden = false;
  drawWire();
  drawPayload(payloadLine, payload, store.capture(id));
}

/** This function gives the attribute of the control under an event, or undefined. */
function controlOf(event: Event, attribute: string): string | undefined {
  const target = event.target instanceof Element ? event.target.closest(`[${attribute}]`) : null;
  return target?.getAttribute(attribute) ?? undefined;
}

const onSpanClick = (event: Event): void => {
  const spanId = controlOf(event, "data-span");
  if (spanId !== undefined) selectSpan(spanId);
};
const onExportClick = (event: Event): void => {
  const id = controlOf(event, "data-export");
  if (id !== undefined) selectExport(Number(id));
};

waterfall.addEventListener("click", onSpanClick);
byId("logs").addEventListener("click", onSpanClick);
lanes.addEventListener("click", onExportClick);
exportsBody.addEventListener("click", onExportClick);

const readout = byId("wire-readout");
const showPacket = (event: Event): void => {
  const packet = event.target instanceof Element ? event.target.closest("[data-export]") : null;
  if (packet !== null) readout.textContent = packet.getAttribute("title") ?? "";
};
lanes.addEventListener("pointerover", showPacket);
lanes.addEventListener("focusin", showPacket);

follow.addEventListener("click", () => {
  followSpans = true;
  followExports = true;
  const newest = store.captures().at(-1);
  drawAll(newest);
});

const copyPayload = byId<HTMLButtonElement>("copy-payload");
copyPayload.addEventListener("click", () => void copyText(copyPayload, payload.textContent ?? ""));
const copyInstall = byId<HTMLButtonElement>("copy-install");
copyInstall.addEventListener("click", () => void copyText(copyInstall, byId("install").textContent ?? ""));

const options = readOptions(location.search);
const selects = Object.keys(OPTION_VALUES) as (keyof LabOptions)[];
for (const name of selects) byId<HTMLSelectElement>(`option-${name}`).value = options[name];
byId("reload").addEventListener("click", () => {
  const query = new URLSearchParams(selects.map((name) => [name, byId<HTMLSelectElement>(`option-${name}`).value]));
  location.search = query.toString();
});

const autoFlush = byId<HTMLInputElement>("auto-flush");
let lab: Lab | undefined;

function flush(label: string): void {
  flushLabel = label;
  lab?.otel.forceFlush().catch((error: unknown) => {
    byId("act-result").textContent = `The flush failed: ${String(error)}`;
  });
}

byId("flush").addEventListener("click", () => flush("flush button"));

/** This function writes the two IDs, and it compares the instance ID with the load before. */
function drawIds(capture: Capture): void {
  const id = byId("id-instance");
  if (id.textContent !== "") return;
  const group = capture.body.resourceSpans ?? capture.body.resourceMetrics ?? capture.body.resourceLogs;
  const instance = group?.[0]?.resource?.attributes?.find((attribute) => attribute.key === "service.instance.id")?.value?.stringValue ?? "";
  id.textContent = instance;
  let last: string | null = null;
  try {
    last = sessionStorage.getItem(LAST_INSTANCE_KEY);
    sessionStorage.setItem(LAST_INSTANCE_KEY, instance);
  } catch {
    // A browser can block this storage. The page then has no earlier ID to show.
  }
  byId("id-before").textContent = last === null ? "This is the first load of this tab." : `The load before had ${shortId(last)}. Reload the page and compare.`;
}

const wire = createWire(globalThis.fetch.bind(globalThis));
globalThis.fetch = wire.fetch;
wire.onRequest((record) => store.addRequest(record));
wire.onExport((record) => {
  const capture = store.addExport(record);
  drawIds(capture);
  drawAll(capture);
});

const config = labConfig(options, __BUILD__.version);
byId("config").textContent = configText(config);
const orderUrl = new URL(`${import.meta.env.BASE_URL}demo/order.json`, location.href).href;
const started = startLab(config, orderUrl);
lab = started;

started.otel.onBeforeFlush((cause) => {
  store.noteFlush(cause.transition === undefined ? (flushLabel ?? "forceFlush()") : `page ${cause.transition.to}`);
  flushLabel = undefined;
});

byId("stat-init").textContent = formatMs(started.initMs);
byId("id-session").textContent = started.otel.getSessionId();

let pendingFlush: ReturnType<typeof setTimeout> | undefined;
for (const [id, name] of ACTIONS) {
  byId(id).addEventListener("click", () => {
    void started.run(name).then((result) => {
      byId("act-result").textContent = result;
      if (!autoFlush.checked) return;
      clearTimeout(pendingFlush);
      pendingFlush = setTimeout(() => flush("flush after the action"), FLUSH_DELAY_MS);
    });
  });
}

const firstFlush = (): void => void setTimeout(() => flush("first flush of the page"), FIRST_FLUSH_MS);
if (document.readyState === "complete") firstFlush();
else window.addEventListener("load", firstFlush, { once: true });

drawDetail(detail, store, undefined);
drawAll(undefined);
setInterval(() => {
  keepFocus(lanes, "data-export", () => drawLanes(lanes, store, selectedExport, Date.now()));
  drawLeft();
}, 1000);

// The console and the site check read the same records as the views.
Object.assign(globalThis, { otelLab: { exports: () => store.captures(), options } });
document.documentElement.dataset["labReady"] = "1";

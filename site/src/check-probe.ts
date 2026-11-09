/**
 * The probe of the live lab. The site check of the Pages workflow starts it in a browser at each width, before the
 * deploy. A failed check stops the deploy. The probe presses the same buttons as a visitor, and it reads the payloads that
 * the exporters of the package gave to the stub in the page.
 *
 * The site check reads this TypeScript file directly. It removes the types and the `export` line, and it starts the
 * result as the body of an async function.
 */

// The site check gives these helpers to the probe.
declare const check: (name: string, ok: unknown, detail?: unknown) => boolean;
declare const until: <T>(fn: () => T | Promise<T>, ms?: number) => Promise<T>;
declare const wait: (ms: number) => Promise<void>;
declare const $: (selector: string) => HTMLElement | null;
declare const $$: (selector: string) => HTMLElement[];
declare const click: (target: string | Element) => void;

/** The check parses each URL, so a longer host name does not match. */
const isAt = (url: string, origin: string): boolean => URL.canParse(url) && new URL(url).origin === origin;

interface KeyValue {
  key: string;
  value?: { stringValue?: string; intValue?: string | number; doubleValue?: number };
}
interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  attributes?: KeyValue[];
  events?: { name: string }[];
  status?: { code?: number };
}
interface LogRecord {
  traceId?: string;
  spanId?: string;
  body?: { stringValue?: string };
}
interface Point {
  asDouble?: number;
  asInt?: string | number;
  attributes?: KeyValue[];
  count?: string | number;
  bucketCounts?: (string | number)[];
}
interface Metric {
  name: string;
  sum?: { aggregationTemporality?: number; dataPoints?: Point[] };
  histogram?: { dataPoints?: Point[] };
  exponentialHistogram?: { aggregationTemporality?: number; dataPoints?: Point[] };
}
interface Resource {
  attributes?: KeyValue[];
}
interface FaroTrace {
  trace_id?: string;
  span_id?: string;
}
interface Capture {
  id: number;
  signal: "traces" | "metrics" | "logs" | "faro";
  cause: string;
  url: string;
  body: {
    exceptions?: { value?: string; trace?: FaroTrace }[];
    events?: { name?: string; trace?: FaroTrace }[];
    resourceSpans?: { resource?: Resource; scopeSpans?: { spans?: Span[] }[] }[];
    resourceMetrics?: { resource?: Resource; scopeMetrics?: { metrics?: Metric[] }[] }[];
    resourceLogs?: { resource?: Resource; scopeLogs?: { logRecords?: LogRecord[] }[] }[];
  };
}
type Lab = { exports(): Capture[] };

/** The time for one export to reach the page. The batch timer is the slowest path, and it takes about 5 s. */
const SLOW = 12_000;

const labOf = (view: Window): Lab => (view as unknown as { otelLab: Lab }).otelLab;
const lab = labOf(window);
const attr = (list: KeyValue[] | undefined, key: string) => {
  const value = list?.find((item) => item.key === key)?.value;
  return value?.stringValue ?? value?.intValue ?? value?.doubleValue;
};
const spansOf = (source: Lab) => source.exports().flatMap((capture) => (capture.body.resourceSpans ?? []).flatMap((group) => (group.scopeSpans ?? []).flatMap((scope) => scope.spans ?? [])));
const logsOf = (source: Lab) => source.exports().flatMap((capture) => (capture.body.resourceLogs ?? []).flatMap((group) => (group.scopeLogs ?? []).flatMap((scope) => scope.logRecords ?? [])));
const metricsOf = (source: Lab) =>
  source
    .exports()
    .filter((capture) => capture.signal === "metrics")
    .flatMap((capture) => (capture.body.resourceMetrics ?? []).flatMap((group) => (group.scopeMetrics ?? []).flatMap((scope) => scope.metrics ?? [])));
const spans = () => spansOf(lab);
const logs = () => logsOf(lab);
const metrics = () => metricsOf(lab);
const named = (name: string) => spans().filter((span) => span.name === name);
const newest = (name: string) => named(name).at(-1);
const counterTotal = (action: string) => {
  const points = metrics()
    .filter((metric) => metric.name === "demo.actions")
    .flatMap((metric) => metric.sum?.dataPoints ?? [])
    .filter((point) => attr(point.attributes, "action") === action);
  const point = points.at(-1);
  return Number(point?.asInt ?? point?.asDouble ?? 0);
};

// The page load
check("the page load gives a documentLoad trace, with no click", await until(() => named("documentLoad").length > 0, SLOW), spans().map((span) => span.name));
check("the waterfall draws that trace", await until(() => $(`#waterfall [data-name="documentLoad"]`) !== null), $("#waterfall")?.textContent?.slice(0, 200));

// The payload is real OTLP
const first = lab.exports().find((capture) => capture.signal === "traces");
check("the export goes to the collector path as OTLP", first?.url === "https://collector.invalid/v1/traces" && first.body.resourceSpans?.[0]?.scopeSpans !== undefined, first?.url);
check("the resource has the service name of init()", attr(first?.body.resourceSpans?.[0]?.resource?.attributes, "service.name") === "otel-ts-demo");

// An action makes a click span and a fetch span
const sent = lab.exports().length;
click("#act-fetch");
const fetchSpan = await until(() => spans().find((span) => span.name === "GET" && String(attr(span.attributes, "url.full")).endsWith("/demo/order.json")), SLOW);
const clickSpan = spans().find((span) => span.spanId === fetchSpan?.parentSpanId);
check("a click on Fetch a file gives a fetch span under a click span", clickSpan?.name === "click", clickSpan?.name);
check("the auto flush exported the action in a moment", lab.exports().slice(sent).some((capture) => capture.cause === "flush after the action"), lab.exports().slice(sent).map((capture) => capture.cause));
check("the fetch span has the status of the real response", Number(attr(fetchSpan?.attributes, "http.response.status_code")) === 200, fetchSpan?.attributes);

// A row of the waterfall opens the span, and the request carries its IDs
click(`#waterfall [data-span="${fetchSpan?.spanId}"]`);
check("a span row shows its attributes", await until(() => ($("#detail-attrs")?.textContent ?? "").includes("url.full")), $("#detail")?.textContent?.slice(0, 200));
const traceparent = $("#detail-traceparent")?.textContent ?? "";
check("the request carried the trace ID and the span ID of the fetch span", traceparent.includes(`00-${fetchSpan?.traceId}-${fetchSpan?.spanId}-`), traceparent);
check("a selected span stops the auto follow", $("#follow")?.hidden === false);
click("#follow");

// Another origin
click("#act-other-origin");
const otherSpan = await until(() => spans().find((span) => isAt(String(attr(span.attributes, "url.full")), "https://api.example.invalid")), SLOW);
check("a call to another origin gives a fetch span", otherSpan !== undefined);
click(`#waterfall [data-span="${otherSpan?.spanId}"]`);
check("that request has no traceparent", await until(() => ($("#detail-traceparent")?.textContent ?? "").includes("no traceparent")), $("#detail-traceparent")?.textContent);
click("#follow");

// A long task
const knownTasks = new Set(named("longtask").map((span) => span.spanId));
click("#act-slow");
const longTask = await until(() => named("longtask").find((span) => !knownTasks.has(span.spanId) && Number(attr(span.attributes, "longtask.duration")) >= 100), SLOW);
check("the busy main thread gives a new long task span of 100 ms or more", longTask !== undefined, named("longtask").map((span) => span.attributes));

// A failed job, with no error on the console (the site check fails on one)
click("#act-failed-job");
const job = await until(() => newest("payment job"), SLOW);
check("the failed job has the status ERROR", job?.status?.code === 2, job?.status);
check("the failed job has an exception event", job?.events?.some((event) => event.name === "exception"), job?.events);
check("the failed job has the click span as its remote parent", spans().find((span) => span.spanId === job?.parentSpanId)?.name === "click", job?.parentSpanId);
check("the waterfall marks the failed span in text", await until(() => $(`#waterfall [data-span="${job?.spanId}"] .tag-error`)?.textContent === "error"));
const failLog = await until(() => logs().find((log) => log.body?.stringValue === "The payment job failed on purpose"), SLOW);
check("the error log has the trace of the job", failLog?.traceId === job?.traceId, failLog);
const faroError = await until(() => lab.exports().flatMap((capture) => capture.body.exceptions ?? []).find((item) => item.value === "The payment job failed on purpose"), SLOW);
check("Faro got the error with the IDs of the click span", faroError?.trace?.trace_id === job?.traceId && faroError?.trace?.span_id === job?.parentSpanId, faroError);
check("the Faro list links the error to the click span", await until(() => $(`#faro [data-kind="exception"] button[data-span="${job?.parentSpanId}"]`) !== null), $("#faro")?.textContent?.slice(0, 200));

// The checkout keeps its span across two timers, one fetch and one then callback
click("#act-checkout");
const saved = await until(() => newest("save the order"), SLOW);
const root = newest("checkout");
const pricing = newest("price the cart");
check("the checkout span has the click span as its parent", spans().find((span) => span.spanId === root?.parentSpanId)?.name === "click", root?.parentSpanId);
check("the span after a timer has the checkout span as its parent", pricing?.parentSpanId === root?.spanId, pricing);
check("the span in a then callback has the checkout span as its parent", saved?.parentSpanId === root?.spanId, saved);
const orderLog = logs().find((log) => log.body?.stringValue === "The order is saved");
check("the log record of the checkout has the IDs of its span", orderLog?.spanId === saved?.spanId && orderLog?.traceId === saved?.traceId, orderLog);
check("the waterfall shows the log record on the span", await until(() => $(`#waterfall [data-span="${saved?.spanId}"] .log-mark`) !== null));
const faroEvent = await until(() => lab.exports().flatMap((capture) => capture.body.events ?? []).find((item) => item.name === "order saved"), SLOW);
check("the Faro event of the checkout has the IDs of its span", faroEvent?.trace?.span_id === saved?.spanId && faroEvent?.trace?.trace_id === saved?.traceId, faroEvent);
check("the waterfall shows the Faro event on the span", await until(() => $(`#waterfall [data-span="${saved?.spanId}"] .faro-mark`) !== null));

// Faro is on, and each request has one span (the tracing of Faro made a second one before 0.7.0)
const orderSpans = () => named("GET").filter((span) => String(attr(span.attributes, "url.full")).endsWith("/demo/order.json"));
await until(() => orderSpans().length >= 2, SLOW);
await wait(1000);
check("each of the two fetches of the order has one span", orderSpans().length === 2, orderSpans().map((span) => span.spanId));
check("Faro sent its items to its collector path", lab.exports().some((capture) => capture.signal === "faro" && capture.url === "https://collector.invalid/collect"));
check("the requests of Faro make no span", !spans().some((span) => isAt(String(attr(span.attributes, "url.full")), "https://collector.invalid")), spans().map((span) => attr(span.attributes, "url.full")));

// Metrics
check("the counter of the checkout reached the collector", await until(() => counterTotal("checkout") >= 1, SLOW), counterTotal("checkout"));
const histogram = metrics().find((metric) => metric.name === "demo.action.duration")?.histogram;
check("the histogram has buckets", Number(histogram?.dataPoints?.[0]?.count) >= 1 && (histogram?.dataPoints?.[0]?.bucketCounts?.length ?? 0) > 1, histogram);
check("the page draws the buckets", await until(() => $$("#histograms .bucket-bar").length > 0));
check("the counter table shows the checkout", $('#metrics tr[data-action="checkout"]') !== null, $("#metrics")?.textContent);

// The counter grows
const before = counterTotal("log");
click("#act-log");
check("each press adds 1 to the counter", await until(() => counterTotal("log") === before + 1, SLOW), `${before} ${counterTotal("log")}`);

// The flush button and a hidden page give the cause of the export
const autoFlush = $("#auto-flush") as HTMLInputElement;
click(autoFlush);
const logCount = () => lab.exports().filter((capture) => capture.signal === "logs").length;
const exportedLogs = logCount();
click("#act-log");
await wait(100);
check("with the auto flush off, the log record waits in the batch", logCount() === exportedLogs, logCount());
click("#flush");
check("the flush button exports the batch", await until(() => logCount() > exportedLogs));
check("the export names the flush button as its cause", lab.exports().filter((capture) => capture.signal === "logs").at(-1)?.cause === "flush button", lab.exports().at(-1));

const hiddenLogs = logCount();
click("#act-log");
await wait(100);
const setHidden = (hidden: boolean) => {
  if (hidden) Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  else delete (document as unknown as Record<string, unknown>)["visibilityState"];
  document.dispatchEvent(new Event("visibilitychange"));
};
setHidden(true);
check("a hidden page flushes the batch", await until(() => logCount() > hiddenLogs), logCount());
check("the export names the hidden page as its cause", lab.exports().filter((capture) => capture.signal === "logs").at(-1)?.cause === "page hidden", lab.exports().filter((capture) => capture.signal === "logs").at(-1)?.cause);
setHidden(false);
click(autoFlush);

// The wire and the payload
check("each lane of the wire has a dot", await until(() => ["traces", "metrics", "logs", "faro"].every((signal) => $(`[data-lane="${signal}"] .packet`) !== null)), $("#lanes")?.innerHTML.slice(0, 200));
const row = $('#exports button[data-export]');
const rowId = Number(row?.dataset["export"]);
if (row) click(row);
const shown = lab.exports().find((capture) => capture.id === rowId);
check("an export row shows the JSON of that export", await until(() => $("#payload")?.textContent === JSON.stringify(shown?.body, null, 2)), $("#payload")?.textContent?.slice(0, 120));
check("the line above the payload names the collector", ($("#payload-line")?.textContent ?? "").split(/\s+/).map((word) => word.replace(/[,.]$/, "")).some((word) => isAt(word, "https://collector.invalid") && /^\/(v1\/(traces|metrics|logs)|collect)$/.test(new URL(word).pathname)), $("#payload-line")?.textContent);
const packet = $(".packet");
if (packet) click(packet);
check("a dot of the wire selects its export", await until(() => $(".packet.is-selected") !== null));
click("#follow");

// The IDs
const spanAttributes = spans().at(-1)?.attributes;
const resources = [lab.exports().find((capture) => capture.signal === "traces")?.body.resourceSpans?.[0]?.resource, lab.exports().find((capture) => capture.signal === "metrics")?.body.resourceMetrics?.[0]?.resource, lab.exports().find((capture) => capture.signal === "logs")?.body.resourceLogs?.[0]?.resource];
check("the three signals have one instance ID", new Set(resources.map((resource) => attr(resource?.attributes, "service.instance.id"))).size === 1 && $("#id-instance")?.textContent === attr(resources[0]?.attributes, "service.instance.id"), resources);
check("the session ID is on the span, not on the resource", attr(spanAttributes, "session.id") === $("#id-session")?.textContent && attr(resources[0]?.attributes, "session.id") === undefined, spanAttributes);

// Nothing left the browser
const entries = performance.getEntriesByType("resource").map((entry) => entry.name);
check("the browser saw no request to another origin", entries.every((name) => new URL(name).origin === location.origin), entries);
check("the browser saw no request to the collector", !entries.some((name) => isAt(name, "https://collector.invalid")), entries);
check("the status line shows the count of the browser", $("#stat-left")?.textContent === "0", $("#stat-left")?.textContent);
check("the page tells that the data stays in the browser", /stays in your browser/.test($(".privacy")?.textContent ?? "") && /nothing goes to a server/.test($(".privacy")?.textContent ?? ""));
check("the page shows the init() call that it ran", ($("#config")?.textContent ?? "").includes('endpoint: "https://collector.invalid"') && ($("#config")?.textContent ?? "").includes('faroCollectorUrl: "https://collector.invalid/collect"'));

// Other options need a new init(), so a hidden frame loads the page with them
const frame = document.createElement("iframe");
frame.title = "The same page with other options";
frame.style.cssText = "position:fixed;left:-2000px;top:0;width:1280px;height:800px;border:0";
frame.src = `${location.pathname}?contextManager=stack&histogramAggregation=exponential&metricsTemporality=delta`;
document.body.append(frame);
const frameWindow = () => frame.contentWindow as Window;
const frameDocument = () => frame.contentDocument as Document;
await until(() => frameDocument().documentElement?.dataset["labReady"] === "1", SLOW);
const other = labOf(frameWindow());
check("the frame shows the options of its URL", (frameDocument().querySelector("#config")?.textContent ?? "").includes('contextManager: "stack"'));
(frameDocument().querySelector("#act-checkout") as HTMLElement).click();
const stackPricing = await until(() => spansOf(other).find((span) => span.name === "price the cart"), SLOW);
check("the stack context manager loses the parent span after a timer", stackPricing !== undefined && !stackPricing.parentSpanId, stackPricing);
const frameMetrics = await until(() => {
  const list = metricsOf(other);
  return list.find((metric) => metric.exponentialHistogram !== undefined);
}, SLOW);
check("the option exponential gives an exponential histogram", frameMetrics?.name === "demo.action.duration", metricsOf(other).map((metric) => metric.name));
const frameCounter = metricsOf(other).find((metric) => metric.name === "demo.actions");
check("the option delta gives delta temporality", frameCounter?.sum?.aggregationTemporality === 1, frameCounter?.sum?.aggregationTemporality);
check("the frame has the session ID of the tab and its own instance ID", frameDocument().querySelector("#id-session")?.textContent === $("#id-session")?.textContent && frameDocument().querySelector("#id-instance")?.textContent !== $("#id-instance")?.textContent);
frame.remove();

// Content that a card clips does not show in the width check of the page
const clipped = $$("table, .lanes, .waterfall, .trace, .stats, .actions, .options, .attrs, .bucket, .log")
  .concat($$("[data-table]"))
  .filter((element) => element.getBoundingClientRect().width > 0 && !element.hasAttribute("data-scrolls") && element.scrollWidth > element.clientWidth + 1)
  .map((element) => `${element.tagName}.${element.className} ${element.scrollWidth}>${element.clientWidth}`);
check("no table or wide view is wider than its box", clipped.length === 0, clipped);

export {};

import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectReadings, metricReadings, PullMetricReader, type PullMetricReaderOptions } from "../../src/pull.js";

const AT = Date.UTC(2026, 10, 24, 12, 0, 0);
const TIME = "2026-11-24T12:00:00.000Z";

let provider: MeterProvider | undefined;

afterEach(async () => {
  await provider?.shutdown();
  provider = undefined;
  vi.useRealTimers();
});

/** This function makes a meter provider with a pull reader, and gives the reader and a meter. */
function start(options?: PullMetricReaderOptions) {
  const reader = new PullMetricReader(options);
  provider = new MeterProvider({ readers: [reader] });
  return { reader, meter: provider.getMeter("test") };
}

/** This function gives the value of each series of a collection, as a record. */
async function values(reader: PullMetricReader, attributes?: "series" | "sum"): Promise<Record<string, number>> {
  const { readings } = await collectReadings(reader, AT, attributes === undefined ? {} : { attributes });
  return Object.fromEntries(readings.map((reading) => [reading.series, reading.value]));
}

describe("the gate of the entry /pull on the SDK", () => {
  it("gives one series for each set of attributes, in the order of the series", async () => {
    const { reader, meter } = start();
    const requests = meter.createCounter("requests");
    requests.add(2, { route: "/b", status: 200 });
    requests.add(3, { status: 200, route: "/a" });
    requests.add(1, { route: "/a", status: 200 });
    meter.createUpDownCounter("open").add(4);

    const { readings, errors } = await collectReadings(reader, AT);

    expect(errors).toBe(0);
    expect(readings).toEqual([
      { series: "open", at: TIME, value: 4 },
      { series: 'requests{route="/a",status=200}', at: TIME, value: 4 },
      { series: 'requests{route="/b",status=200}', at: TIME, value: 2 },
    ]);
  });

  it("sums a metric over its attributes with the option sum", async () => {
    const { reader, meter } = start();
    const requests = meter.createCounter("requests");
    requests.add(2, { route: "/b" });
    requests.add(3, { route: "/a" });

    expect(await values(reader, "sum")).toEqual({ requests: 5 });
  });

  it("reads the gauges and the observable instruments at each collection", async () => {
    const { reader, meter } = start();
    let rows = 7;
    meter.createObservableGauge("rows").addCallback((result) => result.observe(rows, { table: "events" }));
    meter.createGauge("depth").record(3);

    expect(await values(reader)).toEqual({ depth: 3, 'rows{table="events"}': 7 });
    rows = 9;
    expect(await values(reader)).toEqual({ depth: 3, 'rows{table="events"}': 9 });
  });

  it("gives the count and the sum of a histogram", async () => {
    const { reader, meter } = start();
    const duration = meter.createHistogram("duration");
    duration.record(10, { route: "/a" });
    duration.record(30, { route: "/a" });

    expect(await values(reader)).toEqual({ 'duration.count{route="/a"}': 2, 'duration.sum{route="/a"}': 40 });
  });

  it("keeps the totals from the start with the default cumulative temporality", async () => {
    const { reader, meter } = start();
    const requests = meter.createCounter("requests");
    requests.add(2);
    await collectReadings(reader, AT);
    requests.add(3);

    expect(await values(reader)).toEqual({ requests: 5 });
  });

  it("gives the change of a counter with the delta temporality, and keeps an up-down counter cumulative", async () => {
    const { reader, meter } = start({ temporality: "delta" });
    const requests = meter.createCounter("requests");
    const open = meter.createUpDownCounter("open");
    requests.add(2);
    open.add(2);
    expect(await values(reader)).toEqual({ requests: 2, open: 2 });
    requests.add(3);
    open.add(-1);

    expect(await values(reader)).toEqual({ requests: 3, open: 1 });
  });

  it("counts each failed callback in errors and keeps the other readings", async () => {
    const { reader, meter } = start();
    meter.createObservableGauge("broken").addCallback(() => {
      throw new Error("no read");
    });
    meter.createCounter("requests").add(1);

    const { readings, errors } = await collectReadings(reader, AT);

    expect(errors).toBe(1);
    expect(readings.map((reading) => reading.series)).toEqual(["requests"]);
  });

  it("has no timer: nothing collects between two calls of the program", async () => {
    vi.useFakeTimers();
    const { reader, meter } = start();
    const collect = vi.spyOn(reader, "collect");
    meter.createCounter("requests").add(1);

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(collect).not.toHaveBeenCalled();
    await expect(reader.forceFlush()).resolves.toBeUndefined();
  });

  it("gives no reading for a metric with no data point", async () => {
    const { reader, meter } = start();
    meter.createCounter("unused");

    expect(metricReadings((await reader.collect()).resourceMetrics, AT)).toEqual([]);
  });
});

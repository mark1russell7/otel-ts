/**
 * The entry `/pull`: the metrics of a process, read when the program asks. A {@link PullMetricReader} has no timer
 * and no export. A program collects it at the times that it chooses, for example after the start and after each pass
 * of a lab run, and {@link metricReadings} gives the value of each series at that time.
 *
 * The entry needs only `@opentelemetry/sdk-metrics`. It starts no SDK and sends nothing.
 *
 * @packageDocumentation
 */
import {
  AggregationTemporality,
  DataPointType,
  InstrumentType,
  MetricReader,
  type MetricData,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";

/**
 * The temporality of a pull reader. With `"cumulative"`, each collection gives the totals from the start. With
 * `"delta"`, the counters and the histograms give the change after the last collection, and the up-down counters
 * and the gauges stay cumulative, as with the OTLP delta preference.
 */
export type PullTemporality = "cumulative" | "delta";

/** The options of a {@link PullMetricReader}. */
export interface PullMetricReaderOptions {
  /** The temporality of each collection. The default is `"cumulative"`. */
  readonly temporality?: PullTemporality;
}

/** The instruments that the delta preference reads as a change. The others stay cumulative. */
const DELTA_INSTRUMENTS: ReadonlySet<InstrumentType> = new Set([
  InstrumentType.COUNTER,
  InstrumentType.OBSERVABLE_COUNTER,
  InstrumentType.HISTOGRAM,
]);

/**
 * A metric reader that collects only when the program asks. It has no timer and no export, and its flush and its
 * shutdown do nothing. Give it to a `MeterProvider` in `readers`, or to the SDK as a metric reader.
 *
 * ```ts no-run
 * const reader = new PullMetricReader();
 * const provider = new MeterProvider({ readers: [reader] });
 * const { readings } = await collectReadings(reader, Date.now());
 * ```
 */
export class PullMetricReader extends MetricReader {
  constructor(options: PullMetricReaderOptions = {}) {
    const delta = options.temporality === "delta";
    super({
      aggregationTemporalitySelector: (type) =>
        delta && DELTA_INSTRUMENTS.has(type) ? AggregationTemporality.DELTA : AggregationTemporality.CUMULATIVE,
    });
  }

  protected override onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected override onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** One reading of a series: its key, the UTC time of the collection and its value. */
export interface MetricReading {
  /**
   * The key of the series. It is the name of the metric, then its attributes in the order of their keys, for example
   * `http.requests{method="GET",status=200}`. With `attributes: "sum"`, it is the name only. A histogram gives the
   * series `<name>.count` and `<name>.sum`.
   */
  readonly series: string;
  /** The UTC time of the collection, in the ISO 8601 form. */
  readonly at: string;
  readonly value: number;
}

/** The options of {@link metricReadings}. */
export interface MetricReadingsOptions {
  /**
   * The series of a metric. With `"series"` (the default), each set of attributes is a series. With `"sum"`, the
   * metric is one series: the sum of its data points over all attributes.
   */
  readonly attributes?: "series" | "sum";
}

/** This function gives the key of a series: the name, then the attributes in the order of their keys. */
const seriesKey = (name: string, attributes: Readonly<Record<string, unknown>>): string => {
  const keys = Object.keys(attributes)
    .filter((key) => attributes[key] !== undefined)
    .sort();
  if (keys.length === 0) return name;
  return `${name}{${keys.map((key) => `${key}=${JSON.stringify(attributes[key])}`).join(",")}}`;
};

/** This function gives the named values of each data point of a metric, with the attributes of the point. */
const pointValues = (metric: MetricData): { attributes: Readonly<Record<string, unknown>>; values: [string, number][] }[] => {
  const name = metric.descriptor.name;
  switch (metric.dataPointType) {
    case DataPointType.SUM:
    case DataPointType.GAUGE:
      return metric.dataPoints.map((point) => ({ attributes: point.attributes, values: [[name, point.value]] }));
    case DataPointType.HISTOGRAM:
    case DataPointType.EXPONENTIAL_HISTOGRAM:
      return metric.dataPoints.map((point) => ({
        attributes: point.attributes,
        values: [[`${name}.count`, point.value.count], ...(point.value.sum === undefined ? [] : ([[`${name}.sum`, point.value.sum]] as [string, number][]))],
      }));
  }
};

/**
 * This function gives the readings of one collection at the time `at`, in ms from the epoch. Each sum and each gauge
 * gives one reading for each series. Each histogram gives its count and its sum. The readings are in the order of
 * their series.
 */
export function metricReadings(metrics: ResourceMetrics, at: number, options: MetricReadingsOptions = {}): MetricReading[] {
  const time = new Date(at).toISOString();
  const sum = options.attributes === "sum";
  const values = new Map<string, number>();
  for (const scope of metrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      for (const point of pointValues(metric)) {
        for (const [name, value] of point.values) {
          const series = sum ? name : seriesKey(name, point.attributes);
          values.set(series, (values.get(series) ?? 0) + value);
        }
      }
    }
  }
  return [...values.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((series) => ({ series, at: time, value: values.get(series) ?? 0 }));
}

/** The result of one collection: the readings, and the count of the errors of the callbacks. */
export interface ReadingsCollection {
  readonly readings: readonly MetricReading[];
  readonly errors: number;
}

/** This function collects the reader and gives the readings at the time `at`. Each failed callback adds 1 to `errors`. */
export async function collectReadings(reader: MetricReader, at: number, options: MetricReadingsOptions = {}): Promise<ReadingsCollection> {
  const result = await reader.collect();
  return { readings: metricReadings(result.resourceMetrics, at, options), errors: result.errors.length };
}

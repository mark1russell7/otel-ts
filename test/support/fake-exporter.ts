import { ExportResultCode, type ExportResult } from "@opentelemetry/core";

/**
 * Stands in for an OTLP HTTP exporter: keeps its options and every batch it
 * was asked to export, sends nothing.
 */
export class FakeExporter {
  /** Every instance created so far; tests that read it clear it */
  static readonly instances: FakeExporter[] = [];

  readonly options: unknown;
  readonly exported: unknown[] = [];

  constructor(options?: unknown) {
    this.options = options;
    FakeExporter.instances.push(this);
  }

  export(items: unknown, resultCallback: (result: ExportResult) => void): void {
    this.exported.push(items);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Everything the fake exporters for `path` were asked to export: spans or
 * log records (flattened from their batches), or ResourceMetrics.
 */
export function exportedTo<T>(
  path: "/v1/traces" | "/v1/metrics" | "/v1/logs",
): T[] {
  return FakeExporter.instances
    .filter((exporter) =>
      (exporter.options as { url?: string } | undefined)?.url?.endsWith(path),
    )
    .flatMap((exporter) => exporter.exported.flat() as T[]);
}

import { ExportResultCode, type ExportResult } from "@opentelemetry/core";

/** Stands in for an OTLP HTTP exporter: keeps its options, sends nothing. */
export class FakeExporter {
  readonly options: unknown;

  constructor(options?: unknown) {
    this.options = options;
  }

  export(_items: unknown, resultCallback: (result: ExportResult) => void): void {
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

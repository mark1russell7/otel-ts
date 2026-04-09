import {
  initializeFaro,
  getWebInstrumentations,
  type Faro,
} from "@grafana/faro-web-sdk";
import { TracingInstrumentation } from "@grafana/faro-web-tracing";
import type { ResolvedConfig } from "./types.js";

export function setupFaro(config: ResolvedConfig): Faro {
  return initializeFaro({
    app: {
      name: config.faroAppName ?? config.serviceName,
      version: config.serviceVersion,
    },
    instrumentations: [
      ...getWebInstrumentations({
        captureConsole: true,
        enablePerformanceInstrumentation: true,
        enableContentSecurityPolicyInstrumentation: true,
      }),
      new TracingInstrumentation(),
    ],
    ...(config.faroCollectorUrl ? { url: config.faroCollectorUrl } : {}),
  });
}

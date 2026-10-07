import {
  initializeFaro,
  getWebInstrumentations,
  type Faro,
} from "@grafana/faro-web-sdk";
import { TracingInstrumentation } from "@grafana/faro-web-tracing";
import type { ResolvedConfig } from "./types.js";

/**
 * Starts Faro, sending to `url`. Without a URL (or transports) Faro has
 * nowhere to send data and logs an error, so `init()` skips it then.
 */
export function setupFaro(config: ResolvedConfig, url: string): Faro {
  return initializeFaro({
    url,
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
  });
}

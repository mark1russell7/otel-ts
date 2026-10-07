import { type Faro } from "@grafana/faro-web-sdk";
import type { ResolvedConfig } from "./types.js";
/**
 * Starts Faro, sending to `url`. Without a URL (or transports) Faro has
 * nowhere to send data and logs an error, so `init()` skips it then.
 */
export declare function setupFaro(config: ResolvedConfig, url: string): Faro;
//# sourceMappingURL=faro.d.ts.map
import type { ResolvedConfig } from "./types.js";
/**
 * The resource shared by the metrics, logs and traces providers. It holds no
 * `session.id`: that is set on each log record and span instead (see
 * session-processors.ts), because the resource can't follow a session
 * rotation and on metrics it would inflate `target_info`.
 */
export declare function buildResource(config: ResolvedConfig): import("@opentelemetry/resources").Resource;
//# sourceMappingURL=resource.d.ts.map
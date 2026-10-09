import type { AttributeValue } from "@opentelemetry/api";
import type { ResolvedConfig } from "./types.js";
/** The parts of `navigator` that the browser attributes use, in a page or a worker */
interface NavigatorLike {
    userAgent?: string;
    language?: string;
    userAgentData?: {
        brands?: ReadonlyArray<{
            brand: string;
            version: string;
        }>;
        mobile?: boolean;
        platform?: string;
    };
}
/**
 * The browser attributes of the OpenTelemetry semantic conventions, from
 * `navigator`: `browser.brands`, `browser.platform` and `browser.mobile`
 * (User-Agent Client Hints, only Chromium has them), `browser.language` and
 * `user_agent.original`. A page and a worker both have `navigator`; where
 * there is none (Node.js), there are no attributes. The `browser.*` names are
 * in the incubating conventions, thus they are written here and not imported.
 */
export declare function browserAttributes(nav: NavigatorLike | undefined): Record<string, AttributeValue>;
/**
 * The resource shared by the metrics, logs and traces providers. It holds no
 * `session.id`: that is set on each log record and span instead (see
 * session-processors.ts), because the resource can't follow a session
 * rotation and on metrics it would inflate `target_info`.
 *
 * With `browserAttributes` (the default), it has the browser attributes of
 * the semantic conventions (see `browserAttributes()`), from the global `navigator`. They do not change
 * during the life of a page, thus they fit the resource. The attributes of
 * the config have priority over them.
 */
export declare function buildResource(config: ResolvedConfig): import("@opentelemetry/resources").Resource;
export {};
//# sourceMappingURL=resource.d.ts.map
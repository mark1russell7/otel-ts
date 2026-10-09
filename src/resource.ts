import { resourceFromAttributes } from "@opentelemetry/resources";
import type { AttributeValue } from "@opentelemetry/api";
import {
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_USER_AGENT_ORIGINAL,
} from "@opentelemetry/semantic-conventions";
import type { ResolvedConfig } from "./types.js";

/** The parts of `navigator` that the browser attributes use, in a page or a worker */
interface NavigatorLike {
  userAgent?: string;
  language?: string;
  userAgentData?: {
    brands?: ReadonlyArray<{ brand: string; version: string }>;
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
export function browserAttributes(
  nav: NavigatorLike | undefined,
): Record<string, AttributeValue> {
  if (!nav) return {};
  const attributes: Record<string, AttributeValue> = {};
  const hints = nav.userAgentData;
  if (hints?.brands && hints.brands.length > 0) {
    attributes["browser.brands"] = hints.brands.map(({ brand, version }) => `${brand} ${version}`);
  }
  if (typeof hints?.platform === "string" && hints.platform !== "") {
    attributes["browser.platform"] = hints.platform;
  }
  if (typeof hints?.mobile === "boolean") attributes["browser.mobile"] = hints.mobile;
  if (typeof nav.language === "string" && nav.language !== "") {
    attributes["browser.language"] = nav.language;
  }
  if (typeof nav.userAgent === "string" && nav.userAgent !== "") {
    attributes[ATTR_USER_AGENT_ORIGINAL] = nav.userAgent;
  }
  return attributes;
}

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
export function buildResource(config: ResolvedConfig) {
  return resourceFromAttributes({
    ...(config.browserAttributes
      ? browserAttributes((globalThis as { navigator?: NavigatorLike }).navigator)
      : {}),
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    [ATTR_SERVICE_INSTANCE_ID]: config.serviceInstanceId,
    ...config.resourceAttributes,
  });
}

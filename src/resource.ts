import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type { ResolvedConfig } from "./types.js";

export function buildResource(config: ResolvedConfig, sessionId: string) {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    ...(config.serviceInstanceId
      ? { [ATTR_SERVICE_INSTANCE_ID]: config.serviceInstanceId }
      : {}),
    "session.id": sessionId,
    ...config.resourceAttributes,
  });
}

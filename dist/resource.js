import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, } from "@opentelemetry/semantic-conventions";
export function buildResource(config, sessionId) {
    return resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.serviceName,
        [ATTR_SERVICE_VERSION]: config.serviceVersion,
        "session.id": sessionId,
        ...config.resourceAttributes,
    });
}
//# sourceMappingURL=resource.js.map
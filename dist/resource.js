import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_INSTANCE_ID, ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, } from "@opentelemetry/semantic-conventions";
/**
 * The resource shared by the metrics, logs and traces providers. It holds no
 * `session.id`: that is set on each log record and span instead (see
 * session-processors.ts), because the resource can't follow a session
 * rotation and on metrics it would inflate `target_info`.
 */
export function buildResource(config) {
    return resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.serviceName,
        [ATTR_SERVICE_VERSION]: config.serviceVersion,
        [ATTR_SERVICE_INSTANCE_ID]: config.serviceInstanceId,
        ...config.resourceAttributes,
    });
}
//# sourceMappingURL=resource.js.map
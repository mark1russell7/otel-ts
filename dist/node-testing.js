/**
 * `@mark1russell7/otel-ts/node/testing`: a stand-in OTLP collector for the CI
 * check of a Node service. A change of the load order (for example a move to
 * ES modules) breaks the instrumentations without an error: the service
 * operates, and some spans are not there. A check starts the service with
 * `OTEL_EXPORTER_OTLP_ENDPOINT` set to `collector.endpoint`, sends requests,
 * and waits until each instrumentation that it expects has spans.
 *
 * The collector reads OTLP/HTTP JSON, the default of
 * `@opentelemetry/exporter-trace-otlp-http`.
 *
 * @packageDocumentation
 */
import { createServer } from "node:http";
/** Start a stand-in OTLP/HTTP collector on a free port of 127.0.0.1 */
export async function startStubCollector() {
    const seen = new Map();
    let exports = 0;
    const server = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
        });
        req.on("end", () => {
            if (req.url === "/v1/traces") {
                exports++;
                try {
                    const parsed = JSON.parse(body);
                    for (const rs of parsed.resourceSpans ?? []) {
                        for (const ss of rs.scopeSpans ?? []) {
                            const scope = ss.scope?.name ?? "?";
                            const names = seen.get(scope) ?? new Set();
                            for (const span of ss.spans ?? [])
                                names.add(span.name ?? "?");
                            seen.set(scope, names);
                        }
                    }
                }
                catch {
                    // an export that is not JSON (protobuf): the check expects JSON
                }
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const missing = (scopes) => scopes.filter((s) => !(seen.get(s)?.size));
    return {
        endpoint: `http://127.0.0.1:${port}`,
        get exports() {
            return exports;
        },
        spansByScope: () => seen,
        has: (scopes) => missing(scopes).length === 0,
        missing,
        async waitFor(scopes, options = {}) {
            const until = Date.now() + (options.timeoutMs ?? 20_000);
            while (Date.now() < until) {
                await options.poke?.().catch(() => undefined);
                if (missing(scopes).length === 0)
                    return [];
                await new Promise((r) => setTimeout(r, options.intervalMs ?? 500));
            }
            return missing(scopes);
        },
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
//# sourceMappingURL=node-testing.js.map
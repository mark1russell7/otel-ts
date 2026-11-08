# Roadmap

This file is the plan of otel-ts. The Status page of the site reads it. The design of the items from C1 is in [CONTEXT-DESIGN.md](CONTEXT-DESIGN.md).

| ID | Item | Status | Priority | Summary |
| --- | --- | --- | --- | --- |
| O1 | The site with a live lab | done | P2 | The site at GitHub Pages starts the real `init()` in the browser. A stub in the page catches each OTLP export, and the page shows it in a waterfall and on a wire. |
| O2 | Faro in the lab | later | P3 | Faro stays off in the lab, because its tracing adds a second copy of each fetch span. A later lab can show a Faro lane with no second copy. |
| C1 | The design of one context, and the talk | active | P1 | The design doc, then the decisions D1 to D5 with the strategist and Mark. The build starts after the talk. |
| C2 | The entry `/context` | later | P1 | `defineContextKeys`, `withContext`, `contextValue` and `withInternalCall`, on `@opentelemetry/api` only. Needs C1. |
| C3 | The processors of the context keys | later | P1 | Copy each named key of the baggage to each span and log record. A metric view removes each key of high cardinality. The `session.id` processors become a case of them. Needs C2. |
| C4 | The propagator: baggage on internal calls only | later | P1 | W3C trace context on each call, baggage only with the internal mark, the W3C limits, and one registration only. Needs C2. |
| C5 | `/node` registers the context also with export off | later | P1 | AsyncLocalStorage, the propagator of C4 and the processors of C3, with or without a collector. Needs C3 and C4. |
| C6 | The browser entries use the same parts | later | P1 | `init()` registers the propagator of C4 and the processors of C3. Needs C3 and C4. |
| C7 | The propagation gate | later | P1 | A test helper of rigor: in-memory exporters, one id from client to server to logs, metrics and traces, a flip test, and "no read" lines. Needs C2. |
| C8 | `@procedures/client` sends the context | later | P1 | The API propagator on local, HTTP, WebSocket and port calls, the internal mark, spans of the API. Its own W3C code goes. A pull request to client, with its owner. Needs C4 and C7. |
| C9 | Local storage for services | later | P2 | grafana-infra: OTLP from Node services, a link from each log line to its trace, the span metrics of Tempo, tail sampling. The home cluster waits on its talk. Needs C5. |
| C10 | `@procedures/peer` runs each handler in the context of its caller | later | P1 | Extract after the token check, then run the handler in that context, on HTTP, WebSocket and MCP (`_meta`). The CLI carrier (`TRACEPARENT`, `BAGGAGE`). A pull request to client. Needs C8. |
| C11 | `@mark1russell7/service` logs carry the ids | later | P1 | `trace_id` and `span_id` on each log line, and its HTTP and gRPC parts read and send the context. A pull request to systems, with its owner. Needs C4 and C7. |
| C12 | The gate is green on each transport in CI | later | P1 | client and systems run the gate of C7 on each transport, as a required check. Needs C8, C10 and C11. |
| C13 | The inherited repositories | later | P2 | AsyncBrowserContext, lag and grafana-infra: green CI, the checks CI OK and Security OK, and no open alert. |
| C14 | KPI milestones | later | P2 | 2 to 5 measured milestones on the KPI page, for example the count of transports on which the gate is green. |
| C16 | Exemplars from the SDK | later | P3 | The JS metrics SDK records no exemplars today (2.6.1 and 2.12.0). When an aggregator records them, turn them on, so a metric point carries its trace id, and the gate reads one. Until then, the span metrics of Tempo give the link (C9). Needs C3. |
| C15 | One OpenTelemetry core for lag and otel-ts | later | P3 | lag keeps its own OpenTelemetry types, on purpose (review 2026-10-25, F7). Decide if they move to one home. |

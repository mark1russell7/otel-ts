import { createServer } from "node:net";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { embeddedProcess, lint, localDev } from "@mark1russell7/service";
import type { Rule, Scenario } from "@mark1russell7/service";
import { describe, expect, it } from "vitest";
import { logs, metrics, traceId, traces } from "./fixtures.test-util.ts";
import { MAX_BODY_BYTES, PROFILES, declare } from "./index.ts";

const s = (value: number) => ({ value, unit: "s" });

// The caller of lint() gives the rules of the ordering law, as data. These are the drain rules O10 and O16, as @mark1russell7/kind gives them.
const O10: Rule = {
  id: "O10",
  rule: "the preStop sleep plus the shutdown of the process fits in the grace period",
  expr: {
    lhs: {
      terms: [
        { knob: "prestop_sleep", coef: 1, at: "pod" },
        { knob: "process_drain_time", coef: 1, at: "process" },
      ],
    },
    op: "<=",
    rhs: { terms: [{ knob: "termination_grace", coef: 1, at: "pod" }] },
  },
};
const O16: Rule = {
  id: "O16",
  rule: "the cooperative window is shorter than the drain, which is shorter than the grace less the preStop sleep",
  expr: {
    lhs: { terms: [{ knob: "cooperative_window", coef: 1, at: "process" }] },
    op: "<",
    rhs: { terms: [{ knob: "process_drain_time", coef: 1, at: "process" }] },
  },
  expr_more: [
    {
      lhs: { terms: [{ knob: "process_drain_time", coef: 1, at: "process" }] },
      op: "<",
      rhs: {
        terms: [
          { knob: "termination_grace", coef: 1, at: "pod" },
          { knob: "prestop_sleep", coef: -1, at: "pod" },
        ],
      },
    },
  ],
};

// A pod with the default grace of Kubernetes (30 s) and no preStop hook
const POD: Scenario = {
  platform: { "termination_grace@pod": s(30), "prestop_sleep@pod": s(0) },
  probes: { readiness: s(30), liveness: s(30) },
};

/** This function gives a free TCP port of the loopback interface. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

describe("the declaration of the service", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    it(`passes describe() and lint() with the profile ${name}`, () => {
      // describe() throws when the declaration lacks a policy, the startup budget, the phases or the effect of a second signal
      const description = declare({ port: 0, probePort: 0, profile, path: ":memory:" }).describe();
      expect(description.transports.map((transport) => [transport.kind, transport.name])).toEqual([
        ["server", "http"],
        ["worker", "retention"],
      ]);
      // each rule holds, and no field of the declaration is missing (a "depends" finding of the rule "declaration")
      const findings = lint(description, POD, [O10, O16]);
      expect(findings.map((finding) => [finding.rule, finding.verdict])).toEqual([
        ["O10", "holds"],
        ["O16", "holds"],
        // the bound of a prune and the close bound of the retention worker, against the caps of the phases (BOUND_RULES)
        ["unit-bound", "holds"],
        ["close-bound", "holds"],
      ]);
    });
  }
});

describe("the lifecycle of the service", () => {
  it("takes OTLP JSON, answers the queries and the probes, and exits 0 after the shutdown", async () => {
    const port = await freePort();
    const probePort = await freePort();
    const now = Date.UTC(2026, 10, 26, 12);
    // embeddedProcess() adds no signal handler and does not end the process of the test
    const life = await declare({ port, probePort, profile: localDev, path: ":memory:", now: () => now }).run({ process: embeddedProcess() });
    const url = (path: string) => `http://127.0.0.1:${port}${path}`;
    const post = (path: string, body: string | Uint8Array, headers: Record<string, string> = { "content-type": "application/json" }) =>
      fetch(url(path), { method: "POST", headers, body });
    try {
      const spans = traces([
        { trace: 1, span: 1, startMs: now - 1000, durationMs: 250, name: "GET /slow" },
        { trace: 1, span: 2, parent: 1, startMs: now - 990, durationMs: 40, error: true, name: "SELECT" },
      ]);
      const sent = await post("/v1/traces", JSON.stringify(spans));
      expect(sent.status).toBe(200);
      expect(await sent.json()).toEqual({});
      const zipped = await post("/v1/logs", gzipSync(JSON.stringify(logs([{ timeMs: now - 980, severity: 17, body: "the query failed", trace: 1 }]))), {
        "content-type": "application/json; charset=utf-8",
        "content-encoding": "gzip",
      });
      expect(zipped.status).toBe(200);
      expect((await post("/v1/metrics", JSON.stringify(metrics(now)))).status).toBe(200);

      const slow = (await (await fetch(url("/api/slowest?limit=1"))).json()) as { name: string; durationMs: number }[];
      expect(slow.map((span) => [span.name, span.durationMs])).toEqual([["GET /slow", 250]]);
      const failed = (await (await fetch(url("/api/errors"))).json()) as { spans: { name: string }[]; logs: { body: string }[] };
      expect([failed.spans.map((span) => span.name), failed.logs.map((log) => log.body)]).toEqual([["SELECT"], ["the query failed"]]);
      const one = (await (await fetch(url(`/api/trace?id=${traceId(1)}`))).json()) as { spans: unknown[]; logs: unknown[] };
      expect([one.spans.length, one.logs.length]).toEqual([2, 1]);
      const stats = (await (await fetch(url("/api/stats"))).json()) as { sizes: Record<string, { rows: number }> };
      expect(Object.fromEntries(Object.entries(stats.sizes).map(([signal, size]) => [signal, size.rows]))).toEqual({ spans: 2, logs: 1, points: 2 });
      expect((await (await fetch(url("/api/services"))).json()) as unknown[]).toHaveLength(1);

      // the refusals: a type that is not JSON, a body past the limit, a body that is not OTLP, and bad parameters
      const proto = await post("/v1/traces", new Uint8Array([1, 2, 3]), { "content-type": "application/x-protobuf" });
      expect(proto.status).toBe(415);
      expect(((await proto.json()) as { error: string }).error).toMatch(/OTEL_EXPORTER_OTLP_PROTOCOL=http\/json/);
      expect((await post("/v1/traces", new Uint8Array(MAX_BODY_BYTES + 1))).status).toBe(413);
      expect((await post("/v1/traces", "{")).status).toBe(400);
      expect((await post("/v1/traces", JSON.stringify({ resourceSpans: 7 }))).status).toBe(400);
      expect((await fetch(url("/api/slowest?limit=0"))).status).toBe(400);
      expect((await fetch(url("/api/trace?id=nothex"))).status).toBe(400);
      expect((await fetch(url("/nothing"))).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${probePort}/readiness`)).status).toBe(200);
    } finally {
      await life.shutdown("the test ended");
    }
    expect(await life.done).toBe(0);
    expect(life.errors).toEqual([]);
  });
});

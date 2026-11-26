import { describe, expect, it } from "vitest";
import { jobRounds, memoryRead } from "../../bench/memory-gate.ts";

const MIB = 1024 * 1024;

interface Child {
  readonly arm: string;
  readonly round: number;
  readonly rss: number;
  readonly heap: number;
}

/** Made-up children of one job: the bytes that each arm adds over the baseline, with a small noise from the round. */
function children(added: Readonly<Record<"context" | "node", { rss: number; heap: number }>>, rounds = 10, shift = 0): Child[] {
  const out: Child[] = [];
  for (let round = 0; round < rounds; round++) {
    const noise = ((round * 7 + shift) % 5) * 20_000;
    const base = { rss: 60 * MIB + noise, heap: 4 * MIB + noise / 10 };
    out.push({ arm: "api-a", round, ...base });
    out.push({ arm: "api-b", round, rss: base.rss + 10_000, heap: base.heap + 1_000 });
    for (const arm of ["context-a", "context-b"]) out.push({ arm, round, rss: base.rss + added.context.rss, heap: base.heap + added.context.heap });
    out.push({ arm: "node", round, rss: base.rss + added.node.rss, heap: base.heap + added.node.heap });
  }
  return out;
}

const LIGHT = { context: { rss: 6 * MIB, heap: 1 * MIB }, node: { rss: 32 * MIB, heap: 8 * MIB } };
const jobs = (count: number, added = LIGHT) => Array.from({ length: count }, (_, i) => ({ job: String(i + 1), children: children(added, 10, i) }));
const LIMITS = { rss: { limit: 8 * MIB, maxDifference: 1 * MIB }, heap: { limit: 2 * MIB, maxDifference: 1 * MIB } };

describe("the memory gate of /node/context", () => {
  it("gives each case the measure of one arm over one api arm, in each round", () => {
    const rounds = jobRounds(children(LIGHT, 2));
    expect(rounds.get("context rss")?.rounds.map((r: { value: number }) => r.value)).toEqual([6 * MIB, 6 * MIB]);
    expect(rounds.get("context rss")?.aa.map((r: { value: number }) => r.value)).toEqual([6 * MIB - 10_000, 6 * MIB - 10_000]);
    expect(rounds.get("node rss")?.rounds.map((r: { value: number }) => r.value)).toEqual([32 * MIB, 32 * MIB]);
  });

  it("refuses a round with no child of an arm, and a child that comes twice", () => {
    const some = children(LIGHT, 2);
    expect(() => jobRounds(some.filter((child) => !(child.arm === "node" && child.round === 1)))).toThrow(/round 1 has no child of the arm "node"/);
    expect(() => jobRounds([...some, some[0]!])).toThrow(/comes twice in round 0/);
  });

  it("only reports without limits, and gives the limits of 5 jobs: the worst high end plus the spread", () => {
    const read = memoryRead(jobs(5), undefined);
    expect(read.gate).toBeUndefined();
    const highs = read.reads.map((r) => r.cases.find((c) => c.case === "context rss")!.high);
    expect(read.derived.rss?.limit.limit).toBe(Math.max(...highs) + (Math.max(...highs) - Math.min(...highs)));
    expect(memoryRead(jobs(4), undefined).derived.rss).toBeUndefined();
  });

  it("passes when the light entry is within the limits and the full entry is beyond them", () => {
    const read = memoryRead(jobs(5), LIMITS);
    expect(read.gate?.outcome).toBe("pass");
  });

  it("blocks when the light entry is beyond the limit", () => {
    const heavy = { ...LIGHT, context: { rss: 12 * MIB, heap: 1 * MIB } };
    expect(memoryRead(jobs(5, heavy), LIMITS).gate?.outcome).toBe("block");
  });

  it("has no read when the gate cannot tell the full entry from the light entry, or with fewer than 5 jobs", () => {
    const same = { ...LIGHT, node: LIGHT.context };
    expect(memoryRead(jobs(5, same), LIMITS).gate?.outcome).toBe("no read");
    expect(memoryRead(jobs(4), LIMITS).gate?.outcome).toBe("no read");
  });
});

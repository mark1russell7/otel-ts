/**
 * The read of the memory gate: the bytes that the entry `/node/context` adds to a process with only `@opentelemetry/api`.
 *
 * Each job of CI starts one fresh child for each arm in each round (`bench/memory.ts`). The arms are `api-a` and `api-b`
 * (the A/A pair of the baseline), `context-a` and `context-b`, and `node`. In each round, the value of a case is the
 * measure of one arm minus the measure of one `api` arm:
 *
 * - `context rss` and `context heap`: `context-a` minus `api-a`, and the A/A arm `context-b` minus `api-b`.
 * - `node rss`: `node` minus `api-a`, and the A/A arm `node` minus `api-b`. The gate must see this case beyond the limit
 *   of `context rss`. Else the gate cannot tell the two entries apart, and it has no read.
 *
 * A value below 0 becomes 0. For a claim "at most the limit", this change can only make a pass harder.
 */
import { budgetVerdict, gateOf, runLimit, type BudgetRound, type CaseBudget, type Gate, type GateCaseOutcome, type RunLimit } from "@mark1russell7/rigor-bench";

/** A measure of a child: the resident set or the live heap after a full GC, in bytes. */
export type Measure = "rss" | "heap";

/** The id of an arm of a job. */
export type ArmId = "api-a" | "api-b" | "context-a" | "context-b" | "node";

/** The case of a child: the entry that it loads. */
export type ChildCase = "api" | "context" | "node";

/** The name of a case of the gate. */
export type GateCase = "context rss" | "context heap" | "node rss";

/** One arm of a job: its id and the case of its child. */
export interface MemoryArm {
  readonly id: ArmId;
  readonly case: ChildCase;
}

/** One case of the gate: one measure of one arm over one `api` arm, and the same for the A/A pair. */
export interface MemoryCase {
  readonly case: GateCase;
  readonly measure: Measure;
  readonly arm: readonly [ArmId, ArmId];
  readonly aa: readonly [ArmId, ArmId];
}

/** The record of one child: its arm, its round and its two measures in bytes. */
export interface MemoryChild {
  readonly arm: string;
  readonly round: number;
  readonly rss: number;
  readonly heap: number;
}

/** The children of one job of CI. */
export interface MemoryJob {
  readonly job: string;
  readonly children: readonly MemoryChild[];
}

/** The budget rounds of one case of one job, and the rounds of its A/A pair. */
export interface CaseRounds {
  readonly rounds: BudgetRound[];
  readonly aa: BudgetRound[];
}

/** The limit of one measure, in bytes, and the largest A/A difference that the measure allows. */
export interface MeasureLimit {
  readonly limit: number;
  readonly maxDifference: number;
}

/** The limits of the gate. */
export type MemoryLimits = Readonly<Record<Measure, MeasureLimit>>;

/** The budget verdict of one case of one job. */
export type CaseRead = Omit<CaseBudget, "case"> & { readonly case: GateCase };

/** The read of one job. */
export interface JobRead {
  readonly job: string;
  readonly cases: readonly CaseRead[];
}

/** The limits that 5 jobs or more give for one measure. */
export interface DerivedLimit {
  readonly limit: RunLimit;
  readonly maxDifference: RunLimit;
}

/** The read of the gate over the jobs. `gate` is `undefined` when the read has no limits. */
export interface MemoryRead {
  readonly reads: readonly JobRead[];
  readonly derived: Readonly<Record<Measure, DerivedLimit | undefined>>;
  readonly gate: Gate | undefined;
}

/** The arms of a job, in the order of the first round. */
export const ARMS: readonly MemoryArm[] = [
  { id: "api-a", case: "api" },
  { id: "api-b", case: "api" },
  { id: "context-a", case: "context" },
  { id: "context-b", case: "context" },
  { id: "node", case: "node" },
];

/** The fewest jobs of a gate read: the limit of a gate comes from 5 or more runs. */
export const MIN_JOBS = 5;

/** The measures of a child. */
const MEASURES: readonly Measure[] = ["rss", "heap"];

/** The cases of the gate: each case is one measure of one arm over one `api` arm. */
export const CASES: readonly MemoryCase[] = [
  { case: "context rss", measure: "rss", arm: ["context-a", "api-a"], aa: ["context-b", "api-b"] },
  { case: "context heap", measure: "heap", arm: ["context-a", "api-a"], aa: ["context-b", "api-b"] },
  { case: "node rss", measure: "rss", arm: ["node", "api-a"], aa: ["node", "api-b"] },
];

/**
 * This function gives the budget rounds of each case of one job from the records of its children.
 *
 * @throws {RangeError} when a round does not have each arm once, or a measure is not a finite number.
 */
export function jobRounds(children: readonly MemoryChild[]): Map<GateCase, CaseRounds> {
  const byRound = new Map<number, Map<string, MemoryChild>>();
  for (const child of children) {
    for (const measure of MEASURES) {
      if (!Number.isFinite(child[measure])) throw new RangeError(`jobRounds: the ${measure} of the arm ${JSON.stringify(child.arm)} in round ${child.round} is not a finite number.`);
    }
    const arms = byRound.get(child.round) ?? new Map<string, MemoryChild>();
    if (arms.has(child.arm)) throw new RangeError(`jobRounds: the arm ${JSON.stringify(child.arm)} comes twice in round ${child.round}.`);
    byRound.set(child.round, arms.set(child.arm, child));
  }
  const out = new Map<GateCase, CaseRounds>(CASES.map((item) => [item.case, { rounds: [], aa: [] }]));
  for (const [round, arms] of byRound) {
    const armOf = (id: ArmId): MemoryChild => {
      const child = arms.get(id);
      if (child === undefined) throw new RangeError(`jobRounds: round ${round} has no child of the arm ${JSON.stringify(id)}.`);
      return child;
    };
    for (const arm of ARMS) armOf(arm.id);
    for (const item of CASES) {
      const value = ([top, base]: readonly [ArmId, ArmId]): number => Math.max(0, armOf(top)[item.measure] - armOf(base)[item.measure]);
      const rounds = caseRoundsOf(out, item.case);
      rounds.rounds.push({ case: item.case, round, value: value(item.arm) });
      rounds.aa.push({ case: item.case, round, value: value(item.aa) });
    }
  }
  return out;
}

/** This function gives the rounds of one case. Each case of `CASES` has its rounds, so a missing case is a bug. */
function caseRoundsOf(rounds: ReadonlyMap<GateCase, CaseRounds>, name: GateCase): CaseRounds {
  const found = rounds.get(name);
  if (found === undefined) throw new Error(`memory gate: the case ${JSON.stringify(name)} has no rounds.`);
  return found;
}

/**
 * This function gives the read of the gate over the jobs.
 *
 * - Without `limits`, the read only reports. With 5 jobs or more, it gives the limits that the jobs give: for each
 *   measure, the worst high end of the interval of the median plus the spread, and the same for the A/A difference.
 * - With `limits`, each case of each job gets a budget verdict. The case `node rss` uses the limit of `context rss`, and
 *   it must be beyond it. Fewer than 5 jobs give no read.
 */
export function memoryRead(jobs: readonly MemoryJob[], limits: MemoryLimits | undefined): MemoryRead {
  const reads: JobRead[] = jobs.map(({ job, children }) => {
    const rounds = jobRounds(children);
    const cases = CASES.map((item): CaseRead => {
      const options = limits?.[item.measure] ?? { limit: Number.MAX_SAFE_INTEGER, maxDifference: Number.MAX_SAFE_INTEGER };
      const { rounds: values, aa } = caseRoundsOf(rounds, item.case);
      const first = budgetVerdict(values, aa, options).cases[0];
      if (first === undefined) throw new Error(`memory gate: the budget verdict of ${JSON.stringify(item.case)} has no case.`);
      return { ...first, case: item.case };
    });
    return { job, cases };
  });
  const enough = jobs.length >= MIN_JOBS;
  const derivedOf = (measure: Measure): DerivedLimit | undefined => {
    if (!enough) return undefined;
    const name = `context ${measure}`;
    const of = reads.map((read) => {
      const found = read.cases.find((item) => item.case === name);
      if (found === undefined) throw new Error(`memory gate: the job ${read.job} has no case ${JSON.stringify(name)}.`);
      return found;
    });
    return {
      limit: runLimit(of.map((item) => item.high), { digits: 0 }),
      maxDifference: runLimit(of.map((item) => item.difference ?? Number.NaN), { digits: 0 }),
    };
  };
  const derived = { rss: derivedOf("rss"), heap: derivedOf("heap") };
  if (limits === undefined) return { reads, derived, gate: undefined };
  const outcomes: GateCaseOutcome[] = [];
  for (const read of reads) {
    for (const item of read.cases) {
      const name = `${item.case}, job ${read.job}`;
      if (item.case === "node rss") outcomes.push({ case: name, outcome: item.outcome === "beyond" ? "within" : "cannot decide" });
      else outcomes.push({ case: name, outcome: enough ? item.outcome : "cannot decide" });
    }
  }
  if (!enough) outcomes.push({ case: `${MIN_JOBS} jobs or more`, outcome: "cannot decide" });
  return { reads, derived, gate: gateOf(outcomes) };
}

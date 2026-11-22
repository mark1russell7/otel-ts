/**
 * The read of the memory gate: the bytes that the entry `/node/context` adds to a process with only `@opentelemetry/api`.
 *
 * Each job of CI starts one fresh child for each arm in each round (`bench/memory.mjs`). The arms are `api-a` and `api-b`
 * (the A/A pair of the baseline), `context-a` and `context-b`, and `node`. In each round, the value of a case is the
 * measure of one arm minus the measure of one `api` arm:
 *
 * - `context rss` and `context heap`: `context-a` minus `api-a`, and the A/A arm `context-b` minus `api-b`.
 * - `node rss`: `node` minus `api-a`, and the A/A arm `node` minus `api-b`. The gate must see this case beyond the limit
 *   of `context rss`. Else the gate cannot tell the two entries apart, and it has no read.
 *
 * A value below 0 becomes 0. For a claim "at most the limit", this change can only make a pass harder.
 */
import { budgetVerdict, gateOf, runLimit } from "@mark1russell7/rigor-bench";

/** The arms of a job, in the order of the first round. */
export const ARMS = [
  { id: "api-a", case: "api" },
  { id: "api-b", case: "api" },
  { id: "context-a", case: "context" },
  { id: "context-b", case: "context" },
  { id: "node", case: "node" },
];

/** The fewest jobs of a gate read: the limit of a gate comes from 5 or more runs. */
export const MIN_JOBS = 5;

/** The cases of the gate: each case is one measure of one arm over one `api` arm. */
export const CASES = [
  { case: "context rss", measure: "rss", arm: ["context-a", "api-a"], aa: ["context-b", "api-b"] },
  { case: "context heap", measure: "heap", arm: ["context-a", "api-a"], aa: ["context-b", "api-b"] },
  { case: "node rss", measure: "rss", arm: ["node", "api-a"], aa: ["node", "api-b"] },
];

/**
 * This function gives the budget rounds of each case of one job from the records of its children.
 *
 * @param {readonly { arm: string; round: number; rss: number; heap: number }[]} children
 * @returns {Map<string, { rounds: { case: string; round: number; value: number }[]; aa: { case: string; round: number; value: number }[] }>}
 * @throws {RangeError} when a round does not have each arm once, or a measure is not a finite number.
 */
export function jobRounds(children) {
  const byRound = new Map();
  for (const child of children) {
    for (const measure of ["rss", "heap"]) {
      if (!Number.isFinite(child[measure])) throw new RangeError(`jobRounds: the ${measure} of the arm ${JSON.stringify(child.arm)} in round ${child.round} is not a finite number.`);
    }
    const arms = byRound.get(child.round) ?? new Map();
    if (arms.has(child.arm)) throw new RangeError(`jobRounds: the arm ${JSON.stringify(child.arm)} comes twice in round ${child.round}.`);
    byRound.set(child.round, arms.set(child.arm, child));
  }
  const out = new Map(CASES.map((item) => [item.case, { rounds: [], aa: [] }]));
  for (const [round, arms] of byRound) {
    for (const arm of ARMS) if (!arms.has(arm.id)) throw new RangeError(`jobRounds: round ${round} has no child of the arm ${JSON.stringify(arm.id)}.`);
    for (const item of CASES) {
      const value = ([top, base]) => Math.max(0, arms.get(top)[item.measure] - arms.get(base)[item.measure]);
      out.get(item.case).rounds.push({ case: item.case, round, value: value(item.arm) });
      out.get(item.case).aa.push({ case: item.case, round, value: value(item.aa) });
    }
  }
  return out;
}

/**
 * This function gives the read of the gate over the jobs.
 *
 * - Without `limits`, the read only reports. With 5 jobs or more, it gives the limits that the jobs give: for each
 *   measure, the worst high end of the interval of the median plus the spread, and the same for the A/A difference.
 * - With `limits`, each case of each job gets a budget verdict. The case `node rss` uses the limit of `context rss`, and
 *   it must be beyond it. Fewer than 5 jobs give no read.
 *
 * @param {readonly { job: string; children: readonly { arm: string; round: number; rss: number; heap: number }[] }[]} jobs
 * @param {{ rss: { limit: number; maxDifference: number }; heap: { limit: number; maxDifference: number } } | undefined} limits
 */
export function memoryRead(jobs, limits) {
  const reads = jobs.map(({ job, children }) => {
    const rounds = jobRounds(children);
    const cases = CASES.map((item) => {
      const options = limits?.[item.measure] ?? { limit: Number.MAX_SAFE_INTEGER, maxDifference: Number.MAX_SAFE_INTEGER };
      const { rounds: values, aa } = rounds.get(item.case);
      const verdict = budgetVerdict(values, aa, options);
      return { ...verdict.cases[0], case: item.case };
    });
    return { job, cases };
  });
  const enough = jobs.length >= MIN_JOBS;
  const derived = {};
  for (const measure of ["rss", "heap"]) {
    const name = `context ${measure}`;
    const of = reads.map((read) => read.cases.find((item) => item.case === name));
    derived[measure] = enough
      ? { limit: runLimit(of.map((item) => item.high), { digits: 0 }), maxDifference: runLimit(of.map((item) => item.difference ?? Number.NaN), { digits: 0 }) }
      : undefined;
  }
  if (limits === undefined) return { reads, derived, gate: undefined };
  const outcomes = [];
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

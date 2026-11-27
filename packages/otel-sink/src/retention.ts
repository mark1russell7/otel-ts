/**
 * The retention rules of the store, as data. Each signal has a maximum age and a maximum size. The prune deletes the
 * rows past the age, then the oldest rows past the size. The sum of the sizes must be at most `HARD_LIMIT_BYTES`, so
 * no set of rules lets the store fill the disk.
 */

/** The three signals of the store */
export type Signal = "spans" | "logs" | "points";

/** The signals of the store, in a fixed order */
export const SIGNALS: readonly Signal[] = ["spans", "logs", "points"];

/** The rule of one signal */
export interface SignalRule {
  /** The maximum age of a row, in milliseconds. The age is from the time of the row, not from its arrival. */
  readonly maxAgeMs: number;
  /** The maximum size of the rows of the signal, in bytes, as the store counts them */
  readonly maxBytes: number;
}

/** The rules of the three signals */
export type RetentionRules = { readonly [signal in Signal]: SignalRule };

const MiB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The upper limit of the sum of the sizes of all signals: 1 GiB */
export const HARD_LIMIT_BYTES: number = 1024 * MiB;

/** The default rules: 3 days and 256 MiB for spans and logs, 7 days and 128 MiB for metric points */
export const DEFAULT_RETENTION: RetentionRules = {
  spans: { maxAgeMs: 3 * DAY_MS, maxBytes: 256 * MiB },
  logs: { maxAgeMs: 3 * DAY_MS, maxBytes: 256 * MiB },
  points: { maxAgeMs: 7 * DAY_MS, maxBytes: 128 * MiB },
};

/** This function gives the problems of a set of rules. A store refuses rules with problems. */
export const retentionProblems = (rules: RetentionRules): string[] => {
  const problems: string[] = [];
  let total = 0;
  for (const signal of SIGNALS) {
    const rule = rules[signal] as SignalRule | undefined;
    if (rule === undefined) {
      problems.push(`${signal}: no rule`);
      continue;
    }
    if (!Number.isFinite(rule.maxAgeMs) || rule.maxAgeMs <= 0) problems.push(`${signal}: maxAgeMs must be a positive finite number`);
    if (!Number.isSafeInteger(rule.maxBytes) || rule.maxBytes <= 0) problems.push(`${signal}: maxBytes must be a positive whole number`);
    else total += rule.maxBytes;
  }
  if (total > HARD_LIMIT_BYTES) problems.push(`the sum of maxBytes is ${total}, more than the hard limit ${HARD_LIMIT_BYTES}`);
  return problems;
};

/**
 * The memory gate of the entry `/node/context` (see `bench/memory-gate.ts`). Build the package first: the children load `dist`.
 *
 * Usage:
 * - `node bench/memory.ts measure <job> [rounds]` starts one fresh child for each arm in each round. It writes one JSON
 *   line for each child, then one line with the computer.
 * - `node bench/memory.ts verdict <folder>` reads each `records.jsonl` in the folder. The limits come from the variables
 *   `MEMORY_RSS_LIMIT`, `MEMORY_RSS_AA`, `MEMORY_HEAP_LIMIT` and `MEMORY_HEAP_AA`, in bytes. Without them, the read only reports.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateLine, writeGateLine, writeGateVerdict } from "@mark1russell7/rigor-bench";
import { freshArms } from "@mark1russell7/rigor-bench/fresh";
import { createPrinter } from "@mark1russell7/text/print";
import { ARMS, memoryRead, type MemoryChild, type MemoryLimits } from "./memory-gate.ts";

const CHILD = fileURLToPath(new URL("./memory-child.ts", import.meta.url));
const MIB = 1024 * 1024;
const out = createPrinter({ out: process.stdout, err: process.stderr });

/** The record of one child in `records.jsonl`. */
interface ChildRecord extends MemoryChild {
  readonly record: "child";
  readonly job: string;
}

/** This function measures one job and prints its records. */
async function measure(job: string, rounds: number | undefined): Promise<void> {
  const run = await freshArms({
    arms: ARMS,
    aa: ["api-a", "api-b"],
    command: [process.execPath, "--expose-gc", CHILD],
    args: (id) => ["--case", id],
    job,
    warmUp: 1,
    ...(rounds === undefined ? {} : { rounds }),
  });
  for (const warning of run.warnings) out.warn(warning);
  for (const child of run.processes) {
    // The runner keeps each field of the child line that it does not know in `extra`.
    const extra = child.fields?.extra;
    out.line(JSON.stringify({ record: "child", job, arm: child.arm, case: child.case, round: child.round, position: child.position, ms: child.ms, rss: extra?.["rss"], heap: extra?.["heap"] }));
  }
  out.line(JSON.stringify({ record: "env", job, env: run.env, rounds: run.rounds, balanced: run.balanced }));
}

/** This function gives the child records of each file `records.jsonl` in a folder and its folders. */
function childrenIn(folder: string): ChildRecord[] {
  const lines: ChildRecord[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name !== "records.jsonl") continue;
    for (const text of readFileSync(join(entry.parentPath, entry.name), "utf8").split("\n")) {
      if (text.trim() === "") continue;
      const line: unknown = JSON.parse(text);
      if (isChildRecord(line)) lines.push(line);
    }
  }
  return lines;
}

/** This function tells if a parsed line is the record of a child. The read checks each measure again. */
function isChildRecord(line: unknown): line is ChildRecord {
  if (typeof line !== "object" || line === null) return false;
  const record = line as Readonly<Record<string, unknown>>;
  return record["record"] === "child" && typeof record["job"] === "string" && typeof record["arm"] === "string" && typeof record["round"] === "number";
}

/** This function reads one limit in bytes from the environment, or gives `undefined` when the variable is empty. */
function bytes(name: string): number | undefined {
  const text = process.env[name];
  if (text === undefined || text === "") return undefined;
  const value = Number(text);
  if (!(Number.isSafeInteger(value) && value > 0)) throw new RangeError(`${name} is a whole number of bytes above 0, not ${JSON.stringify(text)}.`);
  return value;
}

/** This function reads the four limits of the gate. It gives `undefined` when no limit is set. */
function limitsOf(): MemoryLimits | undefined {
  const [rssLimit, rssAa, heapLimit, heapAa] = [bytes("MEMORY_RSS_LIMIT"), bytes("MEMORY_RSS_AA"), bytes("MEMORY_HEAP_LIMIT"), bytes("MEMORY_HEAP_AA")];
  if (rssLimit === undefined && rssAa === undefined && heapLimit === undefined && heapAa === undefined) return undefined;
  if (rssLimit === undefined || rssAa === undefined || heapLimit === undefined || heapAa === undefined) throw new RangeError("Give the four limits of the memory gate, or none.");
  return { rss: { limit: rssLimit, maxDifference: rssAa }, heap: { limit: heapLimit, maxDifference: heapAa } };
}

/** This function reads the jobs of a folder against the limits, prints the read and sets the gate. */
function verdict(folder: string): void {
  const jobs = new Map<string, ChildRecord[]>();
  for (const line of childrenIn(folder)) jobs.set(line.job, [...(jobs.get(line.job) ?? []), line]);
  const limits = limitsOf();
  const read = memoryRead([...jobs].map(([job, children]) => ({ job, children })), limits);
  for (const { job, cases } of read.reads) {
    for (const item of cases) {
      out.line(JSON.stringify({ record: "case", job, case: item.case, median: item.median, low: item.low, high: item.high, aaMedian: item.aaMedian, difference: item.difference, rounds: item.rounds, outcome: item.outcome }));
      out.line(`job ${job}, ${item.case}: median ${(item.median / MIB).toFixed(2)} MiB, interval to ${(item.high / MIB).toFixed(2)} MiB, A/A difference ${((item.difference ?? 0) / MIB).toFixed(2)} MiB`);
    }
  }
  for (const [measure, derived] of Object.entries(read.derived)) {
    out.line(JSON.stringify({ record: "run limit", measure, jobs: jobs.size, limit: derived?.limit, maxDifference: derived?.maxDifference }));
  }
  if (read.gate === undefined || limits === undefined) {
    out.line("gate: no limits, so the read only reports.");
    return;
  }
  const cases = [{ case: "context memory", outcome: read.gate.outcome === "pass" ? "within" : read.gate.outcome === "block" ? "beyond" : "cannot decide" }];
  writeGateLine(gateLine(cases, { title: "node/context memory", enforced: true, reason: `the entry adds at most ${(limits.rss.limit / MIB).toFixed(1)} MiB of resident memory, over ${jobs.size} jobs` }));
  writeGateVerdict(read.gate.outcome);
  out.line(`gate: ${read.gate.outcome}. ${read.gate.reason}`);
  if (read.gate.outcome !== "pass") process.exitCode = 1;
}

const [mode, first, second] = process.argv.slice(2);
if (mode === "measure" && first !== undefined) await measure(first, second === undefined ? undefined : Number(second));
else if (mode === "verdict" && first !== undefined) verdict(first);
else throw new Error("Usage: node bench/memory.ts measure <job> [rounds] | verdict <folder>");

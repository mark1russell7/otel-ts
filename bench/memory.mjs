/**
 * The memory gate of the entry `/node/context` (see `bench/memory-gate.mjs`). Build the package first: the children load `dist`.
 *
 * Usage:
 * - `node bench/memory.mjs measure <job> [rounds]` starts one fresh child for each arm in each round. It writes one JSON
 *   line for each child, then one line with the computer.
 * - `node bench/memory.mjs verdict <folder>` reads each `records.jsonl` in the folder. The limits come from the variables
 *   `MEMORY_RSS_LIMIT`, `MEMORY_RSS_AA`, `MEMORY_HEAP_LIMIT` and `MEMORY_HEAP_AA`, in bytes. Without them, the read only reports.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateLine, writeGateLine, writeGateVerdict } from "@mark1russell7/rigor-bench";
import { freshArms } from "@mark1russell7/rigor-bench/fresh";
import { ARMS, memoryRead } from "./memory-gate.mjs";

const CHILD = fileURLToPath(new URL("./memory-child.mjs", import.meta.url));
const MIB = 1024 * 1024;

/** This function measures one job and prints its records. */
async function measure(job, rounds) {
  const run = await freshArms({
    arms: ARMS,
    aa: ["api-a", "api-b"],
    command: [process.execPath, "--expose-gc", CHILD],
    args: (id) => ["--case", id],
    job,
    warmUp: 1,
    ...(rounds === undefined ? {} : { rounds }),
  });
  for (const warning of run.warnings) console.error(`warning: ${warning}`);
  for (const child of run.processes) {
    // The runner keeps each field of the child line that it does not know in `extra`.
    const { rss, heap } = child.fields?.extra ?? {};
    console.log(JSON.stringify({ record: "child", job, arm: child.arm, case: child.case, round: child.round, position: child.position, ms: child.ms, rss, heap }));
  }
  console.log(JSON.stringify({ record: "env", job, env: run.env, rounds: run.rounds, balanced: run.balanced }));
}

/** This function gives the lines of each file `records.jsonl` in a folder and its folders. */
function linesIn(folder) {
  const lines = [];
  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name !== "records.jsonl") continue;
    for (const text of readFileSync(join(entry.parentPath, entry.name), "utf8").split("\n")) if (text.trim() !== "") lines.push(JSON.parse(text));
  }
  return lines;
}

/** This function reads one limit in bytes from the environment, or gives `undefined` when the variable is empty. */
function bytes(name) {
  const text = process.env[name];
  if (text === undefined || text === "") return undefined;
  const value = Number(text);
  if (!(Number.isSafeInteger(value) && value > 0)) throw new RangeError(`${name} is a whole number of bytes above 0, not ${JSON.stringify(text)}.`);
  return value;
}

/** This function reads the jobs of a folder against the limits, prints the read and sets the gate. */
function verdict(folder) {
  const jobs = new Map();
  for (const line of linesIn(folder)) {
    if (line.record !== "child") continue;
    jobs.set(line.job, [...(jobs.get(line.job) ?? []), line]);
  }
  const values = [bytes("MEMORY_RSS_LIMIT"), bytes("MEMORY_RSS_AA"), bytes("MEMORY_HEAP_LIMIT"), bytes("MEMORY_HEAP_AA")];
  const set = values.filter((value) => value !== undefined).length;
  if (set !== 0 && set !== 4) throw new RangeError("Give the four limits of the memory gate, or none.");
  const [rssLimit, rssAa, heapLimit, heapAa] = values;
  const limits = set === 4 ? { rss: { limit: rssLimit, maxDifference: rssAa }, heap: { limit: heapLimit, maxDifference: heapAa } } : undefined;
  const read = memoryRead([...jobs].map(([job, children]) => ({ job, children })), limits);
  for (const { job, cases } of read.reads) {
    for (const item of cases) {
      console.log(JSON.stringify({ record: "case", job, case: item.case, median: item.median, low: item.low, high: item.high, aaMedian: item.aaMedian, difference: item.difference, rounds: item.rounds, outcome: item.outcome }));
      console.log(`job ${job}, ${item.case}: median ${(item.median / MIB).toFixed(2)} MiB, interval to ${(item.high / MIB).toFixed(2)} MiB, A/A difference ${((item.difference ?? 0) / MIB).toFixed(2)} MiB`);
    }
  }
  for (const [measure, derived] of Object.entries(read.derived)) {
    console.log(JSON.stringify({ record: "run limit", measure, jobs: jobs.size, limit: derived?.limit, maxDifference: derived?.maxDifference }));
  }
  if (read.gate === undefined) {
    console.log("gate: no limits, so the read only reports.");
    return;
  }
  const cases = [{ case: "context memory", outcome: read.gate.outcome === "pass" ? "within" : read.gate.outcome === "block" ? "beyond" : "cannot decide" }];
  writeGateLine(gateLine(cases, { title: "node/context memory", enforced: true, reason: `the entry adds at most ${(rssLimit / MIB).toFixed(1)} MiB of resident memory, over ${jobs.size} jobs` }));
  writeGateVerdict(read.gate.outcome);
  console.log(`gate: ${read.gate.outcome}. ${read.gate.reason}`);
  if (read.gate.outcome !== "pass") process.exitCode = 1;
}

const [mode, first, second] = process.argv.slice(2);
if (mode === "measure" && first !== undefined) await measure(first, second === undefined ? undefined : Number(second));
else if (mode === "verdict" && first !== undefined) verdict(first);
else throw new Error("Usage: node bench/memory.mjs measure <job> [rounds] | verdict <folder>");

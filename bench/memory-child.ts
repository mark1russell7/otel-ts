/**
 * One child of the memory gate. The child loads one entry of the built package, starts it, makes one span, and prints
 * one JSON line: its time, the live heap after a full GC and the resident set. Start it with the Node flags
 * `--expose-gc` and `--single-threaded`.
 *
 * The cases: `api` loads only `@opentelemetry/api` (the baseline), `context` starts `startNodeContext()`, and `node`
 * starts `startNodeTelemetry()` with export off.
 */
import { heapAfterGc, processMemory } from "@mark1russell7/rigor-bench/fresh";
import { createPrinter } from "@mark1russell7/text/print";

/**
 * The built files that the child loads. The paths are values and not literals, so the typecheck does not need a build.
 * The types come from the source of each entry.
 */
const NODE_CONTEXT = "../dist/node-context.js";
const NODE = "../dist/node.js";

const at = performance.now();
const index = process.argv.indexOf("--case");
const kind = index === -1 ? undefined : process.argv[index + 1];
const { trace } = await import("@opentelemetry/api");
let stop = (): Promise<void> => Promise.resolve();
if (kind === "context") {
  const { startNodeContext } = (await import(NODE_CONTEXT)) as typeof import("../src/node-context.ts");
  const started = startNodeContext({ serviceName: "memory-gate", env: {} });
  stop = () => started.shutdown();
} else if (kind === "node") {
  const { startNodeTelemetry } = (await import(NODE)) as typeof import("../src/node.ts");
  const started = startNodeTelemetry({ serviceName: "memory-gate", enabled: false, stopOnSignals: false, env: {} });
  stop = () => started.shutdown();
} else if (kind !== "api") {
  throw new Error(`memory-child: the case is api, context or node, not ${JSON.stringify(kind)}.`);
}
trace.getTracer("memory-gate").startSpan("one").end();
const ms = performance.now() - at;
const heap = heapAfterGc();
const { rss } = processMemory();
createPrinter({ out: process.stdout, err: process.stderr }).line(JSON.stringify({ ms, heap, rss }));
await stop();

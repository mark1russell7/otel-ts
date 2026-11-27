import { kubernetes, localDev, service, workerLoop } from "@mark1russell7/service";
import type { Profile, ServiceBuilder } from "@mark1russell7/service";
import { probeServer } from "@mark1russell7/service/http";
import { attachApi } from "./api.ts";
import type { RetentionRules } from "./retention.ts";
import { openStore, type Store } from "./store.ts";

export { attachApi, receiver, windowOf, MAX_BODY_BYTES, QUERY_ROUTES, type ApiOptions } from "./api.ts";
export * from "./otlp.ts";
export * from "./query.ts";
export * from "./retention.ts";
export * from "./store.ts";

const s = (value: number) => ({ value, unit: "s" });
const count = (value: number) => ({ value, unit: "count" });

/**
 * These are the profiles of the shutdown, by name. `local` is for the computer of a developer.
 * `pod` is for a pod of Kubernetes with a grace of 30 s and no preStop hook. Make `grace` equal to
 * the `terminationGracePeriodSeconds` of the pod.
 */
export const PROFILES: Readonly<Record<string, Profile>> = {
  local: localDev,
  pod: kubernetes({ grace: s(30), preStop: s(0) }),
};

/**
 * This function tells if an OTLP endpoint is the receiver of this sink. A sink that exports its own spans to itself
 * makes new spans at each export, without an end.
 */
export const isOwnEndpoint = (endpoint: string | undefined, port: number): boolean => {
  if (endpoint === undefined || endpoint === "") return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname);
  const target = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  return local && target === port;
};

/** The most deletes of one iteration of the retention worker. Each delete is one transaction of at most 5000 rows. */
export const PRUNE_BATCHES = 20;

/** These are the options of the service. */
export interface Options {
  /** This number is the port of the API. */
  readonly port: number;
  /** This number is the port of the probes: `/startup`, `/readiness`, `/liveness` and `/report`. */
  readonly probePort: number;
  /** This profile gives the phases of the shutdown and the effect of a second signal. */
  readonly profile: Profile;
  /** This path is the SQLite file of the store, or `:memory:`. */
  readonly path: string;
  /** These rules give the age and the size of each signal. The default is `DEFAULT_RETENTION`. */
  readonly rules?: RetentionRules | undefined;
  /** This time is the sleep of the retention worker between two prunes, in seconds. The default is 60. */
  readonly pruneEverySeconds?: number | undefined;
  /** This function gives the time in milliseconds since the epoch. The default is `Date.now`. */
  readonly now?: (() => number) | undefined;
  /** This function gets each failure of a prune. The default does nothing: the next prune tries again after its backoff. */
  readonly onPruneError?: ((error: unknown, failures: number) => void) | undefined;
}

/**
 * This function declares the one service of the process. It starts nothing. `describe()` gives the
 * declaration as data, and `lint()` examines it. Only the entry (`main.ts`) uses `run()`.
 * The store is a dependency: it opens before the servers start, and it closes after they stop.
 */
export const declare = (options: Options): ServiceBuilder => {
  const now = options.now ?? Date.now;
  let opened: Store | undefined;
  const store = (): Store => {
    if (opened === undefined) throw new Error("the store is not open");
    return opened;
  };
  // The prune of the store, on a loop. A throw is a failure, and the loop waits its backoff. Each iteration does at most
  // PRUNE_BATCHES deletes, and gives "more" when the prune is not done. Thus the intake goes on between two parts, and
  // each part ends in its bound, before the cap of the drain of each profile.
  const retention = workerLoop(
    {
      worker_sleep: s(options.pruneEverySeconds ?? 60),
      unit_processing_time: s(3),
      retry_base: s(5),
      retry_cap: s(300),
      close_bound: s(0.5),
      concurrency: count(1),
    },
    { iteration: () => (store().prune(now(), PRUNE_BATCHES).done ? undefined : "more"), onError: options.onPruneError },
  );
  const svc = service("otel-sink").dependency(
    "store",
    { system: null, knobs: {}, operations: {} },
    {
      connect: () => {
        opened = openStore(options.path, { rules: options.rules });
      },
      close: () => {
        opened?.close();
        opened = undefined;
      },
    },
  );
  return (
    attachApi(svc, { port: options.port, store, now })
      .worker("retention", retention.knobs, retention)
      // The probes have a port of their own. Thus they answer through the whole shutdown.
      .healthServer(probeServer({ port: options.probePort, server_retry_after: s(1) }))
      // The policies apply to the checks of the service. Add a check with `check(check, run)`.
      .readiness({ type: "debounce", interval: s(5), failAfter: 3, recoverAfter: 1 })
      .liveness({ type: "window", failAfter: s(45) })
      .startup(s(30))
      .profile(options.profile)
  );
};

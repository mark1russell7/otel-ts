import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { QUERY_ROUTES, RECEIVER_ROUTES } from "./api.ts";

/**
 * Each response of the sink goes through `handle` of the service. Thus the drain of a shutdown waits for each export
 * and each query. A raw mount that writes its own response is outside the request tracking.
 */
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "api.ts"), "utf8");

describe("the API of the sink", () => {
  it("writes no raw response", () => {
    expect(source).not.toMatch(/\.writeHead\(|ServerResponse/);
  });

  it("mounts only the receiver and the query routes, each one through handle", () => {
    const mounts = [...source.matchAll(/http\.mount\(\s*(\w+)\(/g)].map((match) => match[1]);
    expect(mounts.length).toBe(1 + QUERY_ROUTES.length);
    expect(new Set(mounts)).toEqual(new Set(["receiver", "query"]));
    expect(source).toMatch(/export const receiver = [^]*?handle<JsonReply>\("receiver"/);
    expect(source).toMatch(/const query = [^]*?handle<JsonReply>\(\s*"api"/);
  });

  it("declares the routes of the receiver, none of them idempotent", () => {
    expect(RECEIVER_ROUTES).toEqual(["POST /v1/traces", "POST /v1/logs", "POST /v1/metrics"]);
    expect(source).toMatch(/for \(const route of RECEIVER_ROUTES\) received\.route\(route, \{ idempotent: false \}\)/);
  });
});

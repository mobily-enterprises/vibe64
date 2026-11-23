import assert from "node:assert/strict";
import test from "node:test";

import { MobilynetError, createMobilynetClient, tagQuery } from "../../packages/vibe64-deploy/src/adapters/mobilynet/client.js";

// The deploy engine's mobilynet client against a recording fetch: what it sends (the key, Idempotency-Key, JSON or an
// upload with its SHA-256, tag filters, pages), how it reads mobilynet's refusals, and how a token source refreshes.

const BASE = "https://api.mobilynet.test";

/**
 * A fetch answering each request from `answers` in turn (`{ status, body, requestId }`), keeping what it was asked.
 * @param {Array<{ status: number, body?: unknown, text?: string, requestId?: string } | Error>} answers
 */
function recordingFetch(answers) {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push({ url: new URL(String(url)), init });
    const next = answers.shift();
    if (!next) throw new Error("no answer left");
    if (next instanceof Error) throw next;
    const text = next.text ?? JSON.stringify(next.body ?? {});
    return new Response(text, { status: next.status, headers: next.requestId ? { "request-id": next.requestId } : {} });
  };
  return { fetch, asked };
}

/** The client over a recording fetch with an API key. */
function clientWith(answers, more = {}) {
  const recorded = recordingFetch(answers);
  return { ...recorded, client: createMobilynetClient({ baseUrl: BASE, credential: "mnk_test", fetch: recorded.fetch, ...more }) };
}

test("a request carries the key, its Idempotency-Key, JSON or an upload with its SHA-256, each tag filter, and follows no redirect", async () => {
  const { client, asked } = clientWith([
    { status: 202, body: { service: { id: "svc_1" }, refresh: null } },
    { status: 202, body: { release: { version: "20261120-abcdef0" } } },
    { status: 200, body: { items: [{ id: "svc_1" }], next: "1" } },
    { status: 200, body: { items: [{ id: "svc_2" }], next: null } },
    { status: 202, body: { hostedService: { id: "hs_1" } } },
    { status: 200, body: { spendingCap: { state: "under" } } }
  ]);
  const production = client.project("prj_1");
  const spec = { name: "web", region: "us", size: "a-2", instances: 2, app: { version: "v" }, tags: { "vibe64-deployment": "dep_1" } };
  await production.createService(spec, { idempotencyKey: "service-web" });
  const archive = Buffer.from([0x1f, 0x8b, 1, 2, 3]);
  await production.createRelease("shop", { archive, sha256: "a".repeat(64) });
  assert.deepEqual((await production.listServices({ tags: { "vibe64-deployment": "dep_1", "vibe64-item": "service.web" } })).map((one) => one.id), ["svc_1", "svc_2"]);
  await client.deleteHostedService("hs_1", { revokeLinks: true });
  assert.deepEqual(await production.readSpendingCap(), { state: "under" });

  const [create, upload, firstPage, secondPage, remove, cap] = asked;
  assert.deepEqual(
    [create.init.method, create.url.pathname, create.init.headers.authorization, create.init.headers["idempotency-key"], create.init.headers["content-type"], create.init.redirect],
    ["POST", "/v1/projects/prj_1/services", "Bearer mnk_test", "service-web", "application/json", "manual"]
  );
  assert.deepEqual(JSON.parse(create.init.body), spec, "tags go as the create gives them");
  assert.equal(create.init.headers["user-agent"], "vibe64-deploy");
  assert.deepEqual(
    [upload.url.pathname, upload.init.headers["content-type"], upload.init.headers["mobilynet-content-sha256"], upload.init.body],
    ["/v1/projects/prj_1/apps/shop/releases", "application/gzip", "a".repeat(64), archive]
  );
  assert.deepEqual(firstPage.url.searchParams.getAll("tag"), ["vibe64-deployment:dep_1", "vibe64-item:service.web"]);
  assert.equal(firstPage.url.searchParams.has("label"), false, "never label=, tag's previous name");
  assert.deepEqual([firstPage.url.searchParams.get("limit"), firstPage.url.searchParams.get("after"), secondPage.url.searchParams.get("after")], ["100", null, "1"]);
  assert.deepEqual([remove.init.method, remove.url.pathname, remove.url.search], ["DELETE", "/v1/hosted-services/hs_1", "?links=revoke"]);
  assert.equal(cap.url.pathname, "/v1/projects/prj_1/spending-cap");
  assert.deepEqual(tagQuery(undefined), []);
});

test("a refusal is a MobilynetError with mobilynet's code, message, details and request id; a refusal waits for a person, the rest are tried again", async () => {
  const refusalOf = (code, status, details = null) => ({ status, body: { error: { code, message: `${code} said`, details, requestId: `req_${code}` } }, requestId: `hdr_${code}` });
  const cases = [
    [refusalOf("spending_cap_reached", 409, { projectId: "prj_1", capNano: "1", spentNano: "1", month: "2026-11", currency: "USD" }), false],
    [refusalOf("quota_exceeded", 429, { quota: "vcpus", limit: 20 }), false],
    [refusalOf("rate_limited", 429), true],
    [refusalOf("no_capacity", 503), false],
    [refusalOf("internal_error", 500), true],
    [refusalOf("invalid_state", 409, { state: "working" }), true],
    [refusalOf("invalid_state", 409, { state: "creating" }), false],
    [refusalOf("lease_held", 409, { holder: "Vibe64 on laptop" }), false],
    // A link whose consumer's move mobilynet can't check yet is asked again in a moment (M14); other field errors wait.
    [refusalOf("validation_failed", 422, { fieldErrors: { consumer: "The release it is moving to isn't read yet (its refresh is queued or starting): try again once that refresh is building; its build reads the release first." } }), true],
    [refusalOf("validation_failed", 422, { fieldErrors: { need: "Its app declares no need of redis (the needs of its mobilynet.json)." } }), false],
    [{ status: 502, text: "<html>bad gateway</html>" }, true]
  ];
  const seen = [];
  const { client } = clientWith(cases.map(([answer]) => answer), { onRequest: (entry) => seen.push(entry) });
  const results = [];
  for (let index = 0; index < cases.length; index += 1) {
    try {
      await client.changeService("svc_1", { instances: 2 }, { idempotencyKey: `k${index}` });
      assert.fail("refused");
    } catch (error) {
      assert.ok(error instanceof MobilynetError);
      results.push([error.code, error.retryable]);
    }
  }
  assert.deepEqual(results, cases.map(([answer, retryable], index) => [index === cases.length - 1 ? "http_502" : answer.body.error.code, retryable]));
  const { client: one } = clientWith([refusalOf("quota_exceeded", 429, { quota: "vcpus", limit: 20 })]);
  const error = await one.project("prj_1").createService({}, { idempotencyKey: "k" }).catch((caught) => caught);
  assert.deepEqual(
    { status: error.status, code: error.code, message: error.message, details: error.details, requestId: error.requestId },
    { status: 429, code: "quota_exceeded", message: "quota_exceeded said", details: { quota: "vcpus", limit: 20 }, requestId: "hdr_quota_exceeded" }
  );
  assert.deepEqual(Object.keys(seen[0]).sort(), ["errorCode", "idempotencyKey", "method", "ms", "path", "requestId", "status"], "told of each request, never its body");
  assert.deepEqual([seen[0].method, seen[0].path, seen[0].idempotencyKey, seen[0].status, seen[0].errorCode], ["PATCH", "/v1/services/svc_1", "k0", 409, "spending_cap_reached"]);

  const { client: missing } = clientWith([
    { status: 404, body: { error: { code: "not_found", message: "No such service." } } },
    { status: 404, body: { error: { code: "not_found", message: "No such service." } } },
    { status: 404, body: { error: { code: "not_found", message: "No such hosted service." } } }
  ]);
  assert.equal(await missing.readService("svc_gone"), null);
  assert.deepEqual(await missing.deleteService("svc_gone"), { removed: true });
  assert.equal(await missing.readHostedService("hs_gone"), null);
  const { client: down } = clientWith([new TypeError("fetch failed")]);
  const unreachable = await down.readService("svc_1").catch((caught) => caught);
  assert.deepEqual([unreachable.status, unreachable.code, unreachable.retryable], [null, "unreachable", true]);
});

test("a token source is refreshed once when mobilynet refuses its token, and an API key never is", async () => {
  let token = "mna_old";
  let refreshes = 0;
  const credential = { token: () => token, refresh: () => { refreshes += 1; token = "mna_new"; } };
  const refused = { status: 401, body: { error: { code: "key_expired", message: "This API key has expired." } } };
  const recorded = recordingFetch([refused, { status: 200, body: { items: [], next: null } }, refused, refused]);
  const client = createMobilynetClient({ baseUrl: BASE, credential, fetch: recorded.fetch });
  assert.deepEqual(await client.project("prj_1").listServices(), []);
  assert.deepEqual(recorded.asked.map((one) => one.init.headers.authorization), ["Bearer mna_old", "Bearer mna_new"]);
  const twice = await client.project("prj_1").listServices().catch((caught) => caught);
  assert.deepEqual([twice.code, refreshes, recorded.asked.length], ["key_expired", 2, 4], "refreshed once a request, then refused");

  const { client: keyed, asked } = clientWith([{ status: 401, body: { error: { code: "unauthenticated", message: "Send an API key." } } }]);
  const error = await keyed.project("prj_1").listServices().catch((caught) => caught);
  assert.deepEqual([error.code, error.retryable, asked.length], ["unauthenticated", false, 1]);
  const empty = createMobilynetClient({ baseUrl: BASE, credential: { token: () => "" }, fetch: recordingFetch([]).fetch });
  await assert.rejects(empty.project("prj_1").listServices(), { name: "TypeError", message: "The mobilynet credential gave no token." });
});

test("mobilynet's address is https, or http on this machine only, and a credential is a key or a token source", () => {
  assert.throws(() => createMobilynetClient({ baseUrl: "http://api.example.com", credential: "mnk_test" }), /https:\/\/…, or http:\/\/ on this machine only/u);
  assert.ok(createMobilynetClient({ baseUrl: "http://127.0.0.1:3900", credential: "mnk_test" }));
  assert.throws(() => createMobilynetClient({ baseUrl: BASE, credential: {} }), /an API key, or a token source/u);
  assert.throws(() => createMobilynetClient({ baseUrl: BASE, credential: "mnk_test" }).project(""), /needs the mobilynet project's id/u);
});

// mobilynet's page of an App Service's logs (its openApiServices.js readServiceLogs, mobilynet main 17340a6a): the
// keys of its answer, 202 while its reads run and 200 with the page.
const LOGS_KEYS = ["after", "before", "instances", "lines", "more", "operations", "readAt", "units"];
const LOG_LINE_KEYS = ["at", "error", "instance", "name", "text", "unit"];

test("a service's logs are asked as mobilynet's logs page takes them, each instance list comma-separated, and answered as mobilynet gives them", async () => {
  const page = {
    instances: [{ id: "vps_1", name: "web-k3x9", live: true, removedAt: null, error: null }],
    units: ["web"],
    lines: [{ at: "2026-11-23T09:09:58.120351Z", instance: "vps_1", name: "web-k3x9", unit: "web", text: "listening on 3000", error: false }],
    before: null,
    after: "eyJzIjoic3ZjXzEifQ",
    more: false,
    readAt: "2026-11-23T09:10:00.000Z",
    operations: [{ id: "op_1", kind: "app_logs", state: "succeeded" }]
  };
  const { client, asked } = clientWith([{ status: 200, body: page }, { status: 200, body: page }]);
  const answer = await client.readServiceLogs("svc_1", {
    only: ["vps_1", "web-k3x9"], except: "vps_2", unit: "web", since: "2026-11-23T09:00:00Z", until: "2026-11-23T10:00:00Z", text: "error", lines: 50, before: "b"
  });
  assert.deepEqual(answer, page, "the page as mobilynet gave it");
  assert.deepEqual(Object.keys(answer).sort(), LOGS_KEYS);
  assert.deepEqual(Object.keys(answer.lines[0]).sort(), LOG_LINE_KEYS);
  const { url } = asked[0];
  assert.equal(url.pathname, "/v1/services/svc_1/logs");
  assert.deepEqual([...url.searchParams], [
    ["only", "vps_1,web-k3x9"], ["except", "vps_2"], ["unit", "web"], ["since", "2026-11-23T09:00:00Z"], ["until", "2026-11-23T10:00:00Z"],
    ["text", "error"], ["lines", "50"], ["before", "b"]
  ]);
  // Asked with nothing, it asks for the newest page of every instance.
  await client.readServiceLogs("svc_1");
  assert.equal(asked[1].url.search, "");
  // An instance asked by the name mobilynet's logs no longer take fails here, naming the one that does.
  await assert.rejects(client.readServiceLogs("svc_1", { instance: "vps_1" }), /readServiceLogs takes no instance: name instances with only/u);
  assert.equal(asked.length, 2);
});

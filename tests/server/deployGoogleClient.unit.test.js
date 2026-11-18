import assert from "node:assert/strict";
import test from "node:test";

import { GoogleError, apiRoot, createGoogleClient } from "../../packages/vibe64-deploy/src/adapters/google/client.js";
import { createGoogleStandIn } from "../../packages/vibe64-deploy/src/adapters/google/standIn.js";

// The Google client: each API at its own googleapis.com host, or every API under one gateway; Google's two error
// shapes read as one GoogleError, retried or refused; a token source refreshed once after a 401; listings paged; and
// no request body ever handed to the logger.

const SECRETS = (project) => `v1/projects/${project}/secrets`;

test("the direct pathway calls each API at its googleapis.com host; through a gateway, the same calls go under its address", async () => {
  assert.equal(apiRoot(undefined, "run").href, "https://run.googleapis.com/");
  assert.equal(apiRoot("https://gateway.example/google/", "sqladmin").href, "https://gateway.example/google/sqladmin/");
  assert.equal(apiRoot("http://127.0.0.1:8080", "compute").href, "http://127.0.0.1:8080/compute/");
  assert.throws(() => apiRoot("http://gateway.example", "run"), /https:\/\/…, or http:\/\/ on this machine only/u);
  assert.throws(() => createGoogleClient({ credential: {} }), /an access token, or a token source/u);

  for (const gateway of [false, true]) {
    const standIn = createGoogleStandIn();
    const urls = [];
    const fetch = (url, init) => {
      urls.push(String(url));
      return standIn.fetch(url, init);
    };
    const client = createGoogleClient({ ...(gateway ? { baseUrl: standIn.gateway } : {}), credential: standIn.token(), fetch });
    const made = await client.call("secretmanager", "POST", SECRETS(standIn.project), { query: { secretId: "one" }, body: { replication: { automatic: {} } } });
    assert.equal(made.name, `projects/${standIn.projectNumber}/secrets/one`);
    assert.equal(urls[0], gateway
      ? `${standIn.gateway}/secretmanager/${SECRETS(standIn.project)}?secretId=one`
      : `https://secretmanager.googleapis.com/${SECRETS(standIn.project)}?secretId=one`);
    assert.deepEqual(standIn.requests().map(({ api, method, path, status }) => [api, method, path, status]), [["secretmanager", "POST", SECRETS(standIn.project), 200]]);
  }
});

test("Google's errors, both shapes, become a GoogleError: missing, existing, busy and unreachable are told apart", async () => {
  const standIn = createGoogleStandIn();
  const client = createGoogleClient({ credential: standIn.token(), fetch: standIn.fetch });
  const failure = (promise) => promise.then(() => assert.fail("Google took it"), (error) => error);

  // The newer APIs: { error: { code, message, status } }.
  const missing = await failure(client.call("secretmanager", "GET", `${SECRETS(standIn.project)}/none`));
  assert.ok(missing instanceof GoogleError);
  assert.deepEqual([missing.status, missing.code, missing.retryable], [404, "NOT_FOUND", false]);
  assert.equal(await client.orNull(() => client.call("secretmanager", "GET", `${SECRETS(standIn.project)}/none`)), null);
  // Compute Engine's: { error: { code, message, errors: [{ reason }] } }.
  const network = await failure(client.call("compute", "GET", `compute/v1/projects/${standIn.project}/global/networks/none`));
  assert.deepEqual([network.status, network.code, network.message], [404, "notFound", `The resource 'projects/${standIn.project}/global/networks/none' was not found`]);
  const body = { name: "vibe64", autoCreateSubnetworks: false };
  await client.call("compute", "POST", `compute/v1/projects/${standIn.project}/global/networks`, { body });
  assert.equal(await client.orExisting(() => client.call("compute", "POST", `compute/v1/projects/${standIn.project}/global/networks`, { body })), null);

  // Retried at the next step: no answer, a 5xx, the rate limit, a thing busy. Refused: a quota, a bad request.
  const answering = (status, error) => createGoogleClient({ credential: "token", fetch: async () => new Response(JSON.stringify({ error }), { status }) });
  const cases = [
    [503, { code: 503, message: "Backend Error", status: "UNAVAILABLE" }, true],
    [429, { code: 429, message: "Rate exceeded.", errors: [{ reason: "rateLimitExceeded" }] }, true],
    [403, { code: 403, message: "Quota exceeded.", errors: [{ reason: "quotaExceeded" }] }, false],
    [400, { code: 400, message: "The resource is not ready", errors: [{ reason: "resourceNotReady" }] }, true],
    [400, { code: 400, message: "Invalid value", errors: [{ reason: "invalid" }] }, false]
  ];
  for (const [status, error, retryable] of cases) {
    const refused = await failure(answering(status, error).call("compute", "GET", "compute/v1/projects/p/global/networks"));
    assert.equal(refused.retryable, retryable, error.message);
  }
  const down = createGoogleClient({ credential: "token", fetch: async () => {
    throw new TypeError("fetch failed");
  } });
  const unreachable = await failure(down.call("run", "GET", "v2/x"));
  assert.deepEqual([unreachable.status, unreachable.code, unreachable.retryable], [null, "unreachable", true]);
});

test("a token source Google refused is refreshed once, and the request asked again; the logger never sees a body", async () => {
  const standIn = createGoogleStandIn();
  let token = standIn.token();
  let refreshed = 0;
  const logged = [];
  const credential = { token: () => token, refresh: () => {
    refreshed += 1;
    token = standIn.issueToken();
  } };
  const client = createGoogleClient({ credential, fetch: standIn.fetch, onRequest: (entry) => logged.push(entry) });
  standIn.issueToken();
  const made = await client.call("secretmanager", "POST", SECRETS(standIn.project), { query: { secretId: "key" }, body: { replication: { automatic: {} } } });
  assert.equal(made.name.split("/").pop(), "key");
  assert.equal(refreshed, 1);
  assert.deepEqual(logged.map(({ status, errorCode }) => [status, errorCode]), [[401, "UNAUTHENTICATED"], [200, null]]);
  assert.deepEqual(Object.keys(logged[0]).sort(), ["api", "errorCode", "method", "ms", "path", "status"]);

  // A token Google keeps refusing is refused after the one refresh; a plain token is never refreshed.
  const stale = createGoogleClient({ credential: { token: () => "old", refresh: () => {} }, fetch: standIn.fetch });
  const refused = await stale.call("secretmanager", "GET", SECRETS(standIn.project)).catch((error) => error);
  assert.deepEqual([refused.status, refused.code], [401, "UNAUTHENTICATED"]);
});

test("a listing is read page after page", async () => {
  const standIn = createGoogleStandIn();
  const client = createGoogleClient({ credential: standIn.token(), fetch: standIn.fetch });
  for (const id of ["a", "b", "c"]) await client.call("secretmanager", "POST", SECRETS(standIn.project), { query: { secretId: id }, body: { replication: { automatic: {} } } });
  const all = await client.listAll("secretmanager", SECRETS(standIn.project), "secrets", {}, { size: 2 });
  assert.deepEqual(all.map((secret) => secret.name.split("/").pop()), ["a", "b", "c"]);
  assert.deepEqual(standIn.requests().slice(3).map((request) => [request.query.pageSize, request.query.pageToken]), [[["2"], undefined], [["2"], ["2"]]]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { planOf } from "../../packages/vibe64-deploy/src/plan.js";
import { newRecord } from "../../packages/vibe64-deploy/src/record.js";
import { nextStep } from "../../packages/vibe64-deploy/src/steps.js";

// The offer's optional fields, which a provider that runs some services apart gives (a provider with one kind of
// machine gives none, and its plan is as before): machineSizes for a service that needs a whole machine of its own,
// unsupported's reason for a resource kind it runs none of, a resource kind's title; and a reached service's own
// address (internalUrl) in the inventory, where it is not http://<internalName>:<port>.
// A two-service app: a public web and internal workers on bigger machines, each running its jobs in a gVisor sandbox
// and reached instance by instance, with a PostgreSQL database and a bucket.
const DEPLOYMENT_LINES = Object.freeze([
  "",
  "- Runtimes: `nodejs`",
  "- Generated secrets: `SESSION_SECRET`",
  "- Build `Build`: `npm` `run` `build`",
  "- Migrate `Migrate database`: `npm` `run` `db:migrate`",
  "",
  "### Service `web`: pages and the API",
  "",
  "- Exposure: `public`",
  "- Serve `Start`: `node` `server.js`",
  "- Ready when: `GET` `/api/health` returns `200`",
  "- Instances: `1` to `6`",
  "- Needs at least: `2` vCPU, `2` GiB memory",
  "- Production: `2` instances",
  "- Reaches: `workers` as `WORKERS_URL`",
  "- Sandbox allows: `gvisor`",
  "",
  "### Service `workers`: jobs, each in its own gVisor sandbox",
  "",
  "- Exposure: `internal`",
  "- Reached: `each instance`",
  "- Serve `Start the workers`: `node` `worker.js`",
  "- Ready when: `GET` `/api/health` returns `200`",
  "- Instances: `1` to `20`",
  "- Needs at least: `8` vCPU, `16` GiB memory",
  "- Production: `2` instances",
  "- Sandbox allows: `gvisor`"
]);
const RESOURCES = Object.freeze([
  {
    component: "jskit-postgresql",
    resource: {
      id: "database",
      kind: "postgresql",
      environmentAlternatives: [{ preferred: true, bindings: { host: "DB_HOST", port: "DB_PORT", database: "DB_NAME", username: "DB_USER", password: "DB_PASSWORD" } }]
    }
  },
  {
    component: "jskit-storage",
    resource: {
      id: "files",
      kind: "bucket",
      environmentAlternatives: [{ preferred: true, bindings: { bucket: "FILES_BUCKET", region: "FILES_REGION", endpoint: "FILES_ENDPOINT", accessKeyId: "FILES_KEY_ID", secretAccessKey: "FILES_SECRET" } }]
    }
  }
]);
const NANO = 1_000_000_000n;
const nano = (dollars) => (BigInt(Math.round(dollars * 100)) * NANO / 100n).toString();

/** The two-service needs, its lines changed by `edit`, with these resources. */
function needsOf(edit = (lines) => lines, resources = RESOURCES) {
  const deployment = vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources },
    section: { status: "ready", stackHash: "sha256:stack", lines: edit([...DEPLOYMENT_LINES]), components: [], source: "project" }
  });
  const { needs, problem } = needsOfStack(deployment, { preferredAlternative, resourceKindIsDatabase });
  assert.equal(problem, null);
  return needs;
}

// web without its sandbox (so a plain service), workers sandboxed and reached at each instance.
const withoutWebSandbox = (lines) => {
  const web = lines.indexOf("### Service `web`: pages and the API");
  const sandbox = lines.indexOf("- Sandbox allows: `gvisor`", web);
  return lines.filter((_, index) => index !== sandbox);
};

const OFFER = Object.freeze({
  title: "Elsewhere",
  currency: "USD",
  sizes: [
    { name: "shape-2-4", vcpus: 2, memoryGib: 4, monthlyNano: nano(60) },
    { name: "shape-1-2", vcpus: 1, memoryGib: 2, monthlyNano: nano(30) },
    { name: "shape-8-16", vcpus: 8, memoryGib: 16, monthlyNano: nano(250) }
  ],
  machineSizes: [
    { name: "machine-8-32", vcpus: 8, memoryGib: 32, monthlyNano: nano(200) },
    { name: "machine-2-8", vcpus: 2, memoryGib: 8, monthlyNano: nano(50) },
    { name: "machine-8-16", vcpus: 8, memoryGib: 16, monthlyNano: nano(180) }
  ],
  balancer: { monthlyNano: nano(18.25) },
  resources: {
    postgresql: { title: "Managed PostgreSQL 16", defaultSize: "db-1", sizes: [{ name: "db-1", monthlyNano: nano(40) }] },
    bucket: { defaultSize: "standard", sizes: [{ name: "standard", monthlyNano: "0" }] }
  },
  unsupported: { redis: "Its managed Redis comes later; remove the resource or deploy elsewhere." }
});

test("machineSizes are offered to a service with a sandbox allowance or reached at each instance, sizes to the rest, each priced from its own list", () => {
  const needs = needsOf(withoutWebSandbox);
  const plan = planOf({ needs, record: null, observed: [], offer: OFFER });
  assert.deepEqual(plan.problems, []);
  const sizes = Object.fromEntries(plan.services.map((service) => [service.id, service.sizes.map((size) => size.name)]));
  // web (2 vCPU, 2 GiB, no sandbox): the shapes meeting it, cheapest first; workers (8 vCPU, 16 GiB, sandboxed, each):
  // the machines meeting it, cheapest first.
  assert.deepEqual(sizes, { web: ["shape-2-4", "shape-8-16"], workers: ["machine-8-16", "machine-8-32"] });
  assert.deepEqual(plan.choices.services, { web: { size: "shape-2-4", instances: 2 }, workers: { size: "machine-8-16", instances: 2 } });
  assert.deepEqual(plan.lines.filter((line) => line.part === "instances").map(({ item, size, monthlyNano }) => ({ item, size, monthlyNano })), [
    { item: "service.web", size: "shape-2-4", monthlyNano: nano(120) },
    { item: "service.workers", size: "machine-8-16", monthlyNano: nano(360) }
  ]);

  // A shape for the sandboxed service, or a machine for the plain one, is outside its offer.
  const crossed = planOf({ needs, record: null, observed: [], offer: OFFER, choices: { services: { web: { size: "machine-2-8" }, workers: { size: "shape-8-16" } } } });
  assert.deepEqual(crossed.problems.map((one) => [one.code, one.item]), [
    ["production_choice_invalid", "service.web"],
    ["production_choice_invalid", "service.workers"]
  ]);
  assert.match(crossed.problems[1].message, /choices\.services\.workers\.size is one of machine-8-16, machine-8-32\./u);

  // A sandbox alone (web's gvisor, reached at any instance) is enough for a machine.
  const sandboxed = planOf({ needs: needsOf(), record: null, observed: [], offer: OFFER });
  assert.deepEqual(sandboxed.services.find((service) => service.id === "web").sizes.map((size) => size.name), ["machine-2-8", "machine-8-16", "machine-8-32"]);
  // So is being reached at each instance alone.
  const eachOnly = needsOf((lines) => lines.filter((line) => line !== "- Sandbox allows: `gvisor`"));
  assert.deepEqual(planOf({ needs: eachOnly, record: null, observed: [], offer: OFFER }).services.map((service) => [service.id, service.sizes[0].name]),
    [["web", "shape-2-4"], ["workers", "machine-8-16"]]);
});

test("without machineSizes every service is offered sizes, as before", () => {
  const { machineSizes, ...offer } = OFFER;
  assert.ok(machineSizes);
  const plan = planOf({ needs: needsOf(), record: null, observed: [], offer });
  assert.deepEqual(plan.services.map((service) => [service.id, service.sizes.map((size) => size.name)]),
    [["web", ["shape-2-4", "shape-8-16"]], ["workers", ["shape-8-16"]]]);
});

test("a resource kind the provider runs none of is refused with the provider's reason, and a kind's title is the Plan's", () => {
  const cache = {
    component: "jskit-redis",
    resource: { id: "cache", kind: "redis", environmentAlternatives: [{ preferred: true, bindings: { url: "REDIS_URL" } }] }
  };
  const needs = needsOf(withoutWebSandbox, [...RESOURCES, cache]);
  const plan = planOf({ needs, record: null, observed: [], offer: OFFER });
  assert.deepEqual(plan.problems, [{
    code: "production_resource_unsupported",
    message: "Elsewhere runs no redis for cache. Its managed Redis comes later; remove the resource or deploy elsewhere.",
    item: "resource.cache"
  }]);
  // Without a reason, the refusal is as before.
  const { unsupported, ...plain } = OFFER;
  assert.ok(unsupported);
  assert.equal(planOf({ needs, record: null, observed: [], offer: plain }).problems[0].message, "Elsewhere runs no redis for cache.");
  // The kind's title is the Plan's, where the offer gives one, and absent where it doesn't.
  assert.deepEqual(plan.resources.map((resource) => [resource.id, resource.title]), [["database", "Managed PostgreSQL 16"], ["files", undefined]]);
  assert.equal(Object.hasOwn(plan.resources.find((resource) => resource.id === "files"), "title"), false);
});

test("a reached service's own address (internalUrl) is the setting, where the provider gives one; else http://<internalName>:<port>", () => {
  const needs = {
    services: [
      { id: "web", exposure: "public", reached: "any", instances: { min: 1, max: 1, start: 1 }, atLeast: null, reaches: [{ service: "api", setting: "API_URL" }], settings: {}, sandbox: [] },
      { id: "api", exposure: "internal", reached: "any", instances: { min: 1, max: 1, start: 1 }, atLeast: null, reaches: [], settings: {}, sandbox: [] }
    ],
    resources: [],
    supplied: [],
    generatedSecrets: [],
    setupCode: ""
  };
  const record = newRecord({ app: "shop", environment: "production", provider: { id: "elsewhere", project: "p1" } });
  record.items["service.api"] = { kind: "service", name: "api", id: "svc-api", providerName: "shop-api", origin: "made", size: "s", instances: 1, exposure: "internal" };
  record.run = { id: "run_1", services: { web: { version: "v1" }, api: { version: "v1", refreshId: null } }, domain: "shop.example.com", failure: null };
  const declared = { API_URL: { secret: false, required: true }, APP_ENV: { secret: false, required: true } };
  const release = {
    id: "c1", declarations: { web: { name: "shop-web" }, api: { name: "shop-api" } }, settings: { web: declared, api: {} }, env: {},
    domain: "shop.example.com", trustedProxies: "loopback", port: 3000
  };
  const api = { id: "svc-api", name: "shop-api", kind: "service", labels: {}, size: "s", instances: 1, exposure: "internal", version: "v1", refresh: null, healthy: 1 };
  const plan = { choices: { services: { web: { size: "s", instances: 1 }, api: { size: "s", instances: 1 } }, resources: {} } };
  const stepWith = (thing) => nextStep({ plan, needs, record, observed: [thing], release });

  const own = stepWith({ ...api, internalName: "shop-api.internal", internalUrl: "https://shop-api-abc123-uc.a.run.app" });
  assert.equal(own.kind, "createService");
  assert.equal(own.values.settings.API_URL, "https://shop-api-abc123-uc.a.run.app");
  // Given only internalUrl, it is enough to go on.
  assert.equal(stepWith({ ...api, internalUrl: "https://shop-api-abc123-uc.a.run.app" }).values.settings.API_URL, "https://shop-api-abc123-uc.a.run.app");
  // Without it, the address is made from the internal name and the port, as before.
  assert.equal(stepWith({ ...api, internalName: "shop-api.internal" }).values.settings.API_URL, "http://shop-api.internal:3000");
  // With neither, the Deploy waits for the reached service.
  assert.deepEqual(stepWith(api), { kind: "wait", words: "Waiting for the services web reaches" });
});

import assert from "node:assert/strict";
import test from "node:test";

import { planOf } from "../../packages/vibe64-deploy/src/plan.js";
import { workersStack } from "../fixtures/deployWorkersApp.js";
import { googleWorld } from "./deployGoogleHelpers.js";

// Google Cloud's offer, priced from the Cloud Billing Catalog (the stand-in's example list prices), and the Plan it
// gives the two-service app: Cloud Run shapes for web, whole machines for workers, Cloud SQL and Cloud Storage for the
// resources, and Google's refusals said plainly.

const BILLION = 1_000_000_000n;
const MONTH = 730n;

test("each size is priced from its SKUs, exactly: a month of always-on Cloud Run, an E2 machine with its disk, a Cloud SQL tier", async () => {
  const { adapter } = googleWorld();
  const offer = await adapter.offer();
  assert.deepEqual([offer.title, offer.currency], ["Google Cloud", "USD"]);
  // Its quotas aren't counted before a Deploy, and the Plan says so.
  assert.match(offer.quota.unchecked, /^Google Cloud's quotas aren't checked before a Deploy: /u);
  // Cloud Run: $0.000018 a vCPU-second and $0.000002 a GiB-second, past the free tier, for 730 hours.
  const run = offer.sizes.find((size) => size.name === "run-1-2");
  assert.equal(run.monthlyNano, String(MONTH * 3600n * (18_000n + 2n * 2_000n)));
  assert.ok(offer.sizes.every((size) => size.runsOn === "cloud run"));
  // e2-standard-4: 4 cores at $0.02181159 an hour, 16 GiB at $0.00292353, and a 50 GiB balanced disk at $0.10 a month.
  const machine = offer.machineSizes.find((size) => size.name === "e2-standard-4");
  assert.equal(machine.monthlyNano, String(MONTH * (4n * 21_811_590n + 16n * 2_923_530n) + 50n * 100_000_000n));
  assert.ok(offer.machineSizes.every((size) => size.runsOn === "compute engine" && size.bootDiskGib === 50));
  // db-custom-1-3840: a vCPU at $0.0413 an hour, 3.75 GiB at $0.007 (rounded up to a nano), 10 GiB at $0.17 a month.
  const tier = offer.resources.postgresql.sizes.find((size) => size.name === "db-custom-1-3840");
  assert.equal(tier.monthlyNano, String(MONTH * 41_300_000n + (MONTH * 7_000_000n * 375n + 99n) / 100n + 10n * 170_000_000n));
  assert.equal(offer.resources.postgresql.defaultSize, "db-custom-1-3840");
  // The load balancer: the forwarding rules' hourly minimum, $0.025.
  assert.equal(offer.balancer.monthlyNano, String(MONTH * 25_000_000n));
  assert.equal(BigInt(offer.balancer.monthlyNano) / BILLION, 18n);
});

test("a SKU the catalogue lacks in the region refuses the offer, naming it, rather than pricing at a guess", async () => {
  const { standIn, adapter } = googleWorld();
  standIn.catalog.removeSku("Services Memory (Instance-based billing) in us-central1");
  const refused = await adapter.offer().catch((error) => error);
  assert.equal(refused.code, "google_price_missing");
  assert.equal(refused.message, "Google's price list has no Cloud Run memory (instance-based billing) price in us-central1, which the offer needs to price its sizes.");
});

test("the Plan runs web on Cloud Run and workers on whole machines, priced; MySQL is MySQL itself, and Valkey is refused with its reason", async () => {
  const { adapter, record } = googleWorld();
  const offer = await adapter.offer();
  const { needs } = workersStack();
  const plan = planOf({ needs, record, observed: await adapter.inventory(), offer, choices: {}, decisions: {} });
  assert.deepEqual(plan.problems, []);
  const web = plan.services.find((service) => service.id === "web");
  const workers = plan.services.find((service) => service.id === "workers");
  assert.equal(web.sizes[0].name, "run-1-2");
  assert.ok(web.sizes.every((size) => size.runsOn === "cloud run"));
  assert.ok(workers.sizes.every((size) => size.runsOn === "compute engine" && size.vcpus >= 4 && size.memoryGib >= 16));
  assert.equal(workers.sizes[0].name, "e2-standard-4");
  // The Plan's lines: each service's instances at its size, web's load balancer, the database's tier, the bucket at 0.
  const line = (item, part) => plan.lines.find((one) => one.item === item && (!part || one.part === part));
  assert.equal(line("service.workers").monthlyNano, String(2n * BigInt(workers.sizes[0].monthlyNano)));
  assert.equal(line("service.web", "load balancer").monthlyNano, offer.balancer.monthlyNano);
  assert.equal(plan.resources.find((resource) => resource.id === "database").title, "Cloud SQL for PostgreSQL 16");

  // MySQL: the Plan names Cloud SQL for MySQL, saying Google runs no MariaDB.
  const mysql = workersStack(undefined, [{ component: "jskit-mysql", resource: { id: "database", kind: "mysql", environmentAlternatives: [{ preferred: true, bindings: { url: "DATABASE_URL" } }] } }]);
  const mysqlPlan = planOf({ needs: mysql.needs, record, observed: [], offer, choices: {}, decisions: {} });
  assert.deepEqual(mysqlPlan.problems, []);
  assert.equal(mysqlPlan.resources[0].title, "Cloud SQL for MySQL 8.4 (MySQL itself: Google Cloud runs no MariaDB)");

  // Valkey (redis): refused in the Plan, with Google's reason and the way on.
  const redis = workersStack(undefined, [{ component: "jskit-redis", resource: { id: "cache", kind: "redis", environmentAlternatives: [{ preferred: true, bindings: { url: "REDIS_URL" } }] } }]);
  const redisPlan = planOf({ needs: redis.needs, record, observed: [], offer, choices: {}, decisions: {} });
  assert.deepEqual(redisPlan.problems.map((problem) => problem.code), ["production_resource_unsupported"]);
  assert.match(redisPlan.problems[0].message, /^Google Cloud runs no redis for cache\. Memorystore for Valkey comes later on Google Cloud: remove the resource from genesis\/stack\.md/u);
});

import assert from "node:assert/strict";
import test from "node:test";

import { planOf } from "../../packages/vibe64-deploy/src/plan.js";
import { WORKERS_RESOURCES, workersStack } from "../fixtures/deployWorkersApp.js";
import { awsWorld } from "./deployAwsHelpers.js";

// AWS's offer, priced from the Price List (the stand-in's made-up list prices), and the Plan it gives the two-service
// app: Fargate shapes for web, whole machines for workers, RDS and S3 for the resources, and AWS's refusals said plainly.

const MONTH = 730n;

test("each size is priced from the Price List, exactly: Fargate with its address, a machine with its disk, RDS with its storage", async () => {
  const { adapter } = awsWorld();
  const offer = await adapter.offer();
  assert.deepEqual([offer.title, offer.currency], ["AWS", "USD"]);
  // Fargate: $0.04048 a vCPU-hour, $0.004445 a GB-hour and $0.005 an hour for the task's public IPv4 address.
  const fargate = offer.sizes.find((size) => size.name === "fargate-1x2");
  assert.equal(fargate.monthlyNano, String(MONTH * (40_480_000n + 2n * 4_445_000n + 5_000_000n)));
  assert.ok(offer.sizes.every((size) => size.runsOn === "fargate"));
  assert.deepEqual(offer.sizes.map((size) => size.name).slice(0, 3), ["fargate-1x2", "fargate-1x4", "fargate-2x4"]);
  // m7i.xlarge: $0.2016 an hour, its address, and its 40 GiB gp3 root disk at $0.08 a GiB-month.
  const machine = offer.machineSizes.find((size) => size.name === "m7i.xlarge");
  assert.equal(machine.monthlyNano, String(MONTH * (201_600_000n + 5_000_000n) + 40n * 80_000_000n));
  assert.ok(offer.machineSizes.every((size) => size.runsOn === "ec2" && size.bootDiskGib === 40));
  // db.t4g.small for PostgreSQL: $0.032 an hour and 20 GiB of gp3 at $0.115; with a standby copy, both twice.
  const postgresql = offer.resources.postgresql;
  assert.deepEqual([postgresql.title, postgresql.defaultSize], ["Amazon RDS for PostgreSQL", "db.t4g.small"]);
  assert.equal(postgresql.sizes.find((size) => size.name === "db.t4g.small").monthlyNano, String(MONTH * 32_000_000n + 20n * 115_000_000n));
  const standby = postgresql.sizes.find((size) => size.name === "db.t4g.small.multi-az");
  assert.deepEqual([standby.standbyCopy, standby.monthlyNano], [true, String(MONTH * 64_000_000n + 20n * 230_000_000n)]);
  // mysql is MariaDB's price list, not MySQL's.
  assert.equal(offer.resources.mysql.title, "Amazon RDS for MariaDB");
  assert.equal(offer.resources.mysql.sizes.find((size) => size.name === "db.t4g.small").monthlyNano, String(MONTH * 30_400_000n + 20n * 115_000_000n));
  // The load balancer by the hour; a bucket billed as used; Valkey refused with its reason.
  assert.deepEqual(offer.balancer, { monthlyNano: String(MONTH * 22_500_000n) });
  assert.deepEqual(offer.resources.bucket, { title: "Amazon S3", defaultSize: "standard", sizes: [{ name: "standard", monthlyNano: "0" }] });
  assert.match(offer.unsupported.redis, /^Vibe64 doesn't make Valkey \(ElastiCache\) at AWS yet/u);
});

test("a price the Price List lacks refuses the offer, naming it, rather than pricing at a guess; a machine type it lacks is left out", async () => {
  for (const [pattern, words] of [[/Fargate-vCPU-Hours/u, "Fargate vCPU-hour and GB-hour price"], [/PublicIPv4:InUseAddress/u, "public IPv4 address price"],
    [/EBS:VolumeUsage\.gp3/u, "gp3 disk price"], [/LoadBalancerUsage/u, "Application Load Balancer hourly price"], [/RDS:GP3-Storage/u, "Amazon RDS for PostgreSQL Single-AZ gp3 storage price"]]) {
    const { standIn, adapter } = awsWorld();
    standIn.dropPrices(pattern);
    const refused = await adapter.offer().catch((error) => error);
    assert.deepEqual([refused.code, refused.retryable], ["aws_price_missing", false], words);
    assert.equal(refused.message, `AWS's Price List has no ${words} in us-east-1, so Vibe64 can't price this offer there; deploy in another region.`);
  }
  const { standIn, adapter } = awsWorld();
  standIn.dropPrices(/BoxUsage:c7i\.xlarge$/u);
  const offer = await adapter.offer();
  assert.deepEqual(offer.machineSizes.map((size) => size.name), ["m7i.large", "m7i.xlarge", "c7i.2xlarge", "m7i.2xlarge", "c7i.4xlarge", "m7i.4xlarge"]);
});

test("the Plan runs web on Fargate and workers on whole machines, priced; mysql is RDS for MariaDB, and redis is refused with its reason", async () => {
  const { adapter, record } = awsWorld();
  const offer = await adapter.offer();
  const plan = (stack) => planOf({ needs: stack.needs, record, observed: [], offer, choices: {}, decisions: {} });

  const workers = plan(workersStack());
  assert.deepEqual(workers.problems, []);
  // web needs 1 vCPU and 2 GiB: Fargate's smallest. workers need 4 and 16 and a sandbox: a machine, never Fargate.
  assert.deepEqual([workers.choices.services.web.size, workers.choices.services.workers.size], ["fargate-1x2", "m7i.xlarge"]);
  assert.deepEqual(workers.lines.map((line) => [line.item, line.part]), [
    ["service.web", "instances"], ["service.web", "load balancer"], ["service.workers", "instances"], ["resource.database", "postgresql"], ["resource.files", "bucket"]
  ]);
  const fargate = BigInt(offer.sizes.find((size) => size.name === "fargate-1x2").monthlyNano);
  const machine = BigInt(offer.machineSizes.find((size) => size.name === "m7i.xlarge").monthlyNano);
  const database = BigInt(offer.resources.postgresql.sizes.find((size) => size.name === "db.t4g.small").monthlyNano);
  assert.equal(workers.monthlyNano, String(2n * fargate + BigInt(offer.balancer.monthlyNano) + 2n * machine + database));

  const mysql = plan(workersStack(undefined, WORKERS_RESOURCES.map((one) => (one.resource.kind === "postgresql" ? { component: "jskit-mysql", resource: { ...one.resource, kind: "mysql" } } : one))));
  assert.deepEqual(mysql.problems, []);
  assert.equal(mysql.resources.find((one) => one.id === "database").title, "Amazon RDS for MariaDB");

  const redis = plan(workersStack(undefined, [...WORKERS_RESOURCES, { component: "jskit-redis", resource: { id: "cache", kind: "redis", environmentAlternatives: [{ preferred: true, bindings: { url: "CACHE_URL" } }] } }]));
  assert.deepEqual(redis.problems.map((one) => one.code), ["production_resource_unsupported"]);
  assert.equal(redis.problems[0].message, `AWS runs no redis for cache. ${offer.unsupported.redis}`);
});

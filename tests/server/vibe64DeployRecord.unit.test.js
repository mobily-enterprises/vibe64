import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AT, HOST, SHOP, settle, upload, webSpec, world } from "./vibe64DeployStandInHelpers.js";
import { createRecordStore, labelsFor, newRecord, rebuildFromLabels } from "../../packages/vibe64-deploy/src/record.js";

// The deploy engine's record: the file in the editor's private state, kept only over the revision its writer read,
// and the record made again from the labels on what was made in a mobilynet project (the stand-in).

/** A store in a folder of its own, removed after the test. */
function storeFor(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "vibe64-deploy-record-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, store: createRecordStore({ root, now: () => AT }) };
}

/** A record of the shop's Production with one service made. */
function shopRecord() {
  const record = newRecord({ app: "shop", environment: "production", provider: { id: "mobilynet", project: "prj_1" } });
  record.items["service.web"] = { kind: "service", name: "web", id: "svc_1", providerName: "web", origin: "made", size: "a-2" };
  record.choices.services.web = { size: "a-2" };
  return record;
}

test("the record file is kept only over the revision its writer read, one file per project and environment", async (t) => {
  const { root, store } = storeFor(t);
  const where = { project: "shop/main", environment: "production" };
  assert.equal(await store.read(where), null);
  const record = shopRecord();
  assert.match(record.deploymentId, /^dep_[a-z2-7]{16}$/u);
  const first = await store.write({ ...where, record, expectedRevision: 0 });
  assert.deepEqual([first.revision, first.updatedAt], [1, AT.toISOString()]);
  assert.deepEqual(await store.read(where), first);
  const file = path.join(root, encodeURIComponent("shop/main"), "production.json");
  assert.equal(store.fileOf(where.project, where.environment), file);
  assert.equal(statSync(file).mode & 0o777, 0o600, "the editor's private state");

  const stale = await store.write({ ...where, record: { ...first, choices: { services: {}, resources: {} } }, expectedRevision: 0 }).catch((error) => error);
  assert.deepEqual([stale.code, stale.details], ["deployment_record_stale", { expected: 0, current: 1 }]);
  assert.deepEqual(await store.read(where), first, "a stale write changes nothing");
  const second = await store.write({ ...where, record: { ...first, lastPlan: { hash: "h1" } }, expectedRevision: 1 });
  assert.deepEqual([second.revision, second.lastPlan], [2, { hash: "h1" }]);

  const racing = await Promise.allSettled([1, 2].map((attempt) => store.write({ ...where, record: { ...second, lastPlan: { hash: `race-${attempt}` } }, expectedRevision: 2 })));
  assert.deepEqual(racing.map((one) => one.status).sort(), ["fulfilled", "rejected"], "of two writers that read the same revision, one is refused");
  assert.equal(racing.find((one) => one.status === "rejected").reason.code, "deployment_record_stale");
  assert.equal((await store.read(where)).revision, 3);

  assert.equal(await store.read({ ...where, environment: "staging" }), null, "each environment its own");
  const staging = await store.write({ project: where.project, environment: "staging", record: { ...shopRecord(), environment: "staging" }, expectedRevision: 0 });
  assert.equal(staging.revision, 1);
  assert.equal((await store.read(where)).revision, 3);

  const twice = { ...second, items: { ...second.items, "resource.database": { kind: "resource", name: "database", id: "svc_1", providerName: "db", origin: "made", size: "small" } } };
  const sameThing = await store.write({ ...where, record: twice, expectedRevision: 3 }).catch((error) => error);
  assert.deepEqual([sameThing.code, sameThing.message], ["deployment_record_invalid", "record.items.resource.database and record.items.service.web record the same thing, svc_1."]);
  const misfiled = { ...second, items: { "service.api": { ...second.items["service.web"] } } };
  assert.equal((await store.write({ ...where, record: misfiled, expectedRevision: 3 }).catch((error) => error)).code, "deployment_record_invalid");
  const elsewhere = await store.write({ ...where, record: { ...second, environment: "staging" }, expectedRevision: 3 }).catch((error) => error);
  assert.equal(elsewhere.code, "deployment_record_invalid");
  assert.equal((await store.read(where)).revision, 3, "nothing invalid is kept");
  assert.deepEqual(readdirSync(path.dirname(file)).sort(), ["production.json", "staging.json"], "no file is left half written");
  assert.throws(() => createRecordStore({ root: "relative" }), /absolute folder/u);
});

/** What the steps make for the shop: two services and two hosted services, each labelled, and the record they write. */
async function deployShop(parts, record) {
  const { standIn, production } = parts;
  await production.createDomain(HOST, { idempotencyKey: "domain-shop" });
  standIn.verifyDomain(HOST, parts.projectId);
  const { release } = await production.createRelease("shop", upload(SHOP, "1"));
  const services = [
    ["web", webSpec(release.version)],
    ["computers", webSpec(release.version, { name: "computers", exposure: "internal", routes: [], size: "a-8", instances: 1 })]
  ];
  for (const [name, spec] of services) {
    const { service } = await production.createService({ ...spec, labels: labelsFor(record, { kind: "service", name }) }, { idempotencyKey: `service-${name}` });
    record.items[`service.${name}`] = { kind: "service", name, id: service.id, providerName: service.name, origin: "made", size: spec.size };
    record.choices.services[name] = { size: spec.size };
  }
  for (const [name, app, size] of [["database", "postgresql-18", "small"], ["files", "garage-2", "medium"]]) {
    const { hostedService } = await production.createHostedService({ app, size, labels: labelsFor(record, { kind: "resource", name }) }, { idempotencyKey: `hosted-${name}` });
    record.items[`resource.${name}`] = { kind: "resource", name, id: hostedService.id, providerName: hostedService.name, origin: "made", size };
    record.choices.resources[name] = { size };
  }
  settle(standIn);
  return record;
}

/** The mobilynet adapter's inventory, as the engine's adapter answers it: the project's services and hosted services with their labels. */
function adapterOf(client) {
  return {
    provider: "mobilynet",
    inventory: async ({ project }) => [
      ...(await client.project(project).listServices()).map((one) => ({ id: one.id, name: one.name, labels: one.labels, size: one.size, instances: one.instances.wanted })),
      ...(await client.project(project).listHostedServices()).map((one) => ({ id: one.id, name: one.name, labels: one.labels, size: one.size }))
    ]
  };
}

test("rebuildFromLabels makes the record again from the labels on what was made, two deployments in one project kept apart by their ids", async (t) => {
  const parts = world();
  const { standIn, production, projectId, client } = parts;
  const { store } = storeFor(t);
  const written = await store.write({
    project: "shop",
    environment: "production",
    record: await deployShop(parts, newRecord({ app: "shop", environment: "production", provider: { id: "mobilynet", project: projectId } })),
    expectedRevision: 0
  });
  const blog = newRecord({ app: "blog", environment: "production", provider: { id: "mobilynet", project: projectId } });
  const { hostedService: cache } = await production.createHostedService({ app: "valkey-9", labels: labelsFor(blog, { kind: "resource", name: "cache" }) }, { idempotencyKey: "hosted-blog-cache" });
  await production.createHostedService({ app: "valkey-9", name: "by-hand", labels: { team: "ops" } }, { idempotencyKey: "hosted-by-hand" });
  settle(standIn);

  const adapter = adapterOf(client);
  const rebuilt = await rebuildFromLabels(adapter, projectId);
  assert.deepEqual(rebuilt.map((one) => one.deploymentId), [written.deploymentId, blog.deploymentId].sort());
  const shop = rebuilt.find((one) => one.deploymentId === written.deploymentId);
  const facts = ({ format, app, environment, deploymentId, provider, items, choices }) => ({ format, app, environment, deploymentId, provider, items, choices });
  assert.deepEqual(facts(shop), facts(written), "the record rebuilt equals the record written: sizes, never a count, which mobilynet holds");
  assert.deepEqual([shop.revision, shop.approvals, shop.lastPlan], [0, {}, null], "what labels can't carry starts empty");
  const other = rebuilt.find((one) => one.deploymentId === blog.deploymentId);
  assert.deepEqual([other.app, Object.keys(other.items), other.items["resource.cache"].id, other.choices], ["blog", ["resource.cache"], cache.id, { services: {}, resources: { cache: { size: "small" } } }]);
  assert.ok(rebuilt.every((one) => Object.values(one.items).every((item) => item.providerName !== "by-hand")), "a thing without Vibe64's labels is not Vibe64's");
  assert.deepEqual((await rebuildFromLabels(adapter, projectId, { app: "shop" })).map((one) => one.deploymentId), [written.deploymentId]);
  assert.deepEqual(await rebuildFromLabels(adapter, projectId, { environment: "staging" }), []);

  await production.createHostedService({ app: "postgresql-18", labels: labelsFor(written, { kind: "resource", name: "database" }) }, { idempotencyKey: "hosted-copy" });
  const conflict = await rebuildFromLabels(adapter, projectId).catch((error) => error);
  assert.deepEqual([conflict.code, conflict.details.item], ["deployment_labels_conflict", "resource.database"], "two things labelled as one item are refused, never guessed");
});

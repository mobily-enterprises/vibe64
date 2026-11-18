import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { createMobilynetClient } from "../../packages/vibe64-deploy/src/adapters/mobilynet/client.js";
import { servicePackages } from "../../packages/vibe64-deploy/src/adapters/mobilynet/declaration.js";
import { createMobilynetAdapter } from "../../packages/vibe64-deploy/src/adapters/mobilynet/index.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { settingsPerService, withRootFile } from "../../packages/vibe64-deploy/src/package.js";
import { planOf } from "../../packages/vibe64-deploy/src/plan.js";
import { LABEL, createRecordStore, newRecord, rebuildFromLabels } from "../../packages/vibe64-deploy/src/record.js";
import { applyStep, deleteResource, deploy, nextStep, takeOffline } from "../../packages/vibe64-deploy/src/steps.js";
import { MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES } from "../fixtures/deploymentServices.js";
import { runningShop, settle, world } from "./vibe64DeployStandInHelpers.js";

// A two-service app deployed through the engine alone, against mobilynet's stand-in, with no database: the record is
// the steps' own, the stand-in's request log what mobilynet was asked.
const DOMAIN = "memobot.example.com";
const HOLDER = "Vibe64 on laptop";

/** The two-service Stack's inspection and needs, its lines changed by `edit`, with these resources. */
function stackOf(edit = (lines) => lines, resources = MEMOBOT_RESOURCES) {
  const deployment = vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources },
    section: { status: "ready", stackHash: "sha256:stack", lines: edit([...MEMOBOT_DEPLOYMENT_LINES]), components: [], source: "project" }
  });
  return { deployment, needs: needsOfStack(deployment, { preferredAlternative, resourceKindIsDatabase }).needs };
}

const ENV_RECORDS = [
  { key: "STRIPE_SECRET_KEY", secret: true, services: ["web"] },
  { key: "MEMOBOT_OWNERS", secret: false },
  { key: "MEMOBOT_MAX_COMPUTERS", secret: false, services: ["computers"] }
];
const ENV = {
  AUTH_LOCAL_SESSION_SECRET: "session-1", MEMOBOT_VAULT_KEY: "vault-1", AUTH_LOCAL_SECOND_FACTOR_KEY: "second-1",
  MEMOBOT_FILES_PASSPHRASE: "files-1", MEMOBOT_COMPUTERS_SECRET: "computers-1", AUTH_LOCAL_SETUP_CODE: "setup-1",
  STRIPE_SECRET_KEY: "sk_test_1", MEMOBOT_OWNERS: "owner@example.com", MEMOBOT_MAX_COMPUTERS: "4"
};

/** A release of a commit: the archive (one file naming the commit) and each service's declaration and settings. */
function releaseOf(commit, { deployment, needs }) {
  const settings = settingsPerService(needs, ENV_RECORDS.filter((record) => needs.services.some((one) => (record.services ?? ["web"]).includes(one.id))));
  const { declarations } = servicePackages({ app: "memobot", deployment, needs, settings });
  return { id: commit, archive: withRootFile(gzipSync(Buffer.alloc(1024)), "commit.txt", commit).bytes, declarations, settings, env: ENV, domain: DOMAIN };
}

/** The stand-in with a verified-later domain, the adapter over it (leases on), and a Deploy helper that plans first. */
function setup() {
  const parts = world();
  // Room for two a-8 computers (three when raised by hand), two a-2 webs and their rolling replacements.
  parts.standIn.setQuota(parts.projectId, { vcpus: 96, memoryGib: 192 });
  const adapter = createMobilynetAdapter({ client: parts.client, project: parts.projectId, leases: true });
  const run = async ({ stack = stackOf(), record, commit, choices = {}, decisions = {}, planHash, save, pause = () => parts.standIn.advance() }) => {
    const plan = planOf({ needs: stack.needs, record, observed: await adapter.inventory(), offer: await adapter.offer(), choices, decisions });
    const result = await deploy({
      adapter, needs: stack.needs, record, choices, decisions, planHash: planHash ?? plan.hash, release: releaseOf(commit, stack), holder: HOLDER,
      pause, ...(save ? { save } : {})
    });
    return { ...result, plan };
  };
  return { ...parts, adapter, run, record: newRecord({ app: "memobot", environment: "production", provider: { id: "mobilynet", project: parts.projectId } }) };
}

const requestsAfter = (standIn, count) => standIn.requests().slice(count);
/** The names of an instance's settings and secrets that start with `prefix`: a link's, for a need's prefix. */
const namesOf = (instance, prefix) => [...Object.keys(instance.settings), ...Object.keys(instance.secrets)].filter((name) => name.startsWith(prefix));
const isWrite = (request) => request.method !== "GET";

test("a two-service deploy makes both App Services and both hosted services, labelled, linked, connected and given their own settings", async (t) => {
  const parts = setup();
  const { standIn, run, record } = parts;
  // An App Service someone made by hand in the same mobilynet project: never touched.
  const { serviceId: hand } = await runningShop(parts);
  const before = standIn.requests().length;
  // The record kept in the store after every step, each write over the revision the last one left.
  const root = await mkdtemp(path.join(tmpdir(), "deploy-steps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createRecordStore({ root });
  const save = (kept) => store.write({ project: "memobot", environment: "production", record: kept, expectedRevision: kept.revision });

  const first = await run({ record, commit: "c1", save });
  assert.equal(first.outcome, "live", first.message);
  assert.deepEqual(await store.read({ project: "memobot", environment: "production" }), first.record);
  assert.equal((await stat(store.fileOf("memobot", "production"))).mode & 0o777, 0o600);
  assert.deepEqual(first.plan.items.map((item) => item.verb), ["new", "new", "new", "new"]);
  const { items } = first.record;
  const web = standIn.services.service(items["service.web"].id);
  const computers = standIn.services.service(items["service.computers"].id);
  const database = standIn.hosted.service(items["resource.database"].id);
  const files = standIn.hosted.service(items["resource.files"].id);

  // Two App Services: web public at the domain, computers internal with no routes; web reaches computers on 3000.
  assert.deepEqual([web.name, web.exposure, web.routes.map((route) => route.host), web.size, web.instances.wanted], ["memobot-web", "public", [DOMAIN], "a-2", 2]);
  assert.deepEqual([computers.name, computers.exposure, computers.routes, computers.size, computers.instances.wanted], ["memobot-computers", "internal", [], "a-8", 2]);
  assert.equal(standIn.services.reaches(web.id, computers.id, 3000), true);
  assert.equal(standIn.services.reaches(computers.id, web.id, 3000), false);
  // Two hosted services, each linked to both App Services under its need.
  assert.deepEqual([database.app, database.name, files.app, files.name], ["postgresql-18", "memobot-database", "garage-2", "memobot-files"]);
  for (const hosted of [database, files]) {
    assert.deepEqual(hosted.links.filter((link) => link.state === "active").map((link) => [link.consumer.id, link.need]).sort(),
      [[computers.id, hosted === database ? "V64_DATABASE" : "V64_FILES"], [web.id, hosted === database ? "V64_DATABASE" : "V64_FILES"]].sort());
  }
  // Every thing made carries the deployment's labels.
  for (const [thing, item] of [[web, "service.web"], [computers, "service.computers"], [database, "resource.database"], [files, "resource.files"]]) {
    assert.deepEqual(thing.labels, { [LABEL.deployment]: record.deploymentId, [LABEL.app]: "memobot", [LABEL.environment]: "production", [LABEL.item]: item });
  }
  // Settings per service: the generated secret the same on both, Stripe and the setup code only on web, computers' own
  // entry only on computers, web given computers' private address.
  assert.equal(web.secrets.MEMOBOT_VAULT_KEY, "vault-1");
  assert.equal(computers.secrets.MEMOBOT_VAULT_KEY, "vault-1");
  assert.deepEqual([web.secrets.STRIPE_SECRET_KEY, web.secrets.AUTH_LOCAL_SETUP_CODE, computers.secrets.STRIPE_SECRET_KEY, computers.secrets.AUTH_LOCAL_SETUP_CODE],
    ["sk_test_1", "setup-1", undefined, undefined]);
  assert.deepEqual([web.settings.MEMOBOT_MAX_COMPUTERS, computers.settings.MEMOBOT_MAX_COMPUTERS, web.settings.MEMOBOT_OWNERS], [undefined, "4", "owner@example.com"]);
  assert.equal(web.settings.MEMOBOT_COMPUTERS_URL, `http://${computers.internalName}:3000`);
  assert.deepEqual([web.settings.APP_ENV, web.settings.PORT, web.settings.APP_PUBLIC_URL], ["production", "3000", `https://${DOMAIN}`]);
  // Linked while each service's first refresh was under way, so its first instances started with both resources and
  // no settings refresh followed.
  for (const service of [web, computers]) {
    assert.deepEqual(standIn.services.refreshes(service.id).map((one) => one.kind), ["create"]);
    const started = standIn.services.instances(service.id).filter((one) => one.removedReason !== "link_added");
    assert.ok(started.length >= 2 && started.every((one) => namesOf(one, "V64_DATABASE_").length > 0 && namesOf(one, "V64_FILES_").length > 0));
  }
  // The lease was taken, renewed at each step and given up; nothing unlabelled was asked about but by listing.
  const asked = requestsAfter(standIn, before);
  assert.ok(asked.some((request) => request.method === "POST" && request.path === "/v1/leases"));
  assert.ok(asked.some((request) => request.method === "PATCH" && request.path.startsWith("/v1/leases/")));
  assert.deepEqual(standIn.leases(), []);
  assert.deepEqual(asked.filter((request) => request.path.includes(hand) || JSON.stringify(request.body ?? {}).includes(hand)), []);
  assert.equal(standIn.services.service(hand).state, "running");
  // Every write that names a thing names one this deployment made and labelled.
  const ours = new Set([...standIn.services.all(), ...standIn.hosted.all()].filter((one) => one.labels?.[LABEL.deployment] === record.deploymentId).map((one) => one.id));
  const named = asked.filter(isWrite).flatMap((request) => request.path.match(/\b(svc|hs)_[A-Za-z0-9]+/gu) ?? []);
  assert.ok(named.length >= 4, "the four links at least");
  assert.deepEqual(named.filter((id) => !ours.has(id)), []);
  // The record the steps kept equals the one its labels make again, but for what labels can't carry.
  const [rebuilt, ...others] = await rebuildFromLabels(setupAdapterOf(standIn), standIn.projectId, { app: "memobot", environment: "production" });
  assert.deepEqual(others, []);
  assert.deepEqual(Object.fromEntries(Object.entries(rebuilt.items).map(([key, item]) => [key, item.id])),
    Object.fromEntries(Object.entries(first.record.items).map(([key, item]) => [key, item.id])));
  assert.deepEqual(rebuilt.choices, first.record.choices);
});

/** An adapter over the stand-in without leases, for reads. */
function setupAdapterOf(standIn) {
  const client = createMobilynetClient({ baseUrl: standIn.baseUrl, credential: standIn.key, fetch: standIn.fetch });
  return createMobilynetAdapter({ client, project: standIn.projectId });
}

test("a new commit moves computers then web; a failing computers build fails with its reason while both keep their versions", async () => {
  const { standIn, client, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const { items } = first.record;
  const before = standIn.requests().length;
  // computers is in a settings refresh of its own when the Deploy starts, so its release is queued behind it: web is
  // handed its release only once computers' release went live.
  const held = standIn.services.service(items["service.computers"].id);
  const ownOf = (values) => Object.fromEntries(Object.entries(values).filter(([name]) => !/^V64_(DATABASE|FILES)_/u.test(name)));
  await client.putServiceSettings(held.id, { settings: ownOf(held.settings), secrets: ownOf(held.secrets) });
  let webTooSoon = false;
  const pause = () => {
    const releaseOf = (id) => standIn.services.refreshes(id).filter((one) => one.kind === "release").at(-1);
    if (releaseOf(items["service.web"].id) && releaseOf(items["service.computers"].id)?.state !== "succeeded") webTooSoon = true;
    standIn.advance();
  };
  const second = await run({ record: first.record, commit: "c2", pause });
  assert.equal(second.outcome, "live", second.message);
  assert.equal(webTooSoon, false);
  assert.deepEqual(second.plan.items.map((item) => item.verb), ["kept", "kept", "kept", "kept"]);
  const releases = requestsAfter(standIn, before).filter((request) => request.method === "POST" && /\/services\/[^/]+\/releases$/u.test(request.path));
  assert.deepEqual(releases.map((request) => request.path.split("/")[3]), [items["service.computers"].id, items["service.web"].id], "computers first, then web");
  // No hosted service made again, and nothing deleted.
  assert.deepEqual(requestsAfter(standIn, before).filter((request) => (request.method === "DELETE" && !request.path.startsWith("/v1/leases/"))
    || (request.method === "POST" && request.path.endsWith("/hosted-services"))), []);
  const versions = () => [items["service.web"].id, items["service.computers"].id].map((id) => standIn.services.service(id).version);
  const served = versions();

  // computers' build fails: the Deploy fails with its reason, web is never handed the release, both serve as before.
  standIn.faults.releaseBuildFails = true;
  const at = standIn.requests().length;
  const failed = await run({ record: second.record, commit: "c3" });
  assert.equal(failed.outcome, "failed");
  assert.match(failed.message, /^computers: the release did not go live: The release's build or its check failed\. The version before \(.+\) still serves\.$/u);
  assert.deepEqual(requestsAfter(standIn, at).filter((request) => request.method === "POST" && request.path.endsWith(`/services/${items["service.web"].id}/releases`)), []);
  for (let step = 0; step < 10; step += 1) standIn.advance();
  assert.deepEqual(versions(), served);
  assert.deepEqual(standIn.leases(), [], "the lease is given up when a Deploy fails too");
});

test("a dropped resource is unlinked and kept, a dropped service deleted; a count changed by hand is put back; take offline keeps the data; deleting a resource is its own action", async () => {
  const { standIn, client, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const { items } = first.record;

  // computers raised to 3 by hand: the plan asks; put back, the Deploy sets 2 again.
  await client.changeService(items["service.computers"].id, { instances: 3 });
  const undecided = await run({ record: first.record, commit: "c2" }).catch((error) => error);
  assert.equal(undecided.code, "deployment_plan_refused");
  assert.match(undecided.message, /^computers: 3 instances at mobilynet, 2 in your choices\./u);
  const putBack = await run({ record: first.record, commit: "c2", decisions: { "service.computers.instances": "putBack" } });
  assert.equal(putBack.outcome, "live", putBack.message);
  assert.equal(standIn.services.service(items["service.computers"].id).instances.wanted, 2);
  // Raised by hand again and put back again by a Deploy of the same commit: the same change asked again is made
  // again, not answered with the first Deploy's answer.
  await client.changeService(items["service.computers"].id, { instances: 3 });
  const back = await run({ record: putBack.record, commit: "c2", decisions: { "service.computers.instances": "putBack" } });
  assert.equal(back.outcome, "live", back.message);
  assert.equal(standIn.services.service(items["service.computers"].id).instances.wanted, 2);

  // The Stack drops computers and renames files to uploads: computers deleted, files unlinked and kept running.
  const dropped = stackOf((lines) => lines.slice(0, lines.indexOf("### Service `computers`: bots' computers, each desktop in its own gVisor sandbox"))
    .filter((line) => !line.startsWith("- Reaches:")), [MEMOBOT_RESOURCES[0], { ...MEMOBOT_RESOURCES[1], resource: { ...MEMOBOT_RESOURCES[1].resource, id: "uploads" } }]);
  const at = standIn.requests().length;
  const third = await run({ stack: dropped, record: back.record, commit: "c3" });
  assert.equal(third.outcome, "live", third.message);
  settle(standIn);
  assert.deepEqual(Object.fromEntries(third.plan.items.map((item) => [item.name, item.verb])), { web: "kept", database: "kept", uploads: "new", computers: "removed", files: "disconnected" });
  const files = standIn.hosted.service(items["resource.files"].id);
  assert.equal(files.state, "running");
  // uploads was linked to web while web's new release rolled, so that release's instances started with it.
  const rolled = standIn.services.refreshes(items["service.web"].id).find((one) => one.kind === "release" && one.toVersion === third.record.run.services.web.version);
  const rolledInstances = standIn.services.instances(items["service.web"].id).filter((one) => one.refreshId === rolled.id && one.removedReason !== "link_added");
  assert.ok(rolledInstances.length > 0 && rolledInstances.every((one) => namesOf(one, "V64_UPLOADS_").length > 0));
  assert.deepEqual(standIn.services.service(items["service.web"].id).connections, [], "web no longer reaches computers");
  assert.deepEqual(files.links.filter((link) => link.state === "active"), [], "files is linked to nothing");
  assert.equal(standIn.services.service(items["service.computers"].id).state === "deleted" || standIn.services.service(items["service.computers"].id).state === "deleting", true);
  assert.deepEqual(requestsAfter(standIn, at).filter((request) => request.method === "DELETE" && request.path.includes("/hosted-services/") && !request.path.includes("/links/")), [],
    "a Deploy never deletes a hosted service");

  // Take offline: the services go, every hosted service stays with its data.
  const offline = await takeOffline(setupAdapterOf(standIn), third.record);
  for (let step = 0; step < 10; step += 1) standIn.advance();
  assert.deepEqual(Object.keys(offline.items).sort(), ["resource.database", "resource.files", "resource.uploads"]);
  assert.ok([items["resource.database"].id, items["resource.files"].id].every((id) => standIn.hosted.service(id).state === "running"));

  // Deleting a resource and its data is its own action: refused while the Stack names it or the name isn't typed.
  const adapter = setupAdapterOf(standIn);
  await assert.rejects(deleteResource(adapter, offline, dropped.needs, { name: "database", typed: "database" }), { code: "deployment_resource_in_use" });
  await assert.rejects(deleteResource(adapter, offline, dropped.needs, { name: "files", typed: "file" }), { code: "deployment_confirmation_wrong" });
  const left = await deleteResource(adapter, offline, dropped.needs, { name: "files", typed: "files" });
  assert.equal("resource.files" in left.items, false);
  assert.equal(standIn.hosted.service(items["resource.files"].id).state, "deleted");
});

test("a first release that fails ends the links made against it, and the next Deploy makes them again", async () => {
  const { standIn, adapter, run, record } = setup();
  standIn.faults.releaseBuildFails = true;
  const failed = await run({ record, commit: "c1" });
  standIn.faults.releaseBuildFails = false;
  assert.equal(failed.outcome, "failed");
  assert.match(failed.message, /^computers: the release did not go live: The release's build or its check failed\.$/u);
  assert.deepEqual([failed.record.items["resource.database"].links, failed.record.items["resource.files"].links], [{}, {}]);
  // A link refused because the refresh it was to be made against ended first is left for the next step, which reads
  // how that refresh ended; computers now runs no release and has no refresh ahead.
  const late = structuredClone(failed.record);
  late.run = { ...late.run, id: "run_next", services: { computers: { ...late.run.services.computers, refreshId: "rfr_ended" } } };
  const step = { kind: "link", resource: "database", id: late.items["resource.database"].id, service: "computers", serviceId: late.items["service.computers"].id };
  const { record: after } = await applyStep(adapter, step, { record: late, needs: stackOf().needs, plan: failed.plan, release: null });
  assert.deepEqual(after.items["resource.database"].links, {});
  settle(standIn);
  const fixed = await run({ record: failed.record, commit: "c2" });
  assert.equal(fixed.outcome, "live", fixed.message);
  for (const item of ["resource.database", "resource.files"]) {
    const held = standIn.hosted.service(fixed.record.items[item].id).links.filter((link) => ["issuing", "active"].includes(link.state));
    assert.deepEqual(held.map((link) => link.consumer.id).sort(), [fixed.record.items["service.computers"].id, fixed.record.items["service.web"].id].sort());
    assert.deepEqual(Object.values(fixed.record.items[item].links).sort(), held.map((link) => link.id).sort());
  }
});

test("a service whose last refresh failed (a link's, after its release went live) is not live, naming it", async () => {
  const { adapter, run, record } = setup();
  const stack = stackOf();
  const first = await run({ stack, record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const release = { ...releaseOf("c1", stack), port: adapter.servicePort, trustedProxies: await adapter.trustedProxies() };
  const observed = await adapter.inventory();
  const next = (things) => nextStep({ plan: first.plan, needs: stack.needs, record: first.record, observed: things, release });
  assert.deepEqual(next(observed), { kind: "live" });
  // computers runs this Deploy's release, but the refresh its link's settings started failed, so mobilynet kept its
  // instances before: not live, and the Deploy fails naming it.
  const failed = observed.map((thing) => (thing.id === first.record.items["service.computers"].id
    ? { ...thing, lastError: { code: "instance_never_healthy", message: "A new instance never became healthy; the previous version kept serving." } } : thing));
  assert.deepEqual(next(failed), { kind: "failed", message: "computers: A new instance never became healthy; the previous version kept serving." });
  // While that refresh is still under way, the Deploy waits.
  const working = failed.map((thing) => (thing.lastError ? { ...thing, refresh: { id: "rfr_x", kind: "settings", state: "rolling" } } : thing));
  assert.equal(next(working).kind, "wait");
});

test("a Deploy cut short between a create or a link and keeping its record is made whole by the next: nothing is made twice", async () => {
  const { standIn, run, record } = setup();
  let kept = record;
  /** Keeps each record until `when` first holds, then stops the Deploy there, as a crash would. */
  const cutWhen = (when) => {
    let cut = false;
    return (next) => {
      if (!cut && when(next)) {
        cut = true;
        throw new Error("cut short");
      }
      kept = next;
      return next;
    };
  };
  const linked = (next) => Object.values(next.items).some((item) => Object.keys(item.links ?? {}).length > 0);
  for (const when of [(next) => next.items["resource.database"], (next) => next.items["service.computers"], linked]) {
    await assert.rejects(run({ record: kept, commit: "c1", save: cutWhen(when) }), /^Error: cut short$/u);
  }
  assert.equal(kept.items["resource.database"].id.startsWith("hs_"), true, "the second Deploy adopted the database");
  const last = await run({ record: kept, commit: "c1" });
  assert.equal(last.outcome, "live", last.message);
  // One thing per item, each hosted service linked once to each service.
  const ours = [...standIn.services.all(), ...standIn.hosted.all()].filter((one) => one.state !== "deleted" && one.labels?.[LABEL.deployment] === record.deploymentId);
  assert.deepEqual(ours.map((one) => one.labels[LABEL.item]).sort(), ["resource.database", "resource.files", "service.computers", "service.web"]);
  for (const hosted of standIn.hosted.all().filter((one) => one.labels?.[LABEL.deployment] === record.deploymentId)) {
    assert.deepEqual(hosted.links.filter((link) => link.state !== "revoked").map((link) => link.consumer.id).sort(),
      [last.record.items["service.computers"].id, last.record.items["service.web"].id].sort());
  }
  assert.deepEqual(standIn.leases(), []);
});

test("a Deploy is refused when its plan is stale, and while another Vibe64 holds its lease, naming who", async () => {
  const { standIn, client, run, record } = setup();
  await assert.rejects(run({ record, commit: "c1", planHash: "sha256:old" }), { code: "deployment_plan_stale" });
  const { lease } = await client.takeLease({ name: `deploy:${record.deploymentId}`, holder: "Vibe64 on my-workstation", seconds: 600 });
  await assert.rejects(run({ record, commit: "c1" }), (error) => error.code === "deployment_lease_held"
    && /^Another Vibe64 on my-workstation is deploying this since \d\d:\d\d UTC; try again when it finishes\.$/u.test(error.message));
  assert.deepEqual(standIn.requests().filter((request) => request.method === "POST" && /\/(services|hosted-services)$/u.test(request.path)), [], "nothing was made");
  await client.releaseLease(lease.id);

  // A provider's refusal fails the Deploy with its reason, the record kept as far as it got, the lease given up.
  standIn.setQuota(standIn.projectId, { vcpus: 12 });
  const refused = await run({ record, commit: "c1" });
  assert.deepEqual([refused.outcome, refused.message], ["failed", "createService computers: The project has used its quota of vcpus (12)."]);
  assert.deepEqual(Object.keys(refused.record.items).sort(), ["resource.database", "resource.files"]);
  assert.deepEqual(standIn.leases(), []);
  standIn.setQuota(standIn.projectId, { vcpus: 96 });
  assert.equal((await run({ record: refused.record, commit: "c1" })).outcome, "live", "a Deploy run again goes on from its record");
});

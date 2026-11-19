import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { domainHolder, domainStep } from "../../packages/vibe64-deploy/src/address.js";
import { createMobilynetClient } from "../../packages/vibe64-deploy/src/adapters/mobilynet/client.js";
import { servicePackages, serviceUpload } from "../../packages/vibe64-deploy/src/adapters/mobilynet/declaration.js";
import { DRAIN_SECONDS, createMobilynetAdapter } from "../../packages/vibe64-deploy/src/adapters/mobilynet/index.js";
import { moveDomain } from "../../packages/vibe64-deploy/src/domain.js";
import { setInstances } from "../../packages/vibe64-deploy/src/instances.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { settingsPerService, withRootFile } from "../../packages/vibe64-deploy/src/package.js";
import { planOf } from "../../packages/vibe64-deploy/src/plan.js";
import { LABEL, createRecordStore, newRecord, rebuildFromLabels } from "../../packages/vibe64-deploy/src/record.js";
import { applyStep, deleteResource, deploy, nextStep, releaseDigest, takeOffline } from "../../packages/vibe64-deploy/src/steps.js";
import { MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES } from "../fixtures/deploymentServices.js";
import { HOST, runningShop, settle, world } from "./vibe64DeployStandInHelpers.js";

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

/**
 * A release of a commit: the archive (one file naming the commit) and each service's declaration and settings, its
 * Migrate the release's migrate task where `releaseTasks`, with the Production Env's entries (`records`) and values.
 */
function releaseOf(commit, { deployment, needs }, { releaseTasks = false, env = ENV, records = ENV_RECORDS } = {}) {
  const settings = settingsPerService(needs, records.filter((record) => needs.services.some((one) => (record.services ?? ["web"]).includes(one.id))));
  const { declarations } = servicePackages({ app: "memobot", deployment, needs, settings, releaseTasks });
  return { id: commit, archive: withRootFile(gzipSync(Buffer.alloc(1024)), "commit.txt", commit).bytes, declarations, settings, env, domain: DOMAIN };
}

/**
 * The stand-in with a verified-later domain, the adapter over it (leases on; release tasks where `releaseTasks`, which
 * mobilynet has not built yet), and a Deploy helper that plans first.
 */
function setup({ releaseTasks = false } = {}) {
  const parts = world();
  // Room for two a-8 computers (three when raised by hand), two a-2 webs and their rolling replacements.
  parts.standIn.setQuota(parts.projectId, { vcpus: 96, memoryGib: 192 });
  const adapter = createMobilynetAdapter({ client: parts.client, project: parts.projectId, leases: true, releaseTasks });
  const run = async ({ stack = stackOf(), record, commit, env, records, choices = {}, decisions = {}, planHash, save, report, pause = () => parts.standIn.advance() }) => {
    const plan = planOf({ needs: stack.needs, record, observed: await adapter.inventory(), offer: await adapter.offer(), choices, decisions });
    const result = await deploy({
      adapter, needs: stack.needs, record, choices, decisions, planHash: planHash ?? plan.hash, release: releaseOf(commit, stack, { releaseTasks, env, records }), holder: HOLDER,
      pause, ...(save ? { save } : {}), ...(report ? { report } : {})
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
  // Linked once each service's first refresh was building, each link taken at once: its first instances started with
  // both resources, none restarted, and no settings refresh followed.
  const asked = requestsAfter(standIn, before);
  assert.deepEqual(asked.filter((request) => request.method === "POST" && request.path.endsWith("/links")).map((request) => request.status), [202, 202, 202, 202]);
  for (const service of [web, computers]) {
    assert.deepEqual(standIn.services.refreshes(service.id).map((one) => one.kind), ["create"]);
    const started = standIn.services.instances(service.id);
    assert.ok(started.length >= 2 && started.every((one) => !one.removedReason && namesOf(one, "V64_DATABASE_").length > 0 && namesOf(one, "V64_FILES_").length > 0));
  }
  // The lease was taken, renewed at each step and given up; nothing unlabelled was asked about but by listing.
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

test("a dropped resource is unlinked and kept, a dropped service deleted; a count an app set itself is kept; take offline keeps the data; deleting a resource is its own action", async () => {
  const { standIn, client, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const { items } = first.record;

  // The app raises computers to 3 with its own key: the next Deploy hands it its release on the 3 it runs, asks
  // mobilynet nothing of its count and is live once 3 run healthy; the record keeps no count.
  const computers = items["service.computers"].id;
  await client.changeService(computers, { instances: 3 });
  const scaledAt = standIn.requests().length;
  const back = await run({ record: first.record, commit: "c2" });
  assert.equal(back.outcome, "live", back.message);
  assert.equal(back.plan.services.find((service) => service.id === "computers").instances.live, 3);
  assert.deepEqual(requestsAfter(standIn, scaledAt).filter((request) => request.method === "PATCH" && request.path === `/v1/services/${computers}`), []);
  const { instances } = standIn.services.service(computers);
  assert.ok(instances.wanted === 3 && instances.healthy >= 3, JSON.stringify(instances));
  assert.deepEqual(["instances" in back.record.items["service.computers"], back.record.choices.services.computers], [false, { size: "a-8" }]);

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
  // uploads was linked to web while web's new release built, so that release's instances started with it, none again.
  const rolled = standIn.services.refreshes(items["service.web"].id).find((one) => one.kind === "release" && one.toVersion === third.record.run.services.web.version);
  const rolledInstances = standIn.services.instances(items["service.web"].id).filter((one) => one.refreshId === rolled.id);
  assert.ok(rolledInstances.length > 0 && rolledInstances.every((one) => one.removedReason !== "link_changed" && namesOf(one, "V64_UPLOADS_").length > 0));
  assert.deepEqual(standIn.services.service(items["service.web"].id).connections, [], "web no longer reaches computers");
  assert.deepEqual(files.links.filter((link) => link.state === "active"), [], "files is linked to nothing");
  assert.equal(standIn.services.service(items["service.computers"].id).state === "deleted" || standIn.services.service(items["service.computers"].id).state === "deleting", true);
  assert.deepEqual(requestsAfter(standIn, at).filter((request) => request.method === "DELETE" && request.path.includes("/hosted-services/") && !request.path.includes("/links/")), [],
    "a Deploy never deletes a hosted service");

  // Take offline: the services go, every hosted service stays with its data; it returns once mobilynet removed them.
  const offline = await takeOffline(setupAdapterOf(standIn), third.record, { pause: () => standIn.advance() });
  assert.equal(standIn.services.service(items["service.web"].id).state, "deleted");
  assert.deepEqual(Object.keys(offline.items).sort(), ["resource.database", "resource.files", "resource.uploads"]);
  assert.ok([items["resource.database"].id, items["resource.files"].id].every((id) => standIn.hosted.service(id).state === "running"));

  // Deleting a resource and its data is its own action: refused while the Stack names it or the name isn't typed.
  const adapter = setupAdapterOf(standIn);
  await assert.rejects(deleteResource(adapter, offline, dropped.needs, { name: "database", typed: "database" }), { code: "production_deploy_resource_in_use" });
  await assert.rejects(deleteResource(adapter, offline, dropped.needs, { name: "files", typed: "file" }), { code: "production_deploy_confirmation_wrong" });
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

test("a resource is linked once this Deploy's refresh builds; a service whose last refresh failed (a link's, after its release went live) is not live, naming it", async () => {
  const { adapter, run, record } = setup();
  const stack = stackOf();
  const first = await run({ stack, record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const release = { ...releaseOf("c1", stack), port: adapter.servicePort, trustedProxies: await adapter.trustedProxies() };
  const observed = await adapter.inventory();
  const next = (things) => nextStep({ plan: first.plan, needs: stack.needs, record: first.record, observed: things, release });
  assert.deepEqual(next(observed), { kind: "live" });
  // The count it waits for is the one computers runs, never the Plan's: raised to 3 at mobilynet as the Deploy ends,
  // it waits until 3 are healthy, and asks nothing of the count.
  const raised = (healthy) => observed.map((thing) => (thing.id === first.record.items["service.computers"].id ? { ...thing, instances: 3, healthy } : thing));
  assert.deepEqual(next(raised(2)), { kind: "wait", words: "Waiting for computers's instances" });
  assert.deepEqual(next(raised(3)), { kind: "live" });
  // computers runs this Deploy's release, but the refresh its link's settings started failed, so mobilynet kept its
  // instances before: not live, and the Deploy fails naming it.
  const failed = observed.map((thing) => (thing.id === first.record.items["service.computers"].id
    ? { ...thing, lastError: { code: "instance_never_healthy", message: "A new instance never became healthy; the previous version kept serving." } } : thing));
  assert.deepEqual(next(failed), { kind: "failed", message: "computers: A new instance never became healthy; the previous version kept serving." });
  // While that refresh is still under way, the Deploy waits.
  const working = failed.map((thing) => (thing.lastError ? { ...thing, refresh: { id: "rfr_x", kind: "settings", state: "rolling" } } : thing));
  assert.equal(next(working).kind, "wait");
  // A later Deploy of the same upload: each service keeps the release it runs, but one whose last refresh failed is
  // handed it again, as is every service for another commit.
  const digestsOf = (made) => Object.fromEntries(stack.needs.services.map((service) => [service.id,
    releaseDigest(adapter.serviceUpload(made.archive, made.declarations[service.id]), made.declarations[service.id])]));
  const again = { ...structuredClone(first.record), run: { ...first.record.run, id: "run_again", services: {} } };
  const later = (things, made = release) => nextStep({ plan: first.plan, needs: stack.needs, record: again, observed: things, release: { ...made, digests: digestsOf(made) } });
  assert.deepEqual(later(observed), { kind: "keepRelease", service: "computers" });
  assert.deepEqual(later(failed), { kind: "releaseService", service: "computers", id: first.record.items["service.computers"].id });
  assert.deepEqual(later(observed, { ...releaseOf("c2", stack), port: adapter.servicePort, trustedProxies: release.trustedProxies }),
    { kind: "releaseService", service: "computers", id: first.record.items["service.computers"].id });

  // computers handed a release (its refresh rfr_ours) with files not linked yet: linked only once that refresh builds,
  // so mobilynet checks the link against the release it moves to before any instance starts.
  const computersId = first.record.items["service.computers"].id;
  const handed = structuredClone(first.record);
  handed.run.services.computers.refreshId = "rfr_ours";
  delete handed.items["resource.files"].links.computers;
  const refreshing = (refresh) => nextStep({ plan: first.plan, needs: stack.needs, record: handed, release,
    observed: observed.map((thing) => (thing.id === computersId ? { ...thing, refresh } : thing)) });
  const waiting = { kind: "wait", words: "Waiting for computers to start building" };
  assert.deepEqual(refreshing({ id: "rfr_ours", kind: "release", state: "queued" }), waiting);
  assert.deepEqual(refreshing({ id: "rfr_other", kind: "settings", state: "rolling" }), waiting, "queued behind another");
  for (const state of ["building", "rolling"]) {
    assert.deepEqual(refreshing({ id: "rfr_ours", kind: "release", state }), { kind: "link", resource: "files", id: handed.items["resource.files"].id, service: "computers", serviceId: computersId });
  }
  assert.deepEqual(refreshing({ id: "rfr_ours", kind: "release", state: "aborting" }), { kind: "wait", words: "Updating computers" });
  assert.deepEqual(refreshing(null), { kind: "checkRefresh", service: "computers", id: computersId, refreshId: "rfr_ours" });
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
  await assert.rejects(run({ record, commit: "c1", planHash: "sha256:old" }), { code: "production_deploy_plan_stale" });
  const { lease } = await client.takeLease({ name: `deploy:${record.deploymentId}`, holder: "Vibe64 on my-workstation", seconds: 600 });
  await assert.rejects(run({ record, commit: "c1" }), (error) => error.code === "production_deploy_lease_held"
    && /^Another Vibe64 on my-workstation is deploying this since \d\d:\d\d UTC; try again when it finishes\.$/u.test(error.message));
  assert.deepEqual(standIn.requests().filter((request) => request.method === "POST" && /\/(services|hosted-services)$/u.test(request.path)), [], "nothing was made");
  await client.releaseLease(lease.id);

  // A quota too small for what the Deploy adds is the Plan's problem, naming what is short and by how much: nothing
  // is made. Two a-2 webs, two a-8 computers and two m-1 hosted services take 22 vCPU.
  standIn.setQuota(standIn.projectId, { vcpus: 12 });
  const short = await run({ record, commit: "c1" }).catch((error) => error);
  assert.equal(short.code, "production_deploy_plan_refused");
  assert.equal(short.message, "mobilynet's quota of vCPU for this project is 12, 0 in use: this Deploy needs 22 more, 10 more than is left. "
    + "Ask mobilynet to raise it, or choose smaller sizes or fewer instances, then deploy to production.");
  assert.deepEqual(standIn.requests().filter((request) => request.method === "POST" && /\/(services|hosted-services)$/u.test(request.path)), [], "nothing was made");

  // A provider's refusal fails the Deploy with its reason, the record kept as far as it got, the lease given up: the
  // quota lowered once the hosted services were made, after the Plan counted it.
  standIn.setQuota(standIn.projectId, { vcpus: 96 });
  const lowered = () => {
    if (standIn.hosted.all().length === 2) standIn.setQuota(standIn.projectId, { vcpus: 12 });
    standIn.advance();
  };
  const refused = await run({ record, commit: "c1", pause: lowered });
  assert.deepEqual([refused.outcome, refused.message], ["failed", "createService computers: The project has used its quota of vcpus (12)."]);
  assert.deepEqual(Object.keys(refused.record.items).sort(), ["resource.database", "resource.files"]);
  assert.deepEqual(standIn.leases(), []);
  standIn.setQuota(standIn.projectId, { vcpus: 96 });
  assert.equal((await run({ record: refused.record, commit: "c1" })).outcome, "live", "a Deploy run again goes on from its record");
});

test("setInstances sets a running service's count at mobilynet at once, within the Stack's range: one PATCH, no release, no refresh, no instance replaced, the record unchanged; a lowered count drains for mobilynet's 30 seconds", async () => {
  const { standIn, adapter, run, record } = setup();
  const stack = stackOf();
  const first = await run({ stack, record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const { items } = first.record;
  const [web, computers] = [items["service.web"].id, items["service.computers"].id];
  // Each App Service asks, when it is made, for mobilynet's shortest drain: an instance leaving leaves the rotation and
  // has that long to finish what it serves.
  const made = standIn.requests().filter((request) => request.method === "POST" && /^\/v1\/projects\/[^/]+\/services$/u.test(request.path));
  assert.deepEqual(made.map((request) => request.body.drainSeconds), [DRAIN_SECONDS, DRAIN_SECONDS]);
  assert.deepEqual([standIn.services.service(web).drainSeconds, standIn.services.service(computers).drainSeconds, DRAIN_SECONDS], [30, 30, 30]);
  const serving = (id) => standIn.services.instances(id).filter((one) => !one.removedReason).map((one) => one.id).sort();
  const [webBefore, computersBefore] = [serving(web), serving(computers)];
  const sentAfter = (count) => requestsAfter(standIn, count).filter((request) => isWrite(request) && !request.path.startsWith("/v1/leases"));

  // Outside the Stack's - Instances: range (computers runs 1 to 20), not a whole number, or a service this deployment
  // doesn't run: refused, naming the range, and mobilynet asked nothing.
  const at = standIn.requests().length;
  for (const instances of [0, 21, 2.5, "3"]) {
    await assert.rejects(setInstances(adapter, first.record, stack.needs, { service: "computers", instances }), {
      code: "production_deploy_instances_outside", status: 422, message: "computers runs 1 to 20 instances, as genesis/stack.md's - Instances: says."
    });
  }
  await assert.rejects(setInstances(adapter, first.record, stack.needs, { service: "worker", instances: 2 }), { code: "production_deploy_item_unknown", status: 404 });
  const unmade = structuredClone(first.record);
  delete unmade.items["service.web"];
  await assert.rejects(setInstances(adapter, unmade, stack.needs, { service: "web", instances: 2 }), { code: "production_deploy_item_unknown" });
  assert.deepEqual(sentAfter(at), []);

  // Raised to 3: one PATCH of its count, no release, no settings, no refresh; it places one more beside its two.
  const kept = structuredClone(first.record);
  assert.deepEqual(await setInstances(adapter, first.record, stack.needs, { service: "computers", instances: 3 }), { service: "computers", instances: 3, refreshId: null });
  assert.deepEqual(first.record, kept, "the record keeps no count");
  const raisedWrites = sentAfter(at);
  assert.deepEqual(raisedWrites.map((request) => [request.method, request.path, request.body]), [["PATCH", `/v1/services/${computers}`, { instances: 3 }]]);
  settle(standIn);
  for (const id of [web, computers]) assert.deepEqual(standIn.services.refreshes(id).map((one) => one.kind), ["create"]);
  assert.deepEqual(serving(web), webBefore, "web runs the same instances");
  assert.ok(computersBefore.every((id) => serving(computers).includes(id)) && serving(computers).length === 3, "computers kept its two and started one");

  // A Deploy of the same commit hands no release and asks nothing of the count: computers stays on its 3.
  const same = standIn.requests().length;
  const again = await run({ stack, record: first.record, commit: "c1" });
  assert.equal(again.outcome, "live", again.message);
  assert.deepEqual(sentAfter(same), []);
  assert.equal(standIn.services.service(computers).instances.wanted, 3);

  // Lowered back to 2, the instance the count removes leaves the rotation first, so it takes no new requests, then
  // goes. Set to 2 again after an app raised it to 3: asked again with a key of its own, not answered with the first.
  for (const raise of [false, true]) {
    if (raise) await adapter.changeService(computers, { instances: 3 }, { idempotencyKey: "the-app" });
    let draining = null;
    await setInstances(adapter, again.record, stack.needs, { service: "computers", instances: 2 });
    for (let step = 0; step < 40 && serving(computers).length > 2; step += 1) {
      standIn.advance();
      draining ??= standIn.services.instances(computers).find((one) => one.rotation === "draining" && !one.removedReason)?.id ?? null;
    }
    assert.ok(draining, "an instance drained");
    assert.equal(standIn.services.instances(computers).find((one) => one.id === draining).removedReason, "count_lowered");
    assert.equal(serving(computers).length, 2);
  }
  const keys = standIn.requests().filter((request) => request.method === "PATCH" && request.path === `/v1/services/${computers}` && request.body?.instances === 2)
    .map((request) => request.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length, "each set has its own key");
});

test("moveDomain routes the running public App Service to another domain at once through takeDomain: the domain added where none covers it, the old name's route kept with its DNS target, no release or refresh, the record unchanged, and a name another service answers at refused", async () => {
  const parts = setup();
  const { standIn, adapter, run, record } = parts;
  const stack = stackOf();
  const first = await run({ stack, record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  standIn.verifyDomain(DOMAIN);
  const web = first.record.items["service.web"].id;
  const hosts = () => standIn.routes().filter((route) => route.serviceId === web).map((route) => route.host).sort();
  assert.deepEqual(hosts(), [DOMAIN]);
  const [memobot] = standIn.routes();
  const kept = structuredClone(first.record);

  // A record without its public service, or a provider that can't route one: refused, and mobilynet asked nothing.
  const at = standIn.requests().length;
  const unmade = structuredClone(first.record);
  delete unmade.items["service.web"];
  await assert.rejects(moveDomain(adapter, unmade, stack.needs, { domain: "app.example.com" }), { code: "production_deploy_item_unknown", status: 404 });
  const unmovable = { ...adapter, title: "a provider" };
  delete unmovable.takeDomain;
  await assert.rejects(moveDomain(unmovable, first.record, stack.needs, { domain: "app.example.com" }), {
    code: "production_deploy_domain_move_unsupported", status: 409, message: "a provider can't move a running service to another domain."
  });
  assert.deepEqual(writesAfter(standIn, at), []);

  // To a domain the project has no domain for: it is added, then web answers there alone, with no release or refresh;
  // the old name's route stays, sending to nothing, with its id and DNS target.
  assert.deepEqual(await moveDomain(adapter, first.record, stack.needs, { domain: "app.example.com" }), { service: "web", domain: "app.example.com" });
  assert.deepEqual(writesAfter(standIn, at), [["POST", `/v1/projects/${standIn.projectId}/domains`], ["PATCH", `/v1/services/${web}`]]);
  assert.deepEqual(requestsAfter(standIn, at).find((request) => request.method === "PATCH").body, { routes: [{ host: "app.example.com", tls: "edge" }] });
  assert.deepEqual(hosts(), ["app.example.com"]);
  assert.deepEqual(standIn.routes().filter((route) => route.host === DOMAIN).map((one) => [one.id, one.serviceId, one.target, one.waitingFor]),
    [[memobot.id, null, memobot.target, "target"]]);
  assert.deepEqual(standIn.services.refreshes(web).map((one) => one.kind), ["create"]);
  assert.deepEqual(first.record, kept, "the record keeps no domain");

  // Back to the domain the project covers already: no domain is added, one PATCH under a key of its own, and web takes
  // the old name's kept route, so its DNS target is the one its owner added.
  const back = standIn.requests().length;
  await moveDomain(adapter, first.record, stack.needs, { domain: DOMAIN });
  assert.deepEqual(writesAfter(standIn, back), [["PATCH", `/v1/services/${web}`]]);
  assert.deepEqual(hosts(), [DOMAIN]);
  assert.deepEqual(standIn.routes().filter((route) => route.host === DOMAIN).map((one) => [one.id, one.serviceId, one.target]), [[memobot.id, web, memobot.target]]);
  const keys = standIn.requests().filter((request) => request.method === "PATCH" && request.path === `/v1/services/${web}`).map((request) => request.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length, "each move has its own key");

  // A name an App Service someone made by hand answers at: never taken from it; mobilynet refuses, and web keeps its own.
  const { serviceId: hand } = await runningShop(parts);
  const taken = await moveDomain(adapter, first.record, stack.needs, { domain: HOST }).catch((error) => error);
  assert.deepEqual([taken.status, taken.code, taken.details?.host], [409, "name_taken", HOST]);
  assert.deepEqual(standIn.routes().filter((route) => route.host === HOST).map((one) => one.serviceId), [hand]);
  assert.deepEqual(hosts(), [DOMAIN]);
});

/** Each write sent to the provider after `count` requests, but the Deploy's lease: `[method, path]`. */
const writesAfter = (standIn, count) => requestsAfter(standIn, count).filter((request) => isWrite(request) && !request.path.startsWith("/v1/leases"))
  .map((request) => [request.method, request.path]);
/** Each resource's links as mobilynet holds them now: `{ item: [[link id, consumer, state]] }`, ids naming the credentials. */
const linksHeld = (standIn, kept) => Object.fromEntries(["resource.database", "resource.files"].map((item) => [item,
  standIn.hosted.service(kept.items[item].id).links.map((link) => [link.id, link.consumer.id, link.state]).sort()]));

test("a redeploy of unchanged code and Stack sends the provider nothing but its lease: every hosted service, link and App Service stays as it was", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const { items } = first.record;
  const refreshesOf = () => [items["service.web"].id, items["service.computers"].id].map((id) => standIn.services.refreshes(id).map((one) => one.id));
  const [links, refreshes, instances] = [linksHeld(standIn, first.record), refreshesOf(), standIn.services.instances(items["service.computers"].id).map((one) => one.id)];
  const at = standIn.requests().length;
  const again = await run({ record: first.record, commit: "c1" });
  assert.equal(again.outcome, "live", again.message);
  assert.deepEqual(writesAfter(standIn, at), [], "no write but the lease");
  assert.ok(requestsAfter(standIn, at).some((request) => request.method === "POST" && request.path === "/v1/leases"), "the Deploy held its lease");
  assert.deepEqual(again.steps.filter((step) => !step.startsWith("wait")), ["ensureDomain", "keepRelease computers", "keepRelease web"]);
  assert.deepEqual([linksHeld(standIn, again.record), refreshesOf()], [links, refreshes], "the same links (the same logins), no refresh");
  assert.deepEqual(standIn.services.instances(items["service.computers"].id).map((one) => one.id), instances, "the same machines");
});

test("a redeploy where one of two services changed hands that one alone its release: no hosted service, link or other service is touched", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const { items } = first.record;
  const [web, computers] = [items["service.web"].id, items["service.computers"].id];
  const links = linksHeld(standIn, first.record);
  const webInstances = standIn.services.instances(web).map((one) => one.id);
  // The same commit, with one more package for computers alone: only computers' declaration changes.
  const changed = stackOf((lines) => lines.map((line) => (line.startsWith("- Packages: `tint2`") ? `${line} \`htop\`` : line)));
  const at = standIn.requests().length;
  const second = await run({ stack: changed, record: first.record, commit: "c1" });
  assert.equal(second.outcome, "live", second.message);
  assert.deepEqual(writesAfter(standIn, at), [["POST", `/v1/services/${computers}/releases`]], "computers' release, and nothing else");
  assert.deepEqual(second.steps.filter((step) => !step.startsWith("wait")), ["ensureDomain", "releaseService computers", "checkRefresh computers", "keepRelease web"]);
  assert.deepEqual(standIn.services.refreshes(web).map((one) => one.kind), ["create"], "no refresh of web");
  assert.deepEqual(standIn.services.instances(web).map((one) => one.id), webInstances, "web's machines run on");
  assert.deepEqual(linksHeld(standIn, second.record), links, "the same links (the same logins)");
});

test("a Production Env entry added, changed or removed, on the same code and Stack, changes its service's settings alone: the same release digest, the release kept, the settings given and rolled out; no upload, no release", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const { items } = first.record;
  const [web, computers] = [items["service.web"].id, items["service.computers"].id];
  const c1 = first.record.run.services.web.version;
  const serving = (id) => standIn.services.instances(id).filter((one) => !one.removedReason);
  const [webBefore, computersBefore] = [serving(web).map((one) => one.id), serving(computers).map((one) => one.id)];
  // A name new to web, which no release declared: web keeps c1's release and is given it in a settings replace.
  const records = [...ENV_RECORDS, { key: "MEMOBOT_GREETING", secret: false }];
  const env = { ...ENV, MEMOBOT_GREETING: "Hello" };
  const at = standIn.requests().length;
  const second = await run({ record: first.record, commit: "c1", env, records });
  assert.equal(second.outcome, "live", second.message);
  assert.deepEqual(writesAfter(standIn, at), [["PUT", `/v1/services/${web}/settings`]], "web's settings alone: no upload, no release");
  assert.equal(requestsAfter(standIn, at).some((request) => request.path.endsWith("/releases")), false, "no release uploaded or handed");
  assert.deepEqual(second.steps.filter((step) => !step.startsWith("wait")),
    ["ensureDomain", "keepRelease computers", "keepRelease web", "putSettings web", "checkRefresh web"]);
  // What a release is made of (its upload and its declaration) is the code and the Stack alone, so each service's
  // release digest is the one before.
  const digestsOf = (release) => Object.fromEntries(Object.entries(release.declarations)
    .map(([service, declaration]) => [service, releaseDigest(serviceUpload(release.archive, declaration), declaration)]));
  assert.deepEqual(digestsOf(releaseOf("c1", stackOf(), { env, records })), digestsOf(releaseOf("c1", stackOf())));
  assert.equal(second.record.items["service.web"].release.digest, first.record.items["service.web"].release.digest);
  // The settings refresh rolled web onto new instances of c1, each with the new entry; computers' machines run on.
  const [refresh] = standIn.services.refreshes(web).slice(-1);
  assert.deepEqual([refresh.kind, refresh.state, refresh.toVersion], ["settings", "succeeded", c1]);
  const now = serving(web);
  assert.ok(now.length === 2 && now.every((one) => !webBefore.includes(one.id) && one.version === c1 && one.settings.MEMOBOT_GREETING === "Hello"),
    "web serves c1 on new instances, each with the new entry");
  assert.deepEqual(serving(computers).map((one) => one.id), computersBefore);

  // A value changed and the new entry removed: again web's settings alone, on c1.
  settle(standIn);
  const later = standIn.requests().length;
  const third = await run({ record: second.record, commit: "c1", env: { ...ENV, MEMOBOT_OWNERS: "team@example.com" } });
  assert.equal(third.outcome, "live", third.message);
  assert.deepEqual(writesAfter(standIn, later), [["PUT", `/v1/services/${web}/settings`]]);
  assert.ok(serving(web).length === 2 && serving(web).every((one) => one.version === c1 && one.settings.MEMOBOT_OWNERS === "team@example.com"
    && !Object.hasOwn(one.settings, "MEMOBOT_GREETING")), "web serves c1 with the changed value and without the removed entry");
});

test("a service whose release failed is handed it again on the next Deploy, while every hosted service and link stays as it was", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const { items } = first.record;
  const [web, computers] = [items["service.web"].id, items["service.computers"].id];
  const links = linksHeld(standIn, first.record);
  // c2's instances of computers never get healthy: computers keeps c1 and the Deploy fails before web moves.
  standIn.faults.instancesUnhealthy = true;
  const failed = await run({ record: first.record, commit: "c2" });
  standIn.faults.instancesUnhealthy = false;
  assert.equal(failed.outcome, "failed");
  settle(standIn);
  const at = standIn.requests().length;
  const again = await run({ record: failed.record, commit: "c2" });
  assert.equal(again.outcome, "live", again.message);
  assert.deepEqual(writesAfter(standIn, at), [["POST", `/v1/services/${computers}/releases`], ["POST", `/v1/services/${web}/releases`]],
    "computers handed c2 again and web its first c2: no hosted-service write, no link");
  assert.deepEqual(linksHeld(standIn, again.record), links, "the same links (the same logins) through the failure and the Deploy after it");
});

/** Each write sent to the provider after `count` requests for one service: `[method, path, status]`. */
const writesTo = (standIn, count, serviceId) => requestsAfter(standIn, count).filter((request) => isWrite(request) && request.path.startsWith(`/v1/services/${serviceId}`))
  .map((request) => [request.method, request.path, request.status]);
/** A setup code as the newer framework takes one: at least 20 letters and digits. @param {string} [code] */
const longCode = (code) => /^[A-Za-z0-9]{20,}$/u.test(code ?? "");

test("a release that fails for a secret's value is put right by a Deploy with the value changed: web is given its settings, then the release, whose instances start with them", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const { items } = first.record;
  const [web, computers] = [items["service.web"].id, items["service.computers"].id];
  const c1 = first.record.run.services.web.version;
  // c2's web refuses, as it boots, a setup code shorter than 20 letters and digits; c1's takes any.
  standIn.faults.instancesUnhealthy = (instance) => instance.serviceId === web && instance.version !== c1 && !longCode(instance.secrets.AUTH_LOCAL_SETUP_CODE);
  const failed = await run({ record: first.record, commit: "c2" });
  assert.equal(failed.outcome, "failed");
  assert.match(failed.message, /^web: the release did not go live: A new instance never became healthy/u);
  settle(standIn);

  // The owner saves a long code in the Production Env and deploys the same commit: web is given it on c1, which takes
  // it, then handed c2, whose instances start with it. Nothing follows the release, and computers runs c2 already.
  const env = { ...ENV, AUTH_LOCAL_SETUP_CODE: "SetupCodeOfTwentyFour024" };
  const events = reports();
  const at = standIn.requests().length;
  const fixed = await run({ record: failed.record, commit: "c2", env, report: events.report });
  assert.equal(fixed.outcome, "live", fixed.message);
  assert.deepEqual(writesAfter(standIn, at), [["PUT", `/v1/services/${web}/settings`], ["POST", `/v1/services/${web}/releases`]]);
  assert.deepEqual(fixed.steps.filter((step) => !step.startsWith("wait")),
    ["ensureDomain", "keepRelease computers", "putSettings web", "checkRefresh web", "releaseService web", "checkRefresh web"]);
  const words = events.events.filter((event) => event.kind === "step" && event.phase === "start" && event.service === "web").map((event) => event.words);
  assert.deepEqual(words, ["Updating the settings of web", "Reading how the update of web ended", "Handing App Service web the new release", "Reading how the update of web ended"]);
  assert.ok(events.events.some((event) => event.kind === "wait" && event.words === "Updating the settings of web on the version it runs"));
  const [settings, release] = standIn.services.refreshes(web).slice(-2);
  assert.deepEqual([settings.kind, settings.toVersion, settings.state, release.kind, release.state], ["settings", c1, "succeeded", "release", "succeeded"]);
  const serving = standIn.services.instances(web).filter((one) => !one.removedReason);
  assert.ok(serving.length === 2 && serving.every((one) => one.version === fixed.record.run.services.web.version && one.secrets.AUTH_LOCAL_SETUP_CODE === env.AUTH_LOCAL_SETUP_CODE),
    "web serves c2 with the long code");
  assert.notEqual(fixed.record.items["service.web"].settingsHash, failed.record.items["service.web"].settingsHash);

  // Nothing changed: no settings and no release, nothing but the lease.
  settle(standIn);
  const unchanged = standIn.requests().length;
  const again = await run({ record: fixed.record, commit: "c2", env });
  assert.equal(again.outcome, "live", again.message);
  assert.deepEqual(writesAfter(standIn, unchanged), []);
  // A new commit with the same settings: each service its release, and no settings.
  settle(standIn);
  const moved = standIn.requests().length;
  const third = await run({ record: again.record, commit: "c3", env });
  assert.equal(third.outcome, "live", third.message);
  assert.deepEqual(writesAfter(standIn, moved), [["POST", `/v1/services/${computers}/releases`], ["POST", `/v1/services/${web}/releases`]]);
});

test("a new generated secret, which a new release requires and no release declared before, goes to each service ahead of that release, which starts with it", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const { items } = first.record;
  const [web, computers] = [items["service.web"].id, items["service.computers"].id];
  // Every service's c2 requires MEMOBOT_SIGNING_KEY, which c1 doesn't declare: c1 takes it in a settings replace as a
  // secret it doesn't declare, so c2's refresh finds it given.
  const stack = stackOf((lines) => lines.map((line) => (line.startsWith("- Generated secrets:") ? `${line} \`MEMOBOT_SIGNING_KEY\`` : line)));
  const env = { ...ENV, MEMOBOT_SIGNING_KEY: "signing-1" };
  const at = standIn.requests().length;
  const second = await run({ stack, record: first.record, commit: "c2", env });
  assert.equal(second.outcome, "live", second.message);
  for (const [service, id] of [["computers", computers], ["web", web]]) {
    assert.deepEqual(writesTo(standIn, at, id), [["PUT", `/v1/services/${id}/settings`, 202], ["POST", `/v1/services/${id}/releases`, 202]], service);
    const serving = standIn.services.instances(id).filter((one) => !one.removedReason);
    assert.ok(serving.length === 2 && serving.every((one) => one.version === second.record.run.services[service].version
      && one.secrets.MEMOBOT_SIGNING_KEY === "signing-1"), `${service} serves c2 with the new secret`);
  }
});

test("a setting a service requires that the Production Env has no value for fails the Deploy before any change, naming it", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const stack = stackOf((lines) => lines.map((line) => (line.startsWith("- Generated secrets:") ? `${line} \`MEMOBOT_SIGNING_KEY\`` : line)));
  const at = standIn.requests().length;
  const second = await run({ stack, record: first.record, commit: "c2" });
  assert.equal(second.outcome, "failed");
  assert.equal(second.message, "web requires MEMOBOT_SIGNING_KEY, which the Production Env has no value for: give it a value in the "
    + "Production Env, then deploy to production.");
  assert.deepEqual(writesAfter(standIn, at), [], "no write but the lease");
  // Its first Deploy alike: nothing is made.
  const fresh = setup();
  const before = fresh.standIn.requests().length;
  const none = await fresh.run({ stack, record: fresh.record, commit: "c1" });
  assert.deepEqual([none.outcome, none.message], ["failed", second.message]);
  assert.deepEqual(writesAfter(fresh.standIn, before), [], "nothing made");
});

test("a fixed value and a name new to its service go ahead together of the release that needs the value", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const web = first.record.items["service.web"].id;
  const c1 = first.record.run.services.web.version;
  // c2's web refuses, as it boots, a setup code shorter than 20 letters and digits.
  standIn.faults.instancesUnhealthy = (instance) => instance.serviceId === web && instance.version !== c1 && !longCode(instance.secrets.AUTH_LOCAL_SETUP_CODE);
  const failed = await run({ record: first.record, commit: "c2" });
  assert.equal(failed.outcome, "failed", failed.message);
  settle(standIn);
  // The owner saves a long code and, in the same Deploy, a new Production Env entry, which no release declares: both go
  // ahead on c1, then c2 starts with them, and nothing follows the release.
  const records = [...ENV_RECORDS, { key: "MEMOBOT_GREETING", secret: false }];
  const env = { ...ENV, AUTH_LOCAL_SETUP_CODE: "SetupCodeOfTwentyFour024", MEMOBOT_GREETING: "Hello" };
  const at = standIn.requests().length;
  const fixed = await run({ record: failed.record, commit: "c2", env, records });
  assert.equal(fixed.outcome, "live", fixed.message);
  assert.deepEqual(writesTo(standIn, at, web), [["PUT", `/v1/services/${web}/settings`, 202], ["POST", `/v1/services/${web}/releases`, 202]]);
  const serving = standIn.services.instances(web).filter((one) => !one.removedReason);
  assert.ok(serving.length === 2 && serving.every((one) => one.version === fixed.record.run.services.web.version
    && one.secrets.AUTH_LOCAL_SETUP_CODE === "SetupCodeOfTwentyFour024" && one.settings.MEMOBOT_GREETING === "Hello"), "web serves c2 with both");
});

test("settings that don't go live on the version a service runs follow its release, which takes them", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const web = first.record.items["service.web"].id;
  const c1 = first.record.run.services.web.version;
  // c1's web refuses the new Stripe key as it boots; c2's takes it.
  standIn.faults.instancesUnhealthy = (instance) => instance.serviceId === web && instance.version === c1 && instance.secrets.STRIPE_SECRET_KEY === "sk_live_2";
  const env = { ...ENV, STRIPE_SECRET_KEY: "sk_live_2" };
  const events = reports();
  const at = standIn.requests().length;
  const second = await run({ record: first.record, commit: "c2", env, report: events.report });
  assert.equal(second.outcome, "live", second.message);
  assert.deepEqual(writesTo(standIn, at, web), [["PUT", `/v1/services/${web}/settings`, 202], ["POST", `/v1/services/${web}/releases`, 202], ["PUT", `/v1/services/${web}/settings`, 202]]);
  assert.ok(events.said().includes("Its new settings did not go live on the version it runs: A new instance never became healthy; the previous version kept serving. "
    + "web gets its new release first, and its settings after it."));
  assert.deepEqual(standIn.services.refreshes(web).slice(-3).map((one) => [one.kind, one.state]), [["settings", "failed"], ["release", "succeeded"], ["settings", "succeeded"]]);
  const serving = standIn.services.instances(web).filter((one) => !one.removedReason);
  assert.ok(serving.length === 2 && serving.every((one) => one.version === second.record.run.services.web.version && one.secrets.STRIPE_SECRET_KEY === "sk_live_2"),
    "web serves c2 with the new key");
});

test("a Deploy that stopped while a service's settings went ahead of its release, those settings then failing, is resumed by the next, which gives them again", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const web = first.record.items["service.web"].id;
  const c1 = first.record.run.services.web.version;
  standIn.faults.instancesUnhealthy = (instance) => instance.serviceId === web && instance.version === c1 && instance.secrets.STRIPE_SECRET_KEY === "sk_live_2";
  const env = { ...ENV, STRIPE_SECRET_KEY: "sk_live_2" };
  // The editor stops at the first pause once web's settings went ahead of its release.
  let kept = null;
  const stopped = await run({
    record: first.record, commit: "c2", env,
    save: (one) => {
      kept = structuredClone(one);
      return one;
    },
    pause: () => {
      if (kept?.run.services.web?.settingsRefresh) throw new Error("the editor stopped");
      standIn.advance();
    }
  }).catch((error) => error);
  assert.equal(stopped.message, "the editor stopped");
  assert.equal(kept.items["service.web"].settingsHash === first.record.items["service.web"].settingsHash, false, "the record says web was given them");
  settle(standIn);
  assert.equal(standIn.services.refreshes(web).at(-1).state, "failed");

  const events = reports();
  const at = standIn.requests().length;
  const resumed = await run({ record: kept, commit: "c2", env, report: events.report });
  assert.equal(resumed.outcome, "live", resumed.message);
  const settled = events.events.filter((event) => event.step === "settleRefresh" && event.phase === "done");
  assert.deepEqual(settled.map((event) => event.message),
    ["It failed: A new instance never became healthy; the previous version kept serving. This Deploy hands web its settings and release again."]);
  assert.deepEqual(writesTo(standIn, at, web), [["PUT", `/v1/services/${web}/settings`, 202], ["POST", `/v1/services/${web}/releases`, 202], ["PUT", `/v1/services/${web}/settings`, 202]]);
  const serving = standIn.services.instances(web).filter((one) => !one.removedReason);
  assert.ok(serving.length === 2 && serving.every((one) => one.secrets.STRIPE_SECRET_KEY === "sk_live_2"), "web serves with the new key");
});

test("a Deploy resumed while the settings a stopped one gave ahead of a release still run gives them again, so a failure of theirs leaves none behind", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  settle(standIn);
  const web = first.record.items["service.web"].id;
  const c1 = first.record.run.services.web.version;
  standIn.faults.instancesUnhealthy = (instance) => instance.serviceId === web && instance.version === c1 && instance.secrets.STRIPE_SECRET_KEY === "sk_live_2";
  const env = { ...ENV, STRIPE_SECRET_KEY: "sk_live_2" };
  let kept = null;
  const stopped = await run({
    record: first.record, commit: "c2", env,
    save: (one) => {
      kept = structuredClone(one);
      return one;
    },
    pause: () => {
      if (kept?.run.services.web?.settingsRefresh) throw new Error("the editor stopped");
      standIn.advance();
    }
  }).catch((error) => error);
  assert.equal(stopped.message, "the editor stopped");
  // The next Deploy starts at once, while those settings still run; they fail on c1 later.
  assert.ok(["queued", "building", "rolling"].includes(standIn.services.refreshes(web).at(-1).state));
  const at = standIn.requests().length;
  const resumed = await run({ record: kept, commit: "c2", env });
  assert.equal(resumed.outcome, "live", resumed.message);
  assert.deepEqual(writesTo(standIn, at, web), [["PUT", `/v1/services/${web}/settings`, 202], ["POST", `/v1/services/${web}/releases`, 202], ["PUT", `/v1/services/${web}/settings`, 202]]);
  const serving = standIn.services.instances(web).filter((one) => !one.removedReason);
  assert.ok(serving.length === 2 && serving.every((one) => one.version === resumed.record.run.services.web.version && one.secrets.STRIPE_SECRET_KEY === "sk_live_2"),
    "web serves c2 with the new key, not the one the failed settings left");
});

/** Each refresh of the two services that ran a task: `[service, refresh kind, task, its state]`. */
const tasksRun = (standIn, record) => ["computers", "web"].flatMap((service) => standIn.services.refreshes(record.items[`service.${service}`].id)
  .filter((refresh) => refresh.task).map((refresh) => [service, refresh.kind, refresh.task.name, refresh.task.state]));
/** What a Deploy's reports said: its steps' messages, and the end's migrations. */
function reports() {
  const events = [];
  return { events, report: (event) => events.push(event), said: () => events.filter((event) => event.message).map((event) => event.message),
    migrations: () => events.find((event) => event.kind === "end")?.migrations };
}

test("with release tasks, the migrations run once per Deploy as the first release's task, before any of its instances, never as instances start", async () => {
  const { standIn, run, record } = setup({ releaseTasks: true });
  const first = reports();
  const made = await run({ record, commit: "c1", report: first.report });
  assert.equal(made.outcome, "live", made.message);
  // The first Deploy: once, by the first service made, its database linked by then; neither serve script migrates.
  assert.deepEqual(tasksRun(standIn, made.record), [["computers", "create", "migrate", "succeeded"]]);
  const computers = made.record.items["service.computers"].id;
  const [refresh] = standIn.services.refreshes(computers);
  assert.ok(refresh.task.settings.some((name) => name.startsWith("V64_DATABASE_")), "the task ran with the database's settings");
  const stepsOf = refresh.steps.map((step) => step.step);
  assert.ok(stepsOf.indexOf("task_succeeded") < stepsOf.indexOf("instance_started"), "the task finished before any instance started");
  assert.equal(first.migrations(), "ran");
  assert.ok(first.said().includes("The migrations ran once (exit 0)."), first.said().join(" | "));
  for (const service of ["computers", "web"]) {
    const declaration = releaseOf("c1", stackOf(), { releaseTasks: true }).declarations[service];
    assert.deepEqual(declaration.tasks.migrate.command, `bash vibe64-app/migrate-${service}.sh`);
  }
  assert.deepEqual(made.record.migrated.map((one) => one.release), ["c1"]);

  // Unchanged code: no release, no migrations, the database untouched.
  settle(standIn);
  const same = reports();
  const kept = await run({ record: made.record, commit: "c1", report: same.report });
  assert.equal(kept.outcome, "live", kept.message);
  assert.deepEqual(tasksRun(standIn, kept.record).length, 1);
  assert.equal(same.migrations(), "skipped");

  // One service's declaration changed and the code didn't: its release is handed with no migrations.
  settle(standIn);
  const changed = stackOf((lines) => lines.map((line) => (line.startsWith("- Packages: `tint2`") ? `${line} \`htop\`` : line)));
  const packages = reports();
  const repacked = await run({ stack: changed, record: kept.record, commit: "c1", report: packages.report });
  assert.equal(repacked.outcome, "live", repacked.message);
  assert.deepEqual(repacked.steps.filter((step) => !step.startsWith("wait")), ["ensureDomain", "releaseService computers", "checkRefresh computers", "keepRelease web"]);
  assert.deepEqual(tasksRun(standIn, repacked.record).length, 1, "no task with it");
  assert.ok(packages.said().includes("Migrations skipped: the database already ran this code's migrations."), packages.said().join(" | "));
  assert.equal(packages.migrations(), "skipped");

  // New code: once again, with the first release handed (computers'), never with web's.
  settle(standIn);
  const next = reports();
  const moved = await run({ stack: changed, record: repacked.record, commit: "c2", report: next.report });
  assert.equal(moved.outcome, "live", moved.message);
  assert.deepEqual(tasksRun(standIn, moved.record), [["computers", "create", "migrate", "succeeded"], ["computers", "release", "migrate", "succeeded"]]);
  assert.equal(next.migrations(), "ran");
  assert.deepEqual(moved.record.migrated.map((one) => one.release), ["c2", "c1"]);

  // An earlier version deployed again: its migrations ran before, so none run, and the log says it runs on c2's schema.
  settle(standIn);
  const back = reports();
  const returned = await run({ stack: changed, record: moved.record, commit: "c1", report: back.report });
  assert.equal(returned.outcome, "live", returned.message);
  assert.equal(tasksRun(standIn, returned.record).length, 2, "no task with c1 again");
  assert.ok(back.said().includes("Migrations skipped: the database already ran this code's migrations, and those of a later release (c2), so this "
    + "code runs on the later schema: deploying an earlier version returns its code, never its schema."), back.said().join(" | "));
  assert.equal(back.migrations(), "skipped");
  assert.deepEqual(returned.record.migrated.map((one) => one.release), ["c2", "c1"]);
});

test("with release tasks, migrations that fail stop the Deploy before any instance of the new release starts, the version before serving; the next Deploy runs them again", async () => {
  const { standIn, run, record } = setup({ releaseTasks: true });
  const made = await run({ record, commit: "c1" });
  assert.equal(made.outcome, "live", made.message);
  settle(standIn);
  const computers = made.record.items["service.computers"].id;
  const before = standIn.services.instances(computers).filter((one) => !one.removedReason).map((one) => one.id);
  standIn.faults.releaseTaskFails = { exitCode: 3, output: ["Running 20261119_add_column", "column \"x\" already exists"] };
  const told = reports();
  const failed = await run({ record: made.record, commit: "c2", report: told.report });
  standIn.faults.releaseTaskFails = false;
  assert.equal(failed.outcome, "failed");
  assert.match(failed.message, /^computers: the migrations failed, so no instance of the new release started: The release's task migrate exited 3: column "x" already exists The version before \(\S+\) still serves\.$/u);
  const release = standIn.services.refreshes(computers).at(-1);
  assert.deepEqual([release.kind, release.state, release.error.code], ["release", "failed", "release_task_failed"]);
  assert.deepEqual(standIn.services.instances(computers).filter((one) => one.refreshId === release.id), [], "no instance of c2 started");
  assert.deepEqual(standIn.services.instances(computers).filter((one) => !one.removedReason).map((one) => one.id), before, "c1 serves on");
  assert.deepEqual(told.events.find((event) => event.step === "checkRefresh" && event.output)?.output, ["Running 20261119_add_column", "column \"x\" already exists"]);
  assert.equal(told.migrations(), "failed");
  assert.deepEqual(failed.record.migrated.map((one) => one.release), ["c1"], "the database still ran c1's migrations alone");
  assert.equal(standIn.services.refreshes(failed.record.items["service.web"].id).length, 1, "web was never handed c2");

  settle(standIn);
  const again = await run({ record: failed.record, commit: "c2" });
  assert.equal(again.outcome, "live", again.message);
  assert.deepEqual(tasksRun(standIn, again.record).map(([, kind, , state]) => `${kind} ${state}`), ["create succeeded", "release failed", "release succeeded"]);
});

test("with release tasks, a release that fails after its migrations ran says the version before serves on the migrated database, and the next Deploy doesn't run them again", async () => {
  const { standIn, run, record } = setup({ releaseTasks: true });
  const made = await run({ record, commit: "c1" });
  assert.equal(made.outcome, "live", made.message);
  settle(standIn);
  standIn.faults.instancesUnhealthy = true;
  const failed = await run({ record: made.record, commit: "c2" });
  standIn.faults.instancesUnhealthy = false;
  assert.equal(failed.outcome, "failed");
  assert.match(failed.message, /The version before \(\S+\) still serves\. Its migrations ran, so the version before serves on the migrated database: an app's migrations must work with the version before them \(add first, remove in a later release\)\.$/u);
  assert.deepEqual(failed.record.migrated.map((one) => one.release), ["c2", "c1"]);
  settle(standIn);
  const told = reports();
  const again = await run({ record: failed.record, commit: "c2", report: told.report });
  assert.equal(again.outcome, "live", again.message);
  assert.equal(tasksRun(standIn, again.record).length, 2, "c1's and c2's, once each");
  assert.equal(told.migrations(), "skipped");
});

test("with release tasks, migrations a stopped Deploy asked for and mobilynet then ran are kept by the next Deploy, which doesn't run them again", async () => {
  const { standIn, run, record } = setup({ releaseTasks: true });
  const made = await run({ record, commit: "c1" });
  assert.equal(made.outcome, "live", made.message);
  settle(standIn);
  // The Deploy of c2 stops in its wait once computers' release, and its migrations, are asked for.
  let kept = null;
  const stopped = await run({
    record: made.record, commit: "c2",
    save: (one) => {
      kept = structuredClone(one);
      return one;
    },
    pause: () => {
      if (kept?.run.services.computers?.migrating) throw new TypeError("mobilynet did not answer: fetch failed");
      standIn.advance();
    }
  }).catch((error) => error);
  assert.equal(stopped.message, "mobilynet did not answer: fetch failed");
  assert.deepEqual(kept.migrated.map((one) => one.release), ["c1"]);
  settle(standIn);
  const told = reports();
  const resumed = await run({ record: kept, commit: "c2", report: told.report });
  assert.equal(resumed.outcome, "live", resumed.message);
  assert.deepEqual(resumed.record.migrated.map((one) => one.release), ["c2", "c1"]);
  assert.deepEqual(tasksRun(standIn, resumed.record), [["computers", "create", "migrate", "succeeded"], ["computers", "release", "migrate", "succeeded"]]);
  assert.ok(told.said().includes("Migrations skipped: the database already ran this code's migrations."), told.said().join(" | "));
});

test("a release declaring a migrate task is refused by an adapter whose provider runs none, rather than never migrating", async () => {
  const { standIn, adapter, record } = setup();
  const stack = stackOf();
  assert.equal(releaseOf("c1", stack).declarations.web.tasks, undefined, "with no release tasks, the serve scripts migrate");
  const plan = planOf({ needs: stack.needs, record, observed: await adapter.inventory(), offer: await adapter.offer() });
  await assert.rejects(deploy({
    adapter, needs: stack.needs, record, planHash: plan.hash, release: releaseOf("c1", stack, { releaseTasks: true }), holder: HOLDER, pause: () => standIn.advance()
  }), { code: "production_deploy_release_tasks_unsupported" });
  assert.deepEqual(standIn.leases(), []);
});

test("a release rolls to the count the service runs: set to 4, a release that fails leaves the version before on 4, and the next starts 4; no Deploy asks mobilynet for a count", async () => {
  const { standIn, adapter, run, record } = setup();
  standIn.setQuota(standIn.projectId, { vcpus: 200, memoryGib: 400 });
  const stack = stackOf();
  const first = await run({ stack, record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const computers = first.record.items["service.computers"].id;
  const releaseRefresh = () => standIn.services.refreshes(computers).filter((one) => one.kind === "release").at(-1);
  const startedBy = (refresh) => standIn.services.instances(computers).filter((one) => one.refreshId === refresh.id).length;
  const serving = () => standIn.services.instances(computers).filter((one) => !one.removedReason).length;
  await setInstances(adapter, first.record, stack.needs, { service: "computers", instances: 4 });
  settle(standIn);
  const at = standIn.requests().length;

  // Its next release fails (instance_never_healthy): computers serves c1 on four instances.
  standIn.faults.instancesUnhealthy = true;
  const broken = await run({ stack, record: first.record, commit: "c2" });
  assert.equal(broken.outcome, "failed");
  assert.match(broken.message, /^computers: the release did not go live: A new instance never became healthy/u);
  standIn.faults.instancesUnhealthy = false;
  settle(standIn);
  assert.deepEqual(standIn.services.service(computers).instances, { wanted: 4, running: 4, inRotation: 4, healthy: 4 });

  // The next release starts the four, and no instance starts on the version it leaves.
  const startedBefore = standIn.services.instances(computers).length;
  const fixed = await run({ stack, record: broken.record, commit: "c3" });
  assert.equal(fixed.outcome, "live", fixed.message);
  settle(standIn);
  assert.equal(startedBy(releaseRefresh()), 4);
  assert.equal(standIn.services.instances(computers).length - startedBefore, 4, "no instance started beside the release's own");
  assert.equal(serving(), 4);
  assert.deepEqual(requestsAfter(standIn, at).filter((request) => request.method === "PATCH" && request.path === `/v1/services/${computers}`), [], "no Deploy set a count");
  assert.deepEqual([fixed.plan.choices.services.computers, fixed.record.choices.services.computers], [{ size: "a-8", instances: 4 }, { size: "a-8" }]);
});

test("take offline returns once the provider removed the services, or names those it is still removing, the record kept without them", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const adapter = setupAdapterOf(standIn);
  let kept = null;
  const slow = await takeOffline(adapter, first.record, { save: (next) => (kept = next), pause: () => {}, maxReads: 3 }).catch((error) => error);
  assert.equal(slow.code, "production_deploy_offline_unfinished");
  assert.equal(slow.message, "web and computers are still being removed at mobilynet; they take no new requests, and it finishes removing them by itself.");
  assert.deepEqual(slow.details, { removing: ["web", "computers"] });
  assert.deepEqual(Object.keys(kept.items).sort(), ["resource.database", "resource.files"]);
  // Asked again once mobilynet moved on, nothing is left to delete or wait for.
  settle(standIn);
  for (const name of ["web", "computers"]) assert.equal(standIn.services.service(first.record.items[`service.${name}`].id).state, "deleted");
  assert.deepEqual(await takeOffline(adapter, kept, { pause: () => assert.fail("nothing to wait for") }), kept);
});

test("a Deploy after Take offline answers at the same DNS target: the domain's route is kept through Take offline, its name the same, and the new web takes it", async () => {
  const { standIn, adapter, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  standIn.verifyDomain(DOMAIN);
  const [route] = standIn.routes();
  const before = await adapter.domainRecords(DOMAIN);
  assert.deepEqual([before.target, before.live, before.records], [route.target, true, [{ name: `${DOMAIN}.`, type: "CNAME", data: `${route.target}.` }]]);

  const offline = await takeOffline(adapter, first.record, { pause: () => standIn.advance() });
  const during = await adapter.domainRecords(DOMAIN);
  assert.deepEqual([during.target, during.live, during.waitingFor, during.records], [route.target, false, "target", before.records]);

  const again = await run({ record: offline, commit: "c1" });
  assert.equal(again.outcome, "live", again.message);
  const web = again.record.items["service.web"].id;
  assert.notEqual(web, first.record.items["service.web"].id, "a new App Service");
  assert.deepEqual(standIn.routes().map((one) => [one.id, one.serviceId, one.target, one.live]), [[route.id, web, route.target, true]]);
  assert.deepEqual(await adapter.domainRecords(DOMAIN), before);
});

test("a renamed public service is made with no route, takes the domain's route once healthy, then the old one goes: the same DNS target, never a name_taken", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  standIn.verifyDomain(DOMAIN);
  const [route] = standIn.routes();
  const renamed = stackOf((lines) => lines.map((line) => line.replace("### Service `web`", "### Service `site`")));
  const records = ENV_RECORDS.map((one) => ({ ...one, services: (one.services ?? ["web"]).map((name) => (name === "web" ? "site" : name)) }));
  const before = standIn.requests().length;
  const done = [];
  const dark = [];
  let healthyAtTake = null;
  const report = (event) => {
    if (event.kind === "step" && event.phase === "done") done.push(`${event.step} ${event.service}`);
    if (event.kind === "step" && event.phase === "start" && event.step === "takeDomain") {
      healthyAtTake = standIn.services.all().find((one) => one.name === "memobot-site").instances.healthy;
    }
    // The address serves at every step: its one route live, sending to web, then to site.
    if (!standIn.routes().every((one) => one.live)) dark.push(event.words);
  };
  const second = await run({ stack: renamed, record: first.record, commit: "c1", records, report });
  assert.equal(second.outcome, "live", second.message);
  assert.deepEqual(dark, []);
  assert.equal(healthyAtTake, 2, "the domain moves once site's two instances are healthy");
  const site = second.record.items["service.site"].id;
  assert.equal(second.record.items["service.web"], undefined);
  assert.deepEqual(done.filter((one) => /^(createService site|takeDomain site|deleteService web)$/u.test(one)), ["createService site", "takeDomain site", "deleteService web"]);
  const asked = standIn.requests().slice(before);
  const made = asked.find((request) => request.method === "POST" && request.path.endsWith("/services") && request.body?.name === "memobot-site");
  assert.deepEqual(made.body.routes, [], "made with no route while web holds the domain");
  const take = asked.find((request) => request.method === "PATCH" && request.path === `/v1/services/${site}`);
  assert.deepEqual(take.body, { routes: [{ host: DOMAIN, tls: "edge", take: true }] });
  const healthyAt = asked.findIndex((request) => request === take);
  assert.ok(healthyAt < asked.findIndex((request) => request.method === "DELETE" && request.path === `/v1/services/${first.record.items["service.web"].id}`));
  assert.deepEqual(standIn.routes().map((one) => [one.id, one.serviceId, one.target, one.live]), [[route.id, site, route.target, true]]);
});

test("the domain step waits for the public service to serve its release, fails with its failure, and moves the domain only from a service the record holds", () => {
  const service = { id: "site" };
  const thing = { id: "svc_site", hosts: [] };
  const step = (more) => domainStep({ service, thing, domain: DOMAIN, holder: null, serving: true, failure: null, ...more });
  assert.equal(step({ thing: { ...thing, hosts: [DOMAIN] } }), null, "it has the domain");
  assert.equal(step({ thing: { id: "svc_site" } }), null, "an adapter that lists no hosts");
  assert.deepEqual(step({ serving: false }), { kind: "wait", words: `Waiting for site to be healthy before it takes ${DOMAIN}` });
  assert.deepEqual(step({ serving: false, failure: "site: it never got healthy" }), { kind: "failed", message: "site: it never got healthy" });
  assert.deepEqual(step({ holder: { name: "web" } }), { kind: "takeDomain", service: "site", id: "svc_site", domain: DOMAIN, from: "web" });
  assert.deepEqual(step({}), { kind: "takeDomain", service: "site", id: "svc_site", domain: DOMAIN });
  const record = { items: { "service.web": { kind: "service", name: "web", id: "svc_web" }, "service.site": { kind: "service", name: "site", id: "svc_site" } } };
  const things = { svc_web: { id: "svc_web", hosts: [DOMAIN] }, svc_site: { id: "svc_site", hosts: [] } };
  const thingOf = (item) => things[item.id];
  assert.equal(domainHolder(record, thingOf, DOMAIN, things.svc_site).name, "web");
  assert.equal(domainHolder(record, thingOf, DOMAIN, things.svc_web), null, "never the service itself");
  assert.equal(domainHolder({ items: { "service.site": record.items["service.site"] } }, thingOf, DOMAIN, things.svc_site), null, "a service the record doesn't hold is no holder");
});

test("a Deploy that goes live reports the address's DNS target once: the first names it, one with the same target says nothing, a record kept before any was reported hears it once, and a changed one is named with the one before", async () => {
  const { standIn, run, record } = setup();
  const said = [];
  const report = (event) => {
    if (event.kind === "address") said.push({ host: event.host, target: event.target, previous: event.previous, words: event.words });
  };
  const first = await run({ record, commit: "c1", report });
  assert.equal(first.outcome, "live", first.message);
  const [route] = standIn.routes();
  const stays = "stays the same through Take offline, every Deploy and a replaced App Service";
  assert.deepEqual(first.record.address, { host: DOMAIN, target: route.target });
  assert.deepEqual(said, [{ host: DOMAIN, target: route.target, previous: null,
    words: `${DOMAIN}'s DNS target is ${route.target}, which ${stays}. If its CNAME (or ALIAS) names anything else, such as an App Service's own name, change it once.` }]);
  const second = await run({ record: first.record, commit: "c1", report });
  assert.deepEqual([second.outcome, said.length], ["live", 1]);
  const { address, ...older } = second.record;
  const third = await run({ record: older, commit: "c1", report });
  assert.deepEqual([third.outcome, said.length, third.record.address], ["live", 2, address]);
  const moved = await run({ record: { ...third.record, address: { host: DOMAIN, target: "svc-old.us.mobilynet.standin" } }, commit: "c1", report });
  assert.deepEqual([moved.outcome, moved.record.address], ["live", address]);
  assert.deepEqual(said.at(-1), { host: DOMAIN, target: route.target, previous: "svc-old.us.mobilynet.standin",
    words: `${DOMAIN}'s DNS target is now ${route.target}, no longer svc-old.us.mobilynet.standin: change its CNAME (or ALIAS) to it once. It ${stays}.` });
});

/** Every value of the release's Env (but a count, which any time holds), which no report of a Deploy may carry. */
const ENV_VALUES = Object.values(ENV).filter((value) => value.length > 4);

test("a Deploy reports each step as it starts and ends in the engine's words, each wait once, each retry and its end, with no setting's value; a report that throws never stops it", async () => {
  const { run, record } = setup();
  const events = [];
  const first = await run({ record, commit: "c1", report: (event) => events.push(event) });
  assert.equal(first.outcome, "live", first.message);
  for (const event of events) assert.ok(Number.isFinite(Date.parse(event.at)), `${JSON.stringify(event)} has its time`);
  const text = JSON.stringify(events);
  for (const value of ENV_VALUES) assert.equal(text.includes(value), false, `no report carries ${value}`);

  const said = events.filter((event) => event.kind === "step").map((event) => `${event.phase} ${event.words}`);
  for (const words of [
    "Making the hosted service for database",
    "Making the hosted service for files",
    `Adding the domain ${DOMAIN}`,
    "Uploading the release of computers",
    "Making App Service computers, internal: only the app's other services reach it",
    "Linking computers to database",
    "Uploading the release of web",
    `Making App Service web, public behind the load balancer at ${DOMAIN}`,
    "Reading how the update of computers ended"
  ]) {
    const start = said.indexOf(`start ${words}`);
    assert.ok(start >= 0, `${words} starts: ${said.join(" | ")}`);
    assert.ok(said.indexOf(`done ${words}`) > start, `${words} ends after it starts`);
  }
  // In the order the steps run: the resources, the domain, the internal service, then the public one.
  const order = ["start Making the hosted service for database", `start Adding the domain ${DOMAIN}`, "start Uploading the release of computers",
    "start Uploading the release of web"].map((line) => said.indexOf(line));
  assert.deepEqual([...order].sort((one, other) => one - other), order);
  // A step that starts a refresh names it, so its caller can follow what the provider does; reading how it ended too.
  const made = events.find((event) => event.kind === "step" && event.phase === "done" && event.step === "createService" && event.service === "web");
  assert.deepEqual(Object.keys(made.refresh ?? {}).sort(), ["refreshId", "serviceId"]);
  assert.equal(made.refresh.serviceId, first.record.items["service.web"].id);
  const read = events.find((event) => event.step === "checkRefresh" && event.phase === "done" && event.service === "web");
  assert.equal(read.refresh.refreshId, made.refresh.refreshId);
  // A wait is said when its words change, never again at each step it lasts.
  const waits = events.filter((event) => event.kind === "wait").map((event) => event.words);
  assert.ok(waits.length > 0);
  assert.ok(waits.every((words, index) => index === 0 || words !== waits[index - 1]), waits.join(" | "));
  assert.deepEqual(events.at(-1), { at: events.at(-1).at, kind: "end", outcome: "live" });

  // A report that throws, or rejects, is the caller's problem alone.
  const again = await run({ record: first.record, commit: "c2", report: () => {
    throw new Error("the report broke");
  } });
  assert.equal(again.outcome, "live", again.message);
  const third = await run({ record: again.record, commit: "c3", report: () => Promise.reject(new Error("the report broke")) });
  assert.equal(third.outcome, "live", third.message);
});

test("a provider read that fails while a Deploy waits (no answer, a 5xx, its rate limit) is tried again at the next step, said as a retry, and the Deploy goes live", async () => {
  const { standIn, record } = setup();
  // mobilynet answers nothing at the inventory after the first two waits, then a 503, then its rate limit, as it may
  // while it builds; the Deploy carries on.
  const originalFetch = standIn.fetch;
  let pauses = 0;
  let failing = [];
  const fetchOf = (url, init) => {
    const next = failing.shift();
    if (next === "down") return Promise.reject(new TypeError("fetch failed"));
    if (next) {
      return Promise.resolve(new Response(JSON.stringify({ error: { code: next === 503 ? "internal_error" : "rate_limited", message: `mobilynet answered ${next}` } }),
        { status: next, headers: { "content-type": "application/json" } }));
    }
    return originalFetch(url, init);
  };
  const client = createMobilynetClient({ baseUrl: standIn.baseUrl, credential: standIn.key, fetch: fetchOf });
  const adapter = createMobilynetAdapter({ client, project: standIn.projectId, leases: false });
  const stack = stackOf();
  const plan = planOf({ needs: stack.needs, record, observed: await adapter.inventory(), offer: await adapter.offer() });
  const events = [];
  const result = await deploy({
    adapter, needs: stack.needs, record, planHash: plan.hash, release: releaseOf("c1", stack), holder: HOLDER,
    report: (event) => events.push(event),
    pause: () => {
      pauses += 1;
      // The next request after this pause is the inventory of the next step: each kind of failure once.
      if (pauses === 3) failing = ["down"];
      if (pauses === 4) failing = [503];
      if (pauses === 5) failing = [429];
      standIn.advance();
    }
  });
  assert.equal(result.outcome, "live", result.message);
  const retries = events.filter((event) => event.kind === "retry");
  assert.deepEqual(retries.map((event) => event.words), ["Reading mobilynet again", "Reading mobilynet again", "Reading mobilynet again"]);
  assert.match(retries[0].message, /mobilynet did not answer: fetch failed/u);
  assert.deepEqual(retries.slice(1).map((event) => event.message), ["mobilynet answered 503", "mobilynet answered 429"]);
});

test("reads of the provider that keep failing while a Deploy waits are tried again further apart, one pause, then two, four and at most six", async () => {
  const { standIn, record } = setup();
  const originalFetch = standIn.fetch;
  let down = 0;
  const client = createMobilynetClient({
    baseUrl: standIn.baseUrl, credential: standIn.key,
    fetch: (url, init) => (down > 0 && (down -= 1, true) ? Promise.reject(new TypeError("fetch failed")) : originalFetch(url, init))
  });
  const adapter = createMobilynetAdapter({ client, project: standIn.projectId, leases: false });
  const stack = stackOf();
  const plan = planOf({ needs: stack.needs, record, observed: await adapter.inventory(), offer: await adapter.offer() });
  const said = [];
  let pauses = 0;
  const result = await deploy({
    adapter, needs: stack.needs, record, planHash: plan.hash, release: releaseOf("c1", stack), holder: HOLDER,
    report: (event) => said.push({ ...event, pauses }),
    pause: () => {
      pauses += 1;
      // Once the computers' build runs, mobilynet answers no read for its next six inventories (two calls each).
      if (pauses === 4) down = 12;
      standIn.advance();
    }
  });
  assert.equal(result.outcome, "live", result.message);
  const retries = said.filter((event) => event.kind === "retry");
  assert.deepEqual(retries.map((event) => event.attempt), [1, 2, 3, 4, 5, 6]);
  const gaps = retries.slice(1).map((event, index) => event.pauses - retries[index].pauses);
  assert.deepEqual(gaps, [1, 2, 4, 6, 6]);
});

test("a Deploy that stopped while its build ran, the build then failing, is resumed by the next: it reads how that refresh ended, names its reason, lets go of the links made against it and makes them again", async () => {
  const { standIn, run, record } = setup();
  const tooLarge = "The output is 4440 MiB; it may be at most 4096 MiB.";
  // computers' build will fail, naming why. The editor's run stops at the first pause after computers is linked to the
  // database while its build runs (a read it could not try again, or the editor stopping): its record says deploying,
  // computers made, its link made ahead.
  standIn.faults.releaseBuildFails = { code: "output_too_large", message: tooLarge };
  let kept = null;
  const stopped = await run({
    record, commit: "c1",
    save: (one) => {
      kept = structuredClone(one);
      return one;
    },
    pause: () => {
      if (kept?.items["resource.database"]?.links?.computers) throw new Error("the editor stopped");
      standIn.advance();
    }
  }).catch((error) => error);
  assert.equal(stopped.message, "the editor stopped");
  assert.equal(kept.run.state, "deploying");
  assert.deepEqual(kept.run.services.computers.linkedAhead, ["database"]);
  // mobilynet then fails the refresh, and the link made against it ends with it.
  settle(standIn);
  standIn.faults.releaseBuildFails = false;
  const computersId = kept.items["service.computers"].id;
  assert.equal(standIn.services.refreshes(computersId).at(-1).error.message, tooLarge);

  const events = [];
  const resumed = await run({ record: kept, commit: "c2", report: (event) => events.push(event) });
  assert.equal(resumed.outcome, "live", resumed.message);
  const settled = events.filter((event) => event.step === "settleRefresh");
  assert.deepEqual(settled.map((event) => [event.phase, event.service]), [["start", "computers"], ["done", "computers"]]);
  assert.equal(settled[1].message, `It failed: ${tooLarge} This Deploy hands computers its release again.`);
  assert.equal(resumed.record.items["service.computers"].id, computersId, "computers is the App Service made before, not made twice");
  for (const item of ["resource.database", "resource.files"]) {
    const held = standIn.hosted.service(resumed.record.items[item].id).links.filter((link) => ["issuing", "active"].includes(link.state));
    assert.deepEqual(held.map((link) => link.consumer.id).sort(), [computersId, resumed.record.items["service.web"].id].sort());
    assert.deepEqual(Object.values(resumed.record.items[item].links).sort(), held.map((link) => link.id).sort());
  }
});

/** Whether an instance has both resources' settings. @param {any} instance */
const withResources = (instance) => namesOf(instance, "V64_DATABASE_").length > 0 && namesOf(instance, "V64_FILES_").length > 0;

/**
 * That each resource holds a link to each service and the record keeps the ids mobilynet holds, and that computers'
 * instances serving now run this Deploy's release with both resources' settings.
 * @param {any} standIn @param {any} kept the record the Deploy answered
 */
function assertLinkedAndServing(standIn, kept) {
  const { items } = kept;
  const computersId = items["service.computers"].id;
  for (const item of ["resource.database", "resource.files"]) {
    const held = standIn.hosted.service(items[item].id).links.filter((link) => ["issuing", "active"].includes(link.state));
    assert.deepEqual(held.map((link) => link.consumer.id).sort(), [computersId, items["service.web"].id].sort(), `${item} holds a link to each service`);
    assert.deepEqual(Object.values(items[item].links).sort(), held.map((link) => link.id).sort(), `the record keeps the links of ${item} that mobilynet holds`);
  }
  const serving = standIn.services.instances(computersId).filter((one) => !one.removedReason);
  assert.ok(serving.length > 0 && serving.every((one) => one.version === kept.run.services.computers.version && withResources(one)),
    "computers' instances serve this Deploy's release with the database's and the files' settings");
}

test("a link mobilynet ended while the record still holds it is made again by the next Deploy, and the service serves with that resource", async () => {
  const { standIn, client, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const { items } = first.record;
  // mobilynet ends computers' two links (removed by hand, or with a refresh that failed): the record still holds them.
  for (const item of ["resource.database", "resource.files"]) await client.unlinkHostedService(items[item].id, items[item].links.computers);
  settle(standIn);
  for (const item of ["resource.database", "resource.files"]) {
    assert.equal(standIn.hosted.service(items[item].id).links.find((link) => link.id === items[item].links.computers).state, "revoked");
  }

  // Linked again before its new release: the release it runs names both needs, so mobilynet takes each link against it,
  // and the release's refresh, queued behind the links' settings refresh, starts every instance with them.
  const second = await run({ record: first.record, commit: "c2" });
  assert.equal(second.outcome, "live", second.message);
  assertLinkedAndServing(standIn, second.record);
});

test("a service that runs a release is linked to a resource it lost before it is handed its next release, so even a build mobilynet reuses at once starts no instance without it", async () => {
  const { standIn, client, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const { items } = first.record;
  const computersId = items["service.computers"].id;
  const databaseId = items["resource.database"].id;
  // computers' database link ends (removed by hand) while computers runs c1, whose release names the database.
  await client.unlinkHostedService(databaseId, items["resource.database"].links.computers);
  settle(standIn);
  // A refresh whose build is done starts its instances in the step it starts, as mobilynet's reconcile does with a
  // reused build: no step ever shows it building (a production Deploy, 18 Nov 23:42:10).
  standIn.faults.instantBuilds = true;
  const before = standIn.requests().length;
  const second = await run({ record: first.record, commit: "c2" });
  standIn.faults.instantBuilds = false;
  assert.equal(second.outcome, "live", second.message);
  const rolled = standIn.services.refreshes(computersId).find((one) => one.kind === "release" && one.toVersion === second.record.run.services.computers.version);
  assert.equal(rolled.state, "succeeded");
  const started = standIn.services.instances(computersId).filter((one) => one.refreshId === rolled.id);
  assert.ok(started.length >= 2, "c2's refresh started computers' instances");
  assert.deepEqual(started.filter((one) => !withResources(one)).map((one) => one.id), [], "no instance of c2 started without its database");
  assert.deepEqual(started.filter((one) => one.removedReason === "link_changed").map((one) => one.id), [], "none was replaced for a late link");
  assertLinkedAndServing(standIn, second.record);

  // The link was asked for before computers' release, so mobilynet checked it against the release computers runs and
  // the release's refresh started from settings that already had it.
  const asked = requestsAfter(standIn, before).filter(isWrite);
  const linkAt = asked.findIndex((request) => request.path === `/v1/hosted-services/${databaseId}/links` && request.body?.consumer?.service === computersId);
  const releaseAt = asked.findIndex((request) => request.path === `/v1/services/${computersId}/releases`);
  assert.ok(linkAt >= 0 && releaseAt > linkAt, "computers is linked to its database before it is handed c2");
  assert.equal(asked[linkAt].status, 202);
  // A link made against the release computers runs is no link made ahead: a failed refresh never ends it.
  assert.deepEqual(second.record.run.services.computers.linkedAhead ?? [], []);
});

test("a service whose first release failed is linked the moment its next refresh opens; with a build mobilynet reuses at once, mobilynet replaces the instances it started first", async () => {
  const { standIn, run, record } = setup();
  standIn.faults.releaseBuildFails = true;
  const failed = await run({ record, commit: "c1" });
  standIn.faults.releaseBuildFails = false;
  assert.equal(failed.outcome, "failed");
  const computersId = failed.record.items["service.computers"].id;
  // computers runs no release, so mobilynet takes a link of it only ahead of a refresh under way (engine-support M14):
  // with a build done at once, that refresh started its instances in the step it started.
  standIn.faults.instantBuilds = true;
  const second = await run({ record: failed.record, commit: "c2" });
  standIn.faults.instantBuilds = false;
  assert.equal(second.outcome, "live", second.message);
  assertLinkedAndServing(standIn, second.record);
  // Linked at the first step its refresh was open, with no wait between.
  const handed = second.steps.indexOf("releaseService computers");
  assert.deepEqual(second.steps.slice(handed, handed + 3), ["releaseService computers", "link computers", "link computers"]);
  // mobilynet drained the instances it had started without them (link_changed) and started them again with both.
  const rolled = standIn.services.refreshes(computersId).find((one) => one.kind === "release" && one.toVersion === second.record.run.services.computers.version);
  const started = standIn.services.instances(computersId).filter((one) => one.refreshId === rolled.id);
  assert.ok(started.some((one) => one.removedReason === "link_changed"), "the instances started before the links were replaced");
  assert.ok(started.filter((one) => !one.removedReason).every(withResources));
});

test("links mobilynet ended with a build no Deploy read are made again: the run that made them stopped, and the next started while that build still ran", async () => {
  const { standIn, run, record } = setup();
  const tooLarge = "The output is 4440 MiB; it may be at most 4096 MiB.";
  // The first Deploy links computers to both resources while its first build runs (that build to fail on its output's
  // size), then stops in its wait, as one that met a read it could not try again did: its record still deploying.
  standIn.faults.releaseBuildFails = { code: "output_too_large", message: tooLarge };
  let kept = null;
  const linkedTo = (resource) => Boolean(kept?.items[`resource.${resource}`]?.links?.computers);
  const stopped = await run({
    record, commit: "c1",
    save: (one) => {
      kept = structuredClone(one);
      return one;
    },
    pause: () => {
      if (linkedTo("database") && linkedTo("files")) throw new TypeError("mobilynet did not answer: fetch failed");
      // Held still between the two links, so both are made while the build runs.
      if (!linkedTo("database")) standIn.advance();
    }
  }).catch((error) => error);
  assert.equal(stopped.message, "mobilynet did not answer: fetch failed");
  assert.deepEqual([kept.run.state, kept.run.services.computers.linkedAhead], ["deploying", ["database", "files"]]);
  const computersId = kept.items["service.computers"].id;
  assert.equal(standIn.services.refreshes(computersId).at(-1).state, "building");

  // The next Deploy starts while that build still runs, so it has nothing to let go yet; the build then fails, and
  // mobilynet ends both links with it, while the record still holds them.
  standIn.faults.releaseBuildFails = false;
  const events = [];
  const resumed = await run({ record: kept, commit: "c2", report: (event) => events.push(event) });
  assert.equal(resumed.outcome, "live", resumed.message);
  const settled = events.filter((event) => event.step === "settleRefresh" && event.phase === "done");
  assert.deepEqual(settled.map((event) => [event.service, event.message]), [["computers", "It is building."]]);
  const first = standIn.services.refreshes(computersId).find((one) => one.kind === "create");
  assert.deepEqual([first.state, first.error.message], ["failed", tooLarge]);
  for (const item of ["resource.database", "resource.files"]) {
    assert.equal(standIn.hosted.service(kept.items[item].id).links.find((link) => link.id === kept.items[item].links.computers).state, "revoked");
  }
  assert.equal(resumed.record.items["service.computers"].id, computersId, "computers is the App Service made before");
  assertLinkedAndServing(standIn, resumed.record);
  // computers runs no release yet, so the links are made ahead of the release this Deploy handed it, whose own
  // instances start with both resources: none started without its database.
  const rolled = standIn.services.refreshes(computersId).find((one) => one.kind === "release" && one.toVersion === resumed.record.run.services.computers.version);
  const started = standIn.services.instances(computersId).filter((one) => one.refreshId === rolled.id);
  assert.ok(started.length > 0 && started.every(withResources), "the release's own instances started with both resources");
});

test("a record made again from labels, which holds no links, takes up the links mobilynet holds", async () => {
  const { standIn, adapter, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const [rebuilt] = await rebuildFromLabels(adapter, standIn.projectId, { app: "memobot", environment: "production" });
  assert.equal(rebuilt.items["resource.database"].links, undefined);

  const again = await run({ record: rebuilt, commit: "c2" });
  assert.equal(again.outcome, "live", again.message);
  assertLinkedAndServing(standIn, again.record);
  for (const item of ["resource.database", "resource.files"]) {
    assert.deepEqual(again.record.items[item].links, first.record.items[item].links, `${item}'s links are those the first Deploy made, none made twice`);
  }
});

test("the mobilynet inventory lists the links mobilynet holds of each hosted service Vibe64 made, one being removed left out, and reads no other's", async () => {
  const { standIn, client, adapter, run, record, projectId } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const { items } = first.record;
  const { hostedService: byHand } = await client.project(projectId).createHostedService({ app: "valkey-9", name: "by-hand", labels: { team: "ops" } }, { idempotencyKey: "hosted-by-hand" });
  settle(standIn);
  await client.unlinkHostedService(items["resource.files"].id, items["resource.files"].links.computers);
  const at = standIn.requests().length;
  const things = new Map((await adapter.inventory()).map((thing) => [thing.id, thing]));
  const linksOf = (item) => things.get(items[item].id).links.map((link) => [link.id, link.service, link.need]).sort();
  assert.deepEqual(linksOf("resource.database"), [
    [items["resource.database"].links.computers, items["service.computers"].id, "V64_DATABASE"], [items["resource.database"].links.web, items["service.web"].id, "V64_DATABASE"]
  ].sort());
  assert.deepEqual(linksOf("resource.files"), [[items["resource.files"].links.web, items["service.web"].id, "V64_FILES"]], "a link being removed is not held");
  assert.equal(things.get(byHand.id).links, null);
  assert.deepEqual(requestsAfter(standIn, at).filter((request) => request.path.includes(byHand.id)), [], "a hosted service Vibe64 didn't make is only listed");
});

test("a build that fails naming why fails the Deploy with mobilynet's own words", async () => {
  const { standIn, run, record } = setup();
  standIn.faults.releaseBuildFails = { code: "output_too_large", message: "The output is 4440 MiB; it may be at most 4096 MiB." };
  const failed = await run({ record, commit: "c1" });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.message, "computers: the release did not go live: The output is 4440 MiB; it may be at most 4096 MiB.");
});

test("take offline reports each App Service deleted, the wait while the provider removes them and each one gone, and tries a failed read again", async () => {
  const { standIn, run, record } = setup();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const adapter = setupAdapterOf(standIn);
  const events = [];
  let reads = 0;
  const kept = await takeOffline(adapter, first.record, {
    report: (event) => events.push(event),
    pause: () => {
      reads += 1;
      if (reads === 1) standIn.faults.down = true;
      else standIn.faults.down = false;
      standIn.advance();
    }
  });
  assert.deepEqual(Object.keys(kept.items).sort(), ["resource.database", "resource.files"]);
  const said = events.map((event) => [event.kind, event.phase, event.words].filter(Boolean).join(" "));
  assert.deepEqual(said.filter((line) => line.startsWith("step")), [
    "step start Deleting App Service web", "step done Deleting App Service web",
    "step start Deleting App Service computers", "step done Deleting App Service computers"
  ]);
  assert.ok(said.includes("wait Waiting for mobilynet to remove web and computers"), said.join(" | "));
  assert.ok(said.includes("retry Reading mobilynet again"), said.join(" | "));
  assert.deepEqual(events.at(-1).kind, "end");
  assert.equal(events.at(-1).outcome, "offline");
});

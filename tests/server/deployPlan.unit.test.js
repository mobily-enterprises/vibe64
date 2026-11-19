import assert from "node:assert/strict";
import test from "node:test";

import { vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { createMobilynetAdapter } from "../../packages/vibe64-deploy/src/adapters/mobilynet/index.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { planOf } from "../../packages/vibe64-deploy/src/plan.js";
import { labelsFor, newRecord } from "../../packages/vibe64-deploy/src/record.js";
import { MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES } from "../fixtures/deploymentServices.js";
import { world } from "./vibe64DeployStandInHelpers.js";

// The Plan of a two-service app at mobilynet: the sizes each service may run on, each item's verb, drift and the
// things left alone, the quote at list price, and the hash a Deploy is held to. The offer is the stand-in's, read
// through the mobilynet adapter; the record and what the provider reports are written out here.
const NANO = 1_000_000_000n;
const nano = (dollars) => (BigInt(dollars * 100) * NANO / 100n).toString();

/** The two-service needs from a Deployment section (its lines changed by `edit`) and these resources. */
function needsOf(edit = (lines) => lines, resources = MEMOBOT_RESOURCES) {
  const deployment = vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources },
    section: { status: "ready", stackHash: "sha256:stack", lines: edit([...MEMOBOT_DEPLOYMENT_LINES]), components: [], source: "project" }
  });
  const { needs, problem } = needsOfStack(deployment, { preferredAlternative, resourceKindIsDatabase });
  assert.equal(problem, null);
  return needs;
}

const NEEDS = needsOf();

/** The record after the first deploy, and what mobilynet reports of it: each thing labelled, as the record left it. */
function deployed() {
  const record = newRecord({ app: "memobot", environment: "production", provider: { id: "mobilynet", project: "prj_q7" } });
  const items = [
    { kind: "service", name: "web", id: "svc_web", providerName: "memobot-web", size: "a-2", instances: 2, exposure: "public" },
    { kind: "service", name: "computers", id: "svc_cmp", providerName: "memobot-computers", size: "a-8", instances: 2, exposure: "internal" },
    { kind: "resource", name: "database", id: "hs_db", providerName: "memobot-database", size: "small", resourceKind: "postgresql" },
    { kind: "resource", name: "files", id: "hs_files", providerName: "memobot-files", size: "small", resourceKind: "bucket" }
  ];
  for (const item of items) record.items[`${item.kind}.${item.name}`] = { ...item, origin: "made" };
  record.choices = {
    services: { web: { size: "a-2", instances: 2 }, computers: { size: "a-8", instances: 2 } },
    resources: { database: { size: "small" }, files: { size: "small" } }
  };
  const observed = items.map(({ kind, name, id, providerName, size, instances, exposure, resourceKind }) => ({
    id, name: providerName, kind, labels: labelsFor(record, { kind, name }), size, state: "running",
    ...(kind === "service" ? { instances, exposure } : { resourceKind })
  }));
  return { record, observed };
}

const verbs = (plan) => Object.fromEntries(plan.items.map((item) => [`${item.kind}.${item.name}`, item.verb]));

test("the first plan makes everything new, offers each service the sizes that meet its machine, and quotes at list price", async () => {
  const { standIn, client } = world();
  standIn.setQuota(standIn.projectId, { vcpus: 96, memoryGib: 192 });
  const offer = await createMobilynetAdapter({ client, project: standIn.projectId }).offer();
  const plan = planOf({ needs: NEEDS, record: null, observed: [], offer });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(verbs(plan), { "service.web": "new", "service.computers": "new", "resource.database": "new", "resource.files": "new" });
  // web needs 2 vCPU and 2 GiB: a-2, a-4 and a-8; computers 8 and 16: a-8 alone. Production starts with 2 of each.
  assert.deepEqual(plan.services.map(({ id, exposure, sizes, defaultSize, instances, balancer }) => ({ id, exposure, sizes: sizes.map((size) => size.name), defaultSize, instances, balancer })), [
    { id: "web", exposure: "public", sizes: ["a-2", "a-4", "a-8"], defaultSize: "a-2", instances: { min: 1, max: 6, default: 2, live: null }, balancer: { monthlyNano: nano(10) } },
    { id: "computers", exposure: "internal", sizes: ["a-8"], defaultSize: "a-8", instances: { min: 1, max: 20, default: 2, live: null }, balancer: null }
  ]);
  assert.deepEqual(plan.resources.map(({ id, kind, defaultSize }) => ({ id, kind, defaultSize })), [
    { id: "database", kind: "postgresql", defaultSize: "small" }, { id: "files", kind: "bucket", defaultSize: "small" }
  ]);
  // web 2 x a-2 and its load balancer, computers 2 x a-8, a small PostgreSQL (m-1, 10 GiB) and a small Garage (m-1,
  // 50 GiB: 30 past the 20 the size includes).
  assert.deepEqual(plan.lines, [
    { item: "service.web", part: "instances", size: "a-2", count: 2, monthlyNano: nano(32) },
    { item: "service.web", part: "load balancer", monthlyNano: nano(10) },
    { item: "service.computers", part: "instances", size: "a-8", count: 2, monthlyNano: nano(128) },
    { item: "resource.database", part: "postgresql", size: "small", monthlyNano: nano(10) },
    { item: "resource.files", part: "bucket", size: "small", monthlyNano: nano(13) }
  ]);
  assert.equal(plan.monthlyNano, nano(193));
  assert.match(plan.hash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(planOf({ needs: NEEDS, record: null, observed: [], offer }).hash, plan.hash, "the same inputs, the same hash");

  // A service no offered size meets is refused, naming what it needs.
  const big = planOf({ needs: { ...NEEDS, services: NEEDS.services.map((one) => (one.id === "computers" ? { ...one, atLeast: { vcpus: 16, memoryGib: 64 } } : one)) }, record: null, observed: [], offer });
  assert.deepEqual(big.problems.map(({ code, message }) => ({ code, message })), [{
    code: "production_size_unavailable", message: "mobilynet offers no size with at least 16 vCPU and 64 GiB right now, which computers needs."
  }]);
  // A choice outside what the Stack and the offer allow is refused, naming the choice.
  const wrong = planOf({ needs: NEEDS, record: null, observed: [], offer, choices: { services: { computers: { size: "a-4", instances: 21 } } } });
  assert.deepEqual(wrong.problems.map((one) => one.message), [
    "choices.services.computers.size is one of a-8.",
    "choices.services.computers.instances is 1 to 20, as genesis/stack.md's - Instances: says."
  ]);
});

test("the plan counts what a Deploy adds against the provider project's quotas and names any it would pass, by how much", async () => {
  const { standIn, client } = world();
  const adapter = createMobilynetAdapter({ client, project: standIn.projectId });
  // mobilynet's default quotas: 10 machines, 20 vCPU, 40 GiB, 1,000 GiB of disk. The first Deploy adds two a-2 webs
  // (2 vCPU, 2 GiB each), two a-8 computers (8 and 16) and two m-1 hosted services (1 and 2, 10 and 50 GiB of disk).
  const first = planOf({ needs: NEEDS, record: null, observed: [], offer: await adapter.offer() });
  assert.deepEqual(first.quota, { checked: true, quotas: [
    { quota: "machines", unit: "machines", limit: 10, used: 0, adding: 2 },
    { quota: "vcpus", unit: "vCPU", limit: 20, used: 0, adding: 22 },
    { quota: "memoryGib", unit: "GiB of RAM", limit: 40, used: 0, adding: 40 },
    { quota: "diskGib", unit: "GiB of data disk", limit: 1000, used: 0, adding: 60 }
  ] });
  assert.deepEqual(first.problems, [{
    code: "production_quota_short", item: "quota.vcpus",
    message: "mobilynet's quota of vCPU for this project is 20, 0 in use: this Deploy needs 22 more, 2 more than is left. "
      + "Ask mobilynet to raise it, or choose smaller sizes or fewer instances, then deploy to production."
  }]);
  // One computer fits: 14 vCPU and 24 GiB.
  assert.deepEqual(planOf({ needs: NEEDS, record: null, observed: [], offer: await adapter.offer(), choices: { services: { computers: { instances: 1 } } } }).problems, []);

  // Once deployed, what runs is counted as used, and a later plan adds only what grows: web made larger, a-2 to a-4,
  // is 4 vCPU and 12 GiB more on its two instances. A running service's count is the provider's, so a count raised
  // there adds nothing, even at a quota already passed.
  const { record, observed } = deployed();
  const at = (used, limits = {}) => {
    standIn.setQuota(standIn.projectId, limits);
    return adapter.offer().then((offer) => ({ ...offer, quota: { ...offer.quota, quotas: offer.quota.quotas.map((line) => ({ ...line, used: used[line.quota] ?? line.used })) } }));
  };
  const running = { machines: 2, vcpus: 22, memoryGib: 40, diskGib: 60 };
  const larger = planOf({ needs: NEEDS, record, observed, offer: await at(running, { vcpus: 24, memoryGib: 64 }), choices: { services: { web: { size: "a-4" } } } });
  assert.deepEqual(larger.quota.quotas.map(({ quota, adding }) => [quota, adding]), [["machines", 0], ["vcpus", 4], ["memoryGib", 12], ["diskGib", 0]]);
  assert.deepEqual(larger.problems.map((one) => one.message), [
    "mobilynet's quota of vCPU for this project is 24, 22 in use: this Deploy needs 4 more, 2 more than is left. "
      + "Ask mobilynet to raise it, or choose smaller sizes or fewer instances, then deploy to production."
  ]);
  const passed = await at(running, { vcpus: 10, memoryGib: 10 });
  const raised = observed.map((thing) => (thing.id === "svc_cmp" ? { ...thing, instances: 3 } : thing));
  for (const now of [observed, raised]) assert.deepEqual(planOf({ needs: NEEDS, record, observed: now, offer: passed }).problems, []);

  // A provider whose offer doesn't say its quotas: not checked, and the plan says so.
  const silent = { ...await adapter.offer(), quota: undefined };
  assert.deepEqual(planOf({ needs: NEEDS, record: null, observed: [], offer: silent }).quota,
    { checked: false, words: "mobilynet doesn't say its quotas, so a Deploy doesn't check them before it starts." });
  const unchecked = planOf({ needs: NEEDS, record: null, observed: [], offer: { ...silent, quota: { unchecked: "Not counted here." } } });
  assert.deepEqual([unchecked.quota, unchecked.problems], [{ checked: false, words: "Not counted here." }, []]);
  // The quotas' use is left out of the hash: it moves with the rest of the provider project.
  assert.equal(planOf({ needs: NEEDS, record, observed, offer: await at({ vcpus: 3 }) }).hash, planOf({ needs: NEEDS, record, observed, offer: await at({ vcpus: 4 }) }).hash);
});

test("a later plan keeps what didn't change, changes a size, removes a dropped service and disconnects a dropped resource", async () => {
  const { standIn, client } = world();
  const offer = await createMobilynetAdapter({ client, project: standIn.projectId }).offer();
  const { record, observed } = deployed();
  // The same Stack at a new commit: every item kept, nothing to decide.
  const same = planOf({ needs: NEEDS, record, observed, offer });
  assert.deepEqual(same.problems, []);
  assert.deepEqual(verbs(same), { "service.web": "kept", "service.computers": "kept", "resource.database": "kept", "resource.files": "kept" });
  assert.deepEqual(same.foreign, []);

  // A size chosen: web changed, a-2 to a-4, on the two instances it runs.
  const larger = planOf({ needs: NEEDS, record, observed, offer, choices: { services: { web: { size: "a-4" } } } });
  assert.deepEqual(larger.items.find((item) => item.name === "web"), {
    kind: "service", name: "web", verb: "changed", id: "svc_web", changes: [{ field: "size", from: "a-2", to: "a-4" }], drift: []
  });
  assert.deepEqual(larger.choices.services.web, { size: "a-4", instances: 2 });
  assert.notEqual(larger.hash, same.hash);

  // The Stack drops computers (and web's Reaches) and renames files to uploads: computers removed, files disconnected
  // and still priced, uploads new.
  const dropped = needsOf((lines) => lines.slice(0, lines.indexOf("### Service `computers`: bots' computers, each desktop in its own gVisor sandbox"))
    .filter((line) => !line.startsWith("- Reaches:")), [MEMOBOT_RESOURCES[0], { ...MEMOBOT_RESOURCES[1], resource: { ...MEMOBOT_RESOURCES[1].resource, id: "uploads" } }]);
  const plan = planOf({ needs: dropped, record, observed, offer });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(verbs(plan), { "service.web": "kept", "resource.database": "kept", "resource.uploads": "new", "service.computers": "removed", "resource.files": "disconnected" });
  assert.deepEqual(plan.lines.filter((line) => line.item === "resource.files"), [{ item: "resource.files", part: "bucket", size: "small", monthlyNano: nano(13) }]);

  // A resource whose kind changed is refused with the fix: a Deploy never replaces what holds data.
  const kind = planOf({ needs: { ...NEEDS, resources: NEEDS.resources.map((one) => (one.id === "database" ? { ...one, kind: "mysql" } : one)) }, record, observed, offer });
  assert.equal(kind.problems[0].code, "production_resource_kind_changed");
  assert.match(kind.problems[0].message, /^database is a postgresql at mobilynet and genesis\/stack\.md now says mysql\. A Deploy never replaces what holds data: keep database as it was .* declare the new one under a new name/u);
  // A service whose exposure changed is replaced: it holds no data.
  const exposed = planOf({ needs: { ...NEEDS, services: NEEDS.services.map((one) => (one.id === "computers" ? { ...one, exposure: "public", reached: "any" } : one)) }, record, observed, offer });
  assert.deepEqual(exposed.items.find((item) => item.name === "computers").changes, [{ field: "exposure", from: "internal", to: "public" }]);
  assert.equal(verbs(exposed)["service.computers"], "replaced");
});

test("a running App Service's count is the provider's: the Plan shows and prices it, read-only, never changes it, and refuses another; a service it makes starts with the card's count or the Stack's", async () => {
  const { standIn, client } = world();
  const offer = await createMobilynetAdapter({ client, project: standIn.projectId }).offer();
  // The record holds a count for each service, as records before 19 Nov 2026 did: the Plan ignores it.
  const { record, observed } = deployed();
  // An app scaling its own service raised computers to 4 at mobilynet: the Plan shows 4 and prices 4, with no
  // question and nothing to change.
  const scaled = observed.map((thing) => (thing.id === "svc_cmp" ? { ...thing, instances: 4 } : thing));
  const plan = planOf({ needs: NEEDS, record, observed: scaled, offer });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.items.find((item) => item.name === "computers"), { kind: "service", name: "computers", verb: "kept", id: "svc_cmp", changes: [], drift: [] });
  assert.deepEqual(plan.services.map((service) => [service.id, service.instances]), [
    ["web", { min: 1, max: 6, default: 2, live: 2 }], ["computers", { min: 1, max: 20, default: 2, live: 4 }]
  ]);
  assert.deepEqual(plan.choices.services.computers, { size: "a-8", instances: 4 });
  assert.deepEqual(plan.lines.find((line) => line.item === "service.computers"), { item: "service.computers", part: "instances", size: "a-8", count: 4, monthlyNano: nano(256) });
  // The count it runs, asked again, is no change; another is refused, naming the scale action.
  assert.deepEqual(planOf({ needs: NEEDS, record, observed: scaled, offer, choices: { services: { computers: { instances: 4 } } } }).problems, []);
  assert.deepEqual(planOf({ needs: NEEDS, record, observed: scaled, offer, choices: { services: { computers: { instances: 2 } } } }).problems, [{
    code: "production_instances_running", item: "service.computers",
    message: "computers runs 4 instances at mobilynet: a Deploy leaves the count of an App Service that runs as it is. Set its instances to change it."
  }]);
  // A count set at the provider beyond the Stack's - Instances: range is the provider's to refuse: shown, not refused here.
  const many = planOf({ needs: NEEDS, record, observed: observed.map((thing) => (thing.id === "svc_cmp" ? { ...thing, instances: 25 } : thing)), offer });
  assert.deepEqual([many.problems, many.choices.services.computers.instances], [[], 25]);

  // A service the Deploy makes takes the card's count, within the range, or the Stack's starting count: a new one,
  // and one gone at the provider, which starts again from the Stack's, never the record's.
  const fresh = planOf({ needs: NEEDS, record: null, observed: [], offer, choices: { services: { computers: { instances: 3 } } } });
  assert.deepEqual([fresh.choices.services.computers, fresh.choices.services.web, fresh.services[1].instances.live], [{ size: "a-8", instances: 3 }, { size: "a-2", instances: 2 }, null]);
  const lost = { ...structuredClone(record), choices: { ...record.choices, services: { ...record.choices.services, computers: { size: "a-8", instances: 5 } } } };
  const gone = planOf({ needs: NEEDS, record: lost, observed: observed.filter((thing) => thing.id !== "svc_cmp"), offer });
  assert.deepEqual([verbs(gone)["service.computers"], gone.choices.services.computers.instances, gone.problems], ["missing", 2, []]);
});

test("drift: a size changed by hand asks keep or put back, a count changed there asks nothing, a deleted hosted service is missing, a thing made by hand is left alone, and the hash moves with them", async () => {
  const { standIn, client } = world();
  const offer = await createMobilynetAdapter({ client, project: standIn.projectId }).offer();
  const { record, observed } = deployed();
  const before = planOf({ needs: NEEDS, record, observed, offer });

  // Someone made web a-4 at mobilynet: drift, undecided until the owner says.
  const resized = observed.map((thing) => (thing.id === "svc_web" ? { ...thing, size: "a-4" } : thing));
  const asked = planOf({ needs: NEEDS, record, observed: resized, offer });
  assert.notEqual(asked.hash, before.hash, "the observed state moved, so a Deploy held to the old plan is refused");
  assert.deepEqual(asked.items.find((item) => item.name === "web").drift, [{ field: "size", provider: "a-4", recorded: "a-2", decision: null }]);
  assert.deepEqual(asked.problems.map(({ code, item, message }) => ({ code, item, message })), [{
    code: "production_drift_undecided", item: "service.web.size",
    message: "web: size a-4 at mobilynet, a-2 in your choices. Keep mobilynet's value or put yours back, then deploy to production."
  }]);
  // Keep a-4: the choice becomes a-4 and nothing changes; put back a-2: the Deploy changes a-4 to a-2.
  const keep = planOf({ needs: NEEDS, record, observed: resized, offer, decisions: { "service.web.size": "keep" } });
  assert.deepEqual([keep.problems, keep.choices.services.web, verbs(keep)["service.web"]], [[], { size: "a-4", instances: 2 }, "kept"]);
  const back = planOf({ needs: NEEDS, record, observed: resized, offer, decisions: { "service.web.size": "putBack" } });
  assert.deepEqual(back.items.find((item) => item.name === "web").changes, [{ field: "size", from: "a-4", to: "a-2" }]);
  assert.equal(back.choices.services.web.size, "a-2");
  // computers raised to 3 there: its count, no drift and no question, though the plan's hash moves with it.
  const raised = planOf({ needs: NEEDS, record, observed: observed.map((thing) => (thing.id === "svc_cmp" ? { ...thing, instances: 3 } : thing)), offer });
  assert.deepEqual([raised.problems, raised.items.find((item) => item.name === "computers").drift], [[], []]);
  assert.notEqual(raised.hash, before.hash);

  // The database's hosted service deleted outside Vibe64: missing, and the Deploy refused.
  const gone = planOf({ needs: NEEDS, record, observed: observed.filter((thing) => thing.id !== "hs_db"), offer });
  assert.equal(verbs(gone)["resource.database"], "missing");
  assert.deepEqual(gone.problems.map((one) => one.code), ["production_resource_missing"]);
  assert.match(gone.problems[0].message, /^database: gone at mobilynet \(deleted outside Vibe64\)\./u);

  // An App Service made by hand, and another deployment's hosted service: listed, left alone, never priced.
  const others = [
    ...observed,
    { id: "svc_hand", name: "worker-test", kind: "service", labels: {}, size: "a-1", instances: 1, exposure: "internal", state: "running" },
    { id: "hs_other", name: "shop-database", kind: "resource", labels: { "vibe64-deployment": "dep_other", "vibe64-item": "resource.database" }, size: "small", resourceKind: "postgresql", state: "running" }
  ];
  const alone = planOf({ needs: NEEDS, record, observed: others, offer });
  assert.deepEqual(alone.foreign, [
    { id: "svc_hand", name: "worker-test", kind: "service", vibe64: false },
    { id: "hs_other", name: "shop-database", kind: "resource", vibe64: true }
  ]);
  assert.equal(alone.monthlyNano, before.monthlyNano);
  assert.deepEqual(verbs(alone), verbs(before));
  assert.notEqual(alone.hash, before.hash);
});

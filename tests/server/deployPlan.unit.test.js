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
  const offer = await createMobilynetAdapter({ client, project: standIn.projectId }).offer();
  const plan = planOf({ needs: NEEDS, record: null, observed: [], offer });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(verbs(plan), { "service.web": "new", "service.computers": "new", "resource.database": "new", "resource.files": "new" });
  // web needs 2 vCPU and 2 GiB: a-2, a-4 and a-8; computers 8 and 16: a-8 alone. Production starts with 2 of each.
  assert.deepEqual(plan.services.map(({ id, exposure, sizes, defaultSize, instances, balancer }) => ({ id, exposure, sizes: sizes.map((size) => size.name), defaultSize, instances, balancer })), [
    { id: "web", exposure: "public", sizes: ["a-2", "a-4", "a-8"], defaultSize: "a-2", instances: { min: 1, max: 6, default: 2 }, balancer: { monthlyNano: nano(10) } },
    { id: "computers", exposure: "internal", sizes: ["a-8"], defaultSize: "a-8", instances: { min: 1, max: 20, default: 2 }, balancer: null }
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

test("a later plan keeps what didn't change, changes a count, removes a dropped service and disconnects a dropped resource", async () => {
  const { standIn, client } = world();
  const offer = await createMobilynetAdapter({ client, project: standIn.projectId }).offer();
  const { record, observed } = deployed();
  // The same Stack at a new commit: every item kept, nothing to decide.
  const same = planOf({ needs: NEEDS, record, observed, offer });
  assert.deepEqual(same.problems, []);
  assert.deepEqual(verbs(same), { "service.web": "kept", "service.computers": "kept", "resource.database": "kept", "resource.files": "kept" });
  assert.deepEqual(same.foreign, []);

  // A count chosen: computers changed, 2 to 3.
  const more = planOf({ needs: NEEDS, record, observed, offer, choices: { services: { computers: { instances: 3 } } } });
  assert.deepEqual(more.items.find((item) => item.name === "computers"), {
    kind: "service", name: "computers", verb: "changed", id: "svc_cmp", changes: [{ field: "instances", from: 2, to: 3 }], drift: []
  });
  assert.notEqual(more.hash, same.hash);

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

test("drift: a count changed by hand asks keep or put back, a deleted hosted service is missing, a thing made by hand is left alone, and the hash moves with them", async () => {
  const { standIn, client } = world();
  const offer = await createMobilynetAdapter({ client, project: standIn.projectId }).offer();
  const { record, observed } = deployed();
  const before = planOf({ needs: NEEDS, record, observed, offer });

  // Someone raised computers to 3 instances at mobilynet: drift, undecided until the owner says.
  const raised = observed.map((thing) => (thing.id === "svc_cmp" ? { ...thing, instances: 3 } : thing));
  const asked = planOf({ needs: NEEDS, record, observed: raised, offer });
  assert.notEqual(asked.hash, before.hash, "the observed state moved, so a Deploy held to the old plan is refused");
  assert.deepEqual(asked.items.find((item) => item.name === "computers").drift, [{ field: "instances", provider: 3, recorded: 2, decision: null }]);
  assert.deepEqual(asked.problems.map(({ code, item, message }) => ({ code, item, message })), [{
    code: "production_drift_undecided", item: "service.computers.instances",
    message: "computers: 3 instances at mobilynet, 2 in your choices. Keep mobilynet's value or put yours back, then deploy."
  }]);
  // Keep 3: the choice becomes 3 and nothing changes; put back 2: the Deploy changes 3 to 2.
  const keep = planOf({ needs: NEEDS, record, observed: raised, offer, decisions: { "service.computers.instances": "keep" } });
  assert.deepEqual([keep.problems, keep.choices.services.computers, verbs(keep)["service.computers"]], [[], { size: "a-8", instances: 3 }, "kept"]);
  const back = planOf({ needs: NEEDS, record, observed: raised, offer, decisions: { "service.computers.instances": "putBack" } });
  assert.deepEqual(back.items.find((item) => item.name === "computers").changes, [{ field: "instances", from: 3, to: 2 }]);
  assert.equal(back.choices.services.computers.instances, 2);
  // Keeping a count outside the Stack's range is refused like any choice.
  const tooMany = observed.map((thing) => (thing.id === "svc_cmp" ? { ...thing, instances: 25 } : thing));
  assert.match(planOf({ needs: NEEDS, record, observed: tooMany, offer, decisions: { "service.computers.instances": "keep" } }).problems[0].message,
    /^choices\.services\.computers\.instances is 1 to 20/u);

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

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { setInstances } from "../../packages/vibe64-deploy/src/instances.js";
import { LABEL, labelsFor } from "../../packages/vibe64-deploy/src/record.js";
import { deleteResource, takeOffline } from "../../packages/vibe64-deploy/src/offline.js";
import { WORKERS_RESOURCES, workersStack } from "../fixtures/deployWorkersApp.js";
import { DOMAIN, googleWorld } from "./deployGoogleHelpers.js";

// The two-service app deployed to Google Cloud through the engine alone, against Google's stand-in: web on Cloud Run
// behind the external load balancer, workers (gVisor and FUSE sandboxes, reached at each instance) as a managed
// instance group of whole machines behind an internal load balancer, PostgreSQL as Cloud SQL and the bucket as Cloud
// Storage. The stand-in's request log is what Google was asked.

const LB_NAMES = ["shop-web-https", "shop-web-http"];
const isWrite = (request) => request.method !== "GET" && !/listManagedInstances|:getIamPolicy|operations\/[^/]+\/wait$/u.test(request.path);

test("a two-service deploy runs web on Cloud Run and workers on machines of their own, labelled, linked and reached", async () => {
  const { standIn, client, adapter, run, record } = googleWorld();
  // A Cloud Run service someone made by hand in the same project: never touched.
  await client.call("run", "POST", `v2/projects/${standIn.project}/locations/${standIn.region}/services`, {
    query: { serviceId: "hand-made" }, body: { template: { containers: [{ image: "us-docker.pkg.dev/cloudrun/container/hello" }] } }
  });
  const before = standIn.requests().length;

  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  assert.deepEqual(first.plan.items.map((item) => item.verb), ["new", "new", "new", "new"]);
  assert.deepEqual([first.plan.choices.services.web.size, first.plan.choices.services.workers.size], ["run-1-2", "e2-standard-4"]);
  // Each service is linked to its resources while its first rollout runs, right after it is made: Google built its image
  // before the rollout began, so nothing waits for a build to start, and the link never waits for the rollout to end.
  assert.deepEqual(first.steps.filter((step) => step.endsWith("to start building")), []);
  for (const service of ["web", "workers"]) {
    const made = first.steps.indexOf(`createService ${service}`);
    const linked = first.steps.indexOf(`link ${service}`, made);
    assert.ok(made >= 0 && linked > made && linked < first.steps.indexOf(`checkRefresh ${service}`, made), `${service}: ${first.steps.join(", ")}`);
  }
  const { items } = first.record;

  // web: Cloud Run, ingress only from the load balancer, two instances always on, its egress from Cloud Run's subnet.
  const web = standIn.run.service("shop-web");
  assert.equal(items["service.web"].id, `projects/${standIn.project}/locations/${standIn.region}/services/shop-web`);
  // Its count is the service's own scaling, so a count change makes no revision.
  assert.deepEqual([web.ingress, web.scaling, web.template.scaling, web.template.containers[0].resources], [
    "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER", { minInstanceCount: 2, maxInstanceCount: 2 }, undefined, { limits: { cpu: "1", memory: "2Gi" }, cpuIdle: false }
  ]);
  assert.equal(web.template.vpcAccess.networkInterfaces[0].subnetwork, `vibe64-${standIn.region}-run`);
  assert.match(web.template.containers[0].image, new RegExp(`^${standIn.region}-docker\\.pkg\\.dev/${standIn.project}/vibe64/shop-web:r-[0-9a-f]{32}$`, "u"));
  assert.equal(web.terminalCondition.state, "CONDITION_SUCCEEDED");

  // workers: a regional group of two e2-standard-4 machines, both healthy, running the image under its sandboxes.
  const group = standIn.compute.group("shop-workers");
  assert.equal(items["service.workers"].id, `projects/${standIn.project}/regions/${standIn.region}/instanceGroupManagers/shop-workers`);
  assert.equal(group.targetSize, 2);
  assert.deepEqual(standIn.compute.machines("shop-workers").map((machine) => [machine.action, machine.healthy, machine.problems]), [["NONE", true, []], ["NONE", true, []]]);
  const metadata = standIn.compute.metadataOf("shop-workers");
  assert.match(metadata["startup-script"], /--security-opt seccomp=unconfined --security-opt apparmor=unconfined/u);
  assert.match(metadata["startup-script"], /--device \/dev\/fuse --cap-add SYS_ADMIN/u);
  assert.match(metadata["startup-script"], /export V64_INSTANCE_URL="http:\/\/\$instance\.\$\{zone##\*\/\}\.c\.\$\(md project\/project-id\)\.internal:3000"/u);
  const template = standIn.compute.parts("instanceTemplates")[0];
  assert.deepEqual([template.properties.machineType, template.properties.disks[0].initializeParams.diskType], ["e2-standard-4", "pd-balanced"]);
  assert.deepEqual(standIn.compute.parts("forwardingRules").filter((rule) => rule.loadBalancingScheme === "INTERNAL").map((rule) => rule.serviceName),
    [`app.shop-workers-internal.il4.${standIn.region}.lb.${standIn.project}.internal`]);
  // A machine leaving workers' group gets no new connections and 30 seconds to finish those it has (Google's default is none).
  assert.deepEqual(standIn.compute.parts("backendServices").filter((backend) => backend.name.startsWith("shop-workers")).map((backend) => [backend.name, backend.connectionDraining]),
    [["shop-workers-internal", { drainingTimeoutSec: 30 }]]);

  // The load balancer: https and http (redirecting) at the domain's address, its certificate map, web's serverless backend.
  const address = standIn.compute.parts("addresses").find((one) => one.addressType === "EXTERNAL");
  assert.deepEqual(standIn.compute.parts("forwardingRules").filter((rule) => rule.loadBalancingScheme === "EXTERNAL_MANAGED").map((rule) => [rule.name, rule.IPAddress, rule.portRange]),
    [[LB_NAMES[0], address.address, "443"], [LB_NAMES[1], address.address, "80"]]);
  const certificate = standIn.platform.certificates().find((one) => one.managed);
  assert.deepEqual(certificate.managed.domains, [DOMAIN]);
  // The records the owner adds: the DNS authorisation's CNAME, and the domain at the load balancer's address.
  const { records } = await adapter.domainRecords(DOMAIN);
  assert.deepEqual(records.map(({ name, type }) => [name, type]), [[`_acme-challenge.${DOMAIN}.`, "CNAME"], [`${DOMAIN}.`, "A"]]);
  assert.equal(records[1].data, address.address);

  // Reaches: a rule lets web (from Cloud Run's subnet) reach workers' machines on 3000; nothing lets workers reach web.
  assert.equal(standIn.reaches("shop-web", "shop-workers", 3000), true);
  assert.equal(standIn.reaches("shop-workers", "shop-web", 3000), false);

  // The resources: Cloud SQL on a private address, kept from deletion; a private bucket.
  const database = standIn.sql.instance("shop-database");
  assert.deepEqual([database.state, database.databaseVersion, database.settings.tier, database.settings.edition, database.settings.deletionProtectionEnabled, database.settings.ipConfiguration.ipv4Enabled],
    ["RUNNABLE", "POSTGRES_16", "db-custom-1-3840", "ENTERPRISE", true, false]);
  const password = standIn.sql.users("shop-database").shop;
  assert.equal(standIn.platform.secretValue("shop-database-password"), password);
  assert.deepEqual(standIn.sql.databases("shop-database").sort(), ["postgres", "shop"]);
  const bucket = standIn.storage.buckets().find((one) => one.name.startsWith("shop-files-"));
  assert.equal(items["resource.files"].providerName, bucket.name);
  assert.equal(bucket.iamConfiguration.publicAccessPrevention, "enforced");

  // Every thing made carries the deployment's labels, in Google's form; the engine reads them back.
  const labels = (name, kind) => ({ ...labelsFor(record, { kind, name }), [LABEL.item]: `${kind}_${name}` });
  assert.deepEqual(web.labels, labels("web", "service"));
  assert.deepEqual(Object.fromEntries(Object.entries(template.properties.labels).filter(([key]) => !["vibe64-exposure", "vibe64-version"].includes(key))), labels("workers", "service"));
  assert.deepEqual(database.settings.userLabels, labels("database", "resource"));
  assert.deepEqual(bucket.labels, labels("files", "resource"));
  const inventory = await adapter.inventory();
  for (const [name, item, kind] of [["shop-web", "web", "service"], ["shop-workers", "workers", "service"], ["shop-database", "database", "resource"], [bucket.name, "files", "resource"]]) {
    assert.deepEqual(inventory.find((thing) => thing.name === name).labels, labelsFor(record, { kind, name: item }), name);
  }
  assert.deepEqual(inventory.find((thing) => thing.name === "hand-made").labels, {});

  // Each service's settings, read as it runs them: the resources' credentials, its own settings, the address it reaches.
  const webEnv = standIn.environmentOf("shop-web");
  const workersEnv = standIn.environmentOf("shop-workers");
  for (const env of [webEnv, workersEnv]) {
    assert.deepEqual([env.V64_DATABASE_HOST, env.V64_DATABASE_PORT, env.V64_DATABASE_USER, env.V64_DATABASE_DATABASE, env.V64_DATABASE_PASSWORD],
      [database.ipAddresses[0].ipAddress, "5432", "shop", "shop", password]);
    assert.deepEqual([env.V64_FILES_BUCKET, env.V64_FILES_ENDPOINT, env.V64_FILES_REGION], [bucket.name, "https://storage.googleapis.com", "auto"]);
    assert.match(env.V64_FILES_ACCESS_KEY_ID, /^GOOG1E/u);
    assert.equal(env.SESSION_SECRET, "session-1");
  }
  // Each service holds a key of its own account.
  assert.notEqual(webEnv.V64_FILES_ACCESS_KEY_ID, workersEnv.V64_FILES_ACCESS_KEY_ID);
  assert.deepEqual([webEnv.SETUP_CODE, webEnv.MAIL_PASSWORD, webEnv.MAX_JOBS], ["setup-1", "mail-1", undefined]);
  assert.deepEqual([workersEnv.SETUP_CODE, workersEnv.MAIL_PASSWORD, workersEnv.MAX_JOBS], [undefined, undefined, "8"]);
  assert.equal(webEnv.WORKERS_URL, `http://app.shop-workers-internal.il4.${standIn.region}.lb.${standIn.project}.internal:3000`);
  assert.equal(webEnv.APP_PUBLIC_URL, `https://${DOMAIN}`);
  assert.match(webEnv.TRUSTED_PROXIES, /35\.191\.0\.0\/16/u);
  // Secrets are Secret Manager's: the service's own secret settings never sit in its plain settings.
  assert.equal(web.template.containers[0].env.find((entry) => entry.name === "SESSION_SECRET").valueSource.secretKeyRef.secret, "shop-web-SESSION_SECRET");
  assert.equal(metadata["vibe64-env"].includes(Buffer.from("session-1").toString("base64")), false);

  // The hand-made service was read, never written.
  assert.deepEqual(standIn.requests().slice(before).filter((request) => isWrite(request) && request.path.includes("hand-made")), []);
  assert.equal(standIn.run.service("hand-made").generation, "1");
});

test("a second deploy rolls each service onto its new image; its old machines and templates go once the new are healthy", async () => {
  const { standIn, run, record } = googleWorld();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const image = standIn.run.service("shop-web").template.containers[0].image;
  const machines = standIn.compute.machines("shop-workers").map((machine) => machine.name);

  const second = await run({ record: first.record, commit: "c2", env: { SESSION_SECRET: "session-1", SETUP_CODE: "setup-1", MAIL_PASSWORD: "mail-2", MAX_JOBS: "8" } });
  assert.equal(second.outcome, "live", second.message);
  assert.deepEqual(second.plan.items.map((item) => item.verb), ["kept", "kept", "kept", "kept"]);
  // web's new mail password goes with its release, never ahead of it on the version it runs (a step tried again is
  // listed again).
  const webSteps = second.steps.filter((step) => /^(putSettings|releaseService) web$/u.test(step));
  assert.ok(webSteps.length > 0 && webSteps.every((step) => step === "releaseService web"), webSteps.join(", "));
  assert.notEqual(standIn.run.service("shop-web").template.containers[0].image, image);
  assert.equal(standIn.run.service("shop-web").latestReadyRevision, standIn.run.service("shop-web").latestCreatedRevision);
  assert.equal(standIn.environmentOf("shop-web").MAIL_PASSWORD, "mail-2");
  // workers' machines are new ones, all on the group's one template; the templates before it were deleted.
  const now = standIn.compute.machines("shop-workers");
  assert.equal(now.length, 2);
  assert.deepEqual(now.filter((machine) => machines.includes(machine.name)), []);
  const group = standIn.compute.group("shop-workers");
  assert.deepEqual([...new Set(now.map((machine) => machine.template))], [group.instanceTemplate.split("/").pop()]);
  assert.ok(standIn.compute.parts("instanceTemplates").length <= 2);
  assert.match(standIn.compute.metadataOf("shop-workers")["startup-script"], new RegExp(`docker pull \\S+/shop-workers:${second.record.run.services.workers.version}\\n`, "u"));
});

test("changed counts and sizes: setInstances changes Cloud Run's count in place, no revision and no new image, and resizes the group at once; a bigger machine rolls it in a Deploy", async () => {
  const { standIn, adapter, run, record } = googleWorld();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const revision = standIn.run.service("shop-web").latestCreatedRevision;
  const builds = standIn.requests().filter((request) => request.method === "POST" && request.path.includes("/builds")).length;
  const { needs } = workersStack();
  for (const [service, instances] of [["web", 3], ["workers", 4]]) {
    assert.deepEqual(await setInstances(adapter, first.record, needs, { service, instances }), { service, instances, refreshId: null });
  }
  const resized = await run({ record: first.record, commit: "c1", choices: { services: { workers: { size: "e2-highmem-4" } } } });
  assert.equal(resized.outcome, "live", resized.message);
  assert.deepEqual(standIn.run.service("shop-web").scaling, { minInstanceCount: 3, maxInstanceCount: 3 });
  assert.equal(standIn.run.service("shop-web").latestCreatedRevision, revision, "web runs the revision it ran");
  assert.equal(standIn.requests().filter((request) => request.method === "POST" && request.path.includes("/builds")).length, builds, "no image built again");
  assert.deepEqual(resized.steps.filter((step) => step.startsWith("releaseService")), []);
  assert.equal(standIn.compute.group("shop-workers").targetSize, 4);
  const machines = standIn.compute.machines("shop-workers");
  assert.equal(machines.length, 4);
  assert.deepEqual([...new Set(machines.map((machine) => standIn.compute.part(`projects/${standIn.project}/regions/${standIn.region}/instanceTemplates/${machine.template}`).properties.machineType))], ["e2-highmem-4"]);
  // A Cloud Run size is refused for workers, which need machines of their own.
  const refused = await run({ record: resized.record, commit: "c1", choices: { services: { workers: { size: "run-4-16" } } } }).catch((error) => error);
  assert.equal(refused.code, "production_deploy_plan_refused");
});

test("taking the app offline removes the services and their parts; the resources stay until deleted, then go with their keys", async () => {
  const { standIn, adapter, run, record } = googleWorld();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const accounts = standIn.platform.accounts().length;

  const offline = await takeOffline(adapter, first.record, { pause: () => standIn.advance() });
  assert.deepEqual(Object.keys(offline.items).sort(), ["resource.database", "resource.files"]);
  assert.deepEqual([standIn.run.service("shop-web"), standIn.compute.group("shop-workers")], [null, null]);
  for (const collection of ["forwardingRules", "targetHttpsProxies", "targetHttpProxies", "urlMaps", "backendServices", "networkEndpointGroups", "instanceTemplates", "healthChecks"]) {
    assert.deepEqual(standIn.compute.parts(collection), [], collection);
  }
  assert.deepEqual(standIn.compute.parts("firewalls").map((rule) => rule.name), ["vibe64-health-checks"]);
  assert.equal(standIn.platform.accounts().length, accounts - 2);
  // The services' own secrets and the bucket keys their accounts held went with them; the database's password stays.
  assert.deepEqual(standIn.platform.secrets().map((secret) => secret.name.split("/").pop()), ["shop-database-password"]);
  assert.deepEqual(standIn.storage.keys().map((key) => key.state), ["DELETED", "DELETED"]);
  assert.equal(standIn.sql.instance("shop-database").state, "RUNNABLE");

  // Deployed again, the services come back with new keys of their new accounts.
  const again = await run({ record: offline, commit: "c1" });
  assert.equal(again.outcome, "live", again.message);
  assert.match(standIn.environmentOf("shop-web").V64_FILES_ACCESS_KEY_ID, /^GOOG1E/u);

  // Once genesis/stack.md drops the database, its own action deletes it, its deletion protection lifted first.
  const stack = workersStack(undefined, WORKERS_RESOURCES.filter((one) => one.resource.id === "files"));
  const kept = await deleteResource(adapter, again.record, stack.needs, { name: "database", typed: "database" });
  assert.equal(kept.items["resource.database"], undefined);
  assert.equal(standIn.sql.instance("shop-database"), null);
  assert.deepEqual(standIn.sql.deleted(), ["shop-database"]);
  assert.equal(standIn.platform.secretValue("shop-database-password"), null);
});

test("a failed build, a revision that never gets ready and machines Google can't place each fail the Deploy with Google's reason", async () => {
  for (const [fault, message] of [
    ["buildFails", /^createService workers: The image of shop-workers did not build \(FAILURE\): Build step 0 .*Its log: https:\/\/console\.cloud\.google\.com\/cloud-build/u],
    ["revisionFails", /web: the release did not go live: Revision 'shop-web-00001-...' is not ready and cannot serve traffic\. The user-provided container failed/u],
    ["stockout", /^workers: the release did not go live: A machine of shop-workers did not start: The zone 'projects\/shop-standin\/zones\/us-central1-a' does not have enough resources/u]
  ]) {
    const { standIn, run, record } = googleWorld();
    standIn.faults[fault] = true;
    const result = await run({ record, commit: "c1" });
    assert.equal(result.outcome, "failed", fault);
    assert.match(result.message, message, fault);
  }
});

test("a resource name another deployment or another Google customer holds is refused, never adopted; this deployment's own is", async () => {
  const { standIn, client, adapter, record } = googleWorld();
  const labels = (name) => labelsFor(record, { kind: "resource", name });
  // Another customer's bucket under the name: Google answers 409, then 403 to a read.
  standIn.storage.takeName(`shop-files-${createHash("sha256").update(standIn.project).digest("hex").slice(0, 8)}`);
  const taken = await adapter.createResource({ name: "shop-files", kind: "bucket", size: "standard", labels: labels("files") }).catch((error) => error);
  assert.deepEqual([taken.code, taken.retryable], ["name_taken", false]);
  assert.match(taken.message, /^shop-files is taken at Google Cloud by something that isn't this deployment's: rename the resource in genesis\/stack\.md\.$/u);
  // A Cloud SQL instance of the name made by hand.
  await client.call("sqladmin", "POST", `v1/projects/${standIn.project}/instances`, {
    body: { name: "shop-cache", region: standIn.region, databaseVersion: "MYSQL_8_4", settings: { tier: "db-custom-1-3840", edition: "ENTERPRISE" } }
  });
  const hand = await adapter.createResource({ name: "shop-cache", kind: "mysql", size: "db-custom-1-3840", labels: labels("cache") }).catch((error) => error);
  assert.equal(hand.code, "name_taken");
  assert.equal(standIn.sql.instance("shop-cache").settings.userLabels, undefined);
  // This deployment's own, made by a step cut short, is taken as it is.
  const made = await adapter.createResource({ name: "shop-database", kind: "postgresql", size: "db-custom-1-3840", labels: labels("database") });
  assert.deepEqual(await adapter.createResource({ name: "shop-database", kind: "postgresql", size: "db-custom-1-3840", labels: labels("database") }), made);
  assert.equal(standIn.sql.instances().filter((one) => one.name === "shop-database").length, 1);
  // A Cloud SQL write while another of the instance runs is tried again at the next step.
  standIn.advance();
  await adapter.resizeResource(made.id, "db-custom-2-7680");
  const busy = await adapter.resizeResource(made.id, "db-custom-4-15360").catch((error) => error);
  assert.deepEqual([busy.status, busy.retryable], [409, true]);
});

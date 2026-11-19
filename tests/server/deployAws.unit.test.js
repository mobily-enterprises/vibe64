import assert from "node:assert/strict";
import test from "node:test";

import { specPlaceOf } from "../../packages/vibe64-deploy/src/adapters/aws/machine.js";
import { setInstances } from "../../packages/vibe64-deploy/src/instances.js";
import { LABEL, labelsFor } from "../../packages/vibe64-deploy/src/record.js";
import { deleteResource, takeOffline } from "../../packages/vibe64-deploy/src/steps.js";
import { WORKERS_RESOURCES, workersStack } from "../fixtures/deployWorkersApp.js";
import { DOMAIN, ENV, ENV_RECORDS, awsWorld, releaseOf } from "./deployAwsHelpers.js";

// The two-service app deployed to AWS through the engine alone, against AWS's stand-in: web on Fargate behind the
// deployment's Application Load Balancer, workers (gVisor and FUSE sandboxes, reached at each instance) on whole
// machines of their own in an Auto Scaling group, PostgreSQL as RDS and the bucket as private S3. The stand-in's
// request log is what AWS was asked.

const READS = /^(Describe|List|Get|BatchGet)|^GET |^HEAD /u;
const isWrite = (request) => !READS.test(String(request.action));
const shortOf = (record) => record.deploymentId.slice(-8);

/** A VPC, two subnets and an RDS instance someone made by hand in the same account, untagged. */
function handMade(standIn, identifier = "hand-made") {
  const { ec2, rds } = standIn.handlers;
  const vpc = ec2.CreateVpc({ CidrBlock: "172.31.0.0/16" }).vpc.vpcId;
  const subnets = ["a", "b"].map((zone, index) => ec2.CreateSubnet({ VpcId: vpc, CidrBlock: `172.31.${index * 16}.0/20`, AvailabilityZone: `us-east-1${zone}` }).subnet.subnetId);
  rds.CreateDBSubnetGroup({ DBSubnetGroupName: "hand", DBSubnetGroupDescription: "by hand", SubnetIds: { SubnetIdentifier: { 1: subnets[0], 2: subnets[1] } } });
  rds.CreateDBInstance({ DBInstanceIdentifier: identifier, Engine: "postgres", DBInstanceClass: "db.t4g.micro", MasterUsername: "me", MasterUserPassword: "by-hand-1", DBSubnetGroupName: "hand" });
}

test("a two-service deploy runs web on Fargate and workers on machines of their own, tagged, linked and reached", async () => {
  const { standIn, client, adapter, run, record } = awsWorld();
  handMade(standIn);
  const before = standIn.requests().length;
  const short = shortOf(record);

  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  assert.deepEqual(first.plan.items.map((item) => item.verb), ["new", "new", "new", "new"]);
  assert.deepEqual([first.plan.choices.services.web.size, first.plan.choices.services.workers.size], ["fargate-1x2", "m7i.xlarge"]);
  // Each service is linked to its resources while its first rollout runs, right after it is made: CodeBuild built its
  // image before the rollout began, so nothing waits for a build to start, and the link never waits for the rollout.
  assert.deepEqual(first.steps.filter((step) => step.endsWith("to start building")), []);
  for (const service of ["web", "workers"]) {
    const made = first.steps.indexOf(`createService ${service}`);
    const linked = first.steps.indexOf(`link ${service}`, made);
    assert.ok(made >= 0 && linked > made && linked < first.steps.indexOf(`checkRefresh ${service}`, made), `${service}: ${first.steps.join(", ")}`);
  }
  const { items } = first.record;
  const view = standIn.view();

  // web: an ECS service on Fargate in the deployment's cluster, two tasks with public addresses for their way out,
  // behind the load balancer's target group of their addresses; its image built at AWS into the deployment's ECR.
  const web = view.services.find((one) => one.name === "shop-web");
  assert.equal(items["service.web"].id, `arn:aws:ecs:us-east-1:${standIn.account}:service/v64-${short}-cluster/shop-web`);
  assert.deepEqual([web.desiredCount, web.deployments.length, web.deployments[0].rolloutState], [2, 1, "COMPLETED"]);
  assert.equal(web.networkConfiguration.awsvpcConfiguration.assignPublicIp, "ENABLED");
  assert.deepEqual(web.deploymentConfiguration.deploymentCircuitBreaker, { enable: true, rollback: true });
  const definition = view.taskDefinitions.find((one) => one.taskDefinitionArn === web.deployments[0].taskDefinition);
  assert.deepEqual([definition.cpu, definition.memory, definition.networkMode, definition.requiresCompatibilities], ["1024", "2048", "awsvpc", ["FARGATE"]]);
  assert.match(definition.containerDefinitions[0].image, new RegExp(`^${standIn.account}\\.dkr\\.ecr\\.us-east-1\\.amazonaws\\.com/v64-${short}-images/shop-web:[0-9a-f]{32}$`, "u"));
  const target = view.targetGroups.find((one) => one.arn === web.loadBalancers[0].targetGroupArn);
  assert.deepEqual([target.targetType, target.port, target.healthPath], ["ip", 3000, "/api/health"]);

  // The load balancer: 80 redirects to HTTPS, 443 holds the domain's certificate (issued by DNS) and forwards to web.
  const listeners = Object.fromEntries(view.listeners.map((one) => [one.port, one]));
  assert.deepEqual(listeners[80].actions, [{ Type: "redirect", RedirectConfig: { Protocol: "HTTPS", Port: "443", StatusCode: "HTTP_301" } }]);
  assert.deepEqual(listeners[443].actions, [{ Type: "forward", TargetGroupArn: target.arn }]);
  const certificate = view.certificates.find((one) => one.arn === listeners[443].certificates[0]);
  assert.deepEqual([certificate.domain, certificate.status], [DOMAIN, "ISSUED"]);
  const { records } = await adapter.domainRecords(DOMAIN);
  const balancer = view.balancers[0];
  assert.deepEqual(records.map(({ name, type }) => [name, type]), [[certificate.record.Name, "CNAME"], [`${DOMAIN}.`, "CNAME"]]);
  assert.equal(records[1].data, `${balancer.dns}.`);

  // workers: an Auto Scaling group of two m7i.xlarge machines, ready, privileged for gVisor and FUSE on a machine of
  // their own; each says it is ready only once its service answers.
  const group = view.scalingGroups.find((one) => one.name === `v64-${short}-service-workers`);
  assert.equal(items["service.workers"].id, group.arn);
  assert.deepEqual([group.desired, group.min, group.instances.map((one) => one.state)], [2, 2, ["InService", "InService"]]);
  assert.equal(group.hook.DefaultResult, "ABANDON");
  const data = view.templates.find((one) => one.id === group.template.id).versions[0];
  assert.deepEqual([data.InstanceType, data.MetadataOptions.HttpTokens, data.BlockDeviceMapping["1"].Ebs.VolumeSize], ["m7i.xlarge", "required", "40"]);
  // Its spec is kept in the releases bucket under its SHA-256, which the user data names.
  const [, releases, specKey, sha256] = /^s3:\/\/([^/]+)\/(\S+) ([0-9a-f]{64})$/u.exec(specPlaceOf(data.UserData));
  assert.deepEqual([releases, specKey], [`v64-${short}-releases`, `specs/workers/${sha256}.json`]);
  const spec = JSON.parse((await client.s3("GET", releases, specKey)).text);
  assert.deepEqual([spec.privileged, spec.size, spec.healthPath], [true, "m7i.xlarge", "/api/health"]);
  assert.equal(view.services.some((one) => one.name === "shop-workers"), false);

  // Reaches: web's tasks may reach workers' machines on 3000; nothing lets workers reach web. Both reach the database.
  assert.equal(standIn.reaches("shop-web", group.name, 3000), true);
  assert.equal(standIn.reaches(group.name, "shop-web", 3000), false);
  const database = view.databases.find((one) => one.id === `v64-${short}-database`);
  const databaseGroup = view.securityGroups.find((one) => one.id === database.groups[0]);
  assert.deepEqual(databaseGroup.rules.filter((rule) => rule.from === 5432).map((rule) => rule.group).sort(),
    [...standIn.securityGroupsOf("shop-web"), ...standIn.securityGroupsOf(group.name)].sort());
  assert.deepEqual(databaseGroup.rules.filter((rule) => rule.cidr), []);

  // The resources: RDS for PostgreSQL, its password kept by RDS in Secrets Manager; a private bucket with a key of its own.
  assert.deepEqual([database.engine, database.instanceClass, database.multiAz, database.status], ["postgres", "db.t4g.small", false, "available"]);
  assert.match(database.secret, /:secret:rds!db-/u);
  const bucket = view.buckets.find((one) => one.name === `v64-${short}-bucket-files`);
  assert.equal(items["resource.files"].providerName, bucket.name);
  assert.equal(bucket.blocked, true);
  const user = view.users.find((one) => one.name === `v64-${short}-bucket-files`);
  const policy = JSON.parse(user.policies.get("vibe64-bucket"));
  assert.deepEqual([...new Set(policy.Statement.flatMap((statement) => [statement.Resource].flat()))].sort(), [`arn:aws:s3:::${bucket.name}`, `arn:aws:s3:::${bucket.name}/*`]);

  // Every thing made carries the deployment's tags; the inventory reads them back, and nothing someone made by hand.
  const labels = (name, kind) => ({ ...labelsFor(record, { kind, name }), [LABEL.item]: `${kind}.${name}` });
  assert.deepEqual(database.tags, labels("database", "resource"));
  assert.deepEqual(bucket.tags, labels("files", "resource"));
  const inventory = await adapter.inventory();
  for (const [id, item, kind] of [[items["service.web"].id, "web", "service"], [group.arn, "workers", "service"], [database.arn, "database", "resource"]]) {
    assert.deepEqual(inventory.find((thing) => thing.id === id).labels, labelsFor(record, { kind, name: item }), item);
  }
  assert.deepEqual(inventory.map((thing) => thing.labels[LABEL.deployment]), inventory.map(() => record.deploymentId));
  assert.equal(inventory.some((thing) => thing.name === "hand-made"), false);
  const network = view.vpcs.find((one) => one.cidr === "10.64.0.0/16");
  const inNetwork = (one) => one.vpc === network.id;
  for (const one of [network, ...view.subnets.filter(inNetwork), ...view.securityGroups.filter(inNetwork), ...view.endpoints.filter(inNetwork), ...view.routeTables.filter(inNetwork), ...view.templates]) {
    assert.equal(one.tags[LABEL.deployment], record.deploymentId, `${one.id} is tagged`);
  }

  // Each service's settings, read as it runs them: the resources' credentials, its own settings, what it reaches.
  const webEnv = standIn.environmentOf("shop-web");
  const workersEnv = standIn.environmentOf(group.name);
  for (const { env } of [webEnv, workersEnv]) {
    assert.deepEqual([env.V64_DATABASE_HOST, env.V64_DATABASE_PORT, env.V64_DATABASE_DATABASE, env.V64_DATABASE_USER, env.V64_DATABASE_SSLMODE],
      [`v64-${short}-database.c0standin.us-east-1.rds.amazonaws.com`, "5432", "app", "vibe64", "require"]);
    assert.match(env.V64_DATABASE_PASSWORD, /^standin-\d+$/u);
    assert.deepEqual([env.V64_FILES_BUCKET, env.V64_FILES_REGION, env.V64_FILES_ENDPOINT], [bucket.name, "us-east-1", "https://s3.us-east-1.amazonaws.com"]);
    assert.match(env.V64_FILES_ACCESS_KEY_ID, /^AKIA/u);
    assert.equal(env.SESSION_SECRET, "session-1");
  }
  assert.deepEqual([webEnv.env.SETUP_CODE, webEnv.env.MAIL_PASSWORD, webEnv.env.MAX_JOBS], ["setup-1", "mail-1", undefined]);
  assert.deepEqual([workersEnv.env.SETUP_CODE, workersEnv.env.MAIL_PASSWORD, workersEnv.env.MAX_JOBS], [undefined, undefined, "8"]);
  assert.equal(webEnv.env.WORKERS_URL, `http://shop-workers.v64-${short}-names.internal:3000`);
  assert.equal(webEnv.env.APP_PUBLIC_URL, `https://${DOMAIN}`);
  assert.equal(webEnv.env.TRUSTED_PROXIES, "loopback,10.64.0.0/16");
  // Secrets are Secrets Manager's: never in a task definition's or a machine's plain settings, nor in its user data.
  assert.equal(definition.containerDefinitions[0].environment.some((one) => ["SESSION_SECRET", "V64_DATABASE_PASSWORD", "V64_FILES_SECRET_ACCESS_KEY"].includes(one.name)), false);
  assert.ok(webEnv.secrets.includes("SESSION_SECRET") && workersEnv.secrets.includes("V64_DATABASE_PASSWORD"));
  const userData = Buffer.from(view.templates.find((one) => one.id === group.template.id).versions[0].UserData, "base64").toString("utf8");
  assert.equal(["session-1", "mail-1", workersEnv.env.V64_DATABASE_PASSWORD, workersEnv.env.V64_FILES_SECRET_ACCESS_KEY].some((secret) => userData.includes(secret)), false);

  // The network: the deployment's own VPC with endpoints for S3 and ECR, and no NAT gateway.
  assert.deepEqual(view.endpoints.map((one) => one.service.split(".").slice(3).join(".")).sort(), ["ecr.api", "ecr.dkr", "s3"]);
  assert.deepEqual(view.natGateways, []);
  assert.deepEqual(standIn.requests().filter((request) => request.action === "CreateNatGateway"), []);

  // What was made by hand was read at most, never written.
  assert.deepEqual(standIn.requests().slice(before).filter((request) => isWrite(request) && JSON.stringify(request.params ?? {}).includes("hand")), []);
  assert.equal(view.databases.find((one) => one.id === "hand-made").status, "available");
});

test("a second deploy rolls web onto a new revision and workers onto new machines by an instance refresh", async () => {
  const { standIn, adapter, run, record } = awsWorld();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const name = `v64-${shortOf(record)}-service-workers`;
  const image = standIn.environmentOf("shop-web").image;
  const machines = standIn.view().scalingGroups.find((one) => one.name === name).instances.map((one) => one.id);

  const second = await run({ record: first.record, commit: "c2", env: { SESSION_SECRET: "session-1", SETUP_CODE: "setup-1", MAIL_PASSWORD: "mail-2", MAX_JOBS: "8" } });
  assert.equal(second.outcome, "live", second.message);
  assert.deepEqual(second.plan.items.map((item) => item.verb), ["kept", "kept", "kept", "kept"]);
  // web's new mail password goes first, on the version it runs, once, then its release (a step tried again is listed again).
  const webSteps = second.steps.filter((step) => /^(putSettings|releaseService) web$/u.test(step));
  assert.deepEqual([webSteps[0], webSteps.at(-1), webSteps.filter((step) => step === "putSettings web").length], ["putSettings web", "releaseService web", 1]);
  // web: one deployment, of a newer revision (its new settings, then the release, each a revision ECS rolled out).
  const web = standIn.view().services.find((one) => one.name === "shop-web");
  assert.deepEqual([web.deployments.length, web.deployments[0].rolloutState], [1, "COMPLETED"]);
  assert.notEqual(web.deployments[0].taskDefinition, web.taskDefinition.replace(/:\d+$/u, ":1"));
  assert.notEqual(standIn.environmentOf("shop-web").image, image);
  assert.equal(standIn.environmentOf("shop-web").env.MAIL_PASSWORD, "mail-2");
  // workers' machines are new ones on the template's second version, the old ended once the new were ready.
  const group = standIn.view().scalingGroups.find((one) => one.name === name);
  assert.equal(group.template.version, "2");
  assert.deepEqual(group.refreshes.map((one) => one.status), ["Successful"]);
  const live = group.instances.filter((one) => one.state !== "Terminated");
  assert.deepEqual([live.length, live.every((one) => one.version === "2"), live.some((one) => machines.includes(one.id))], [2, true, false]);
  assert.equal(standIn.environmentOf(name).image.split(":").pop(), second.record.run.services.workers.version);
  // The same upload again, later (CodeBuild's own guard against a repeated start lasts five minutes), builds nothing:
  // its image is in ECR, under the tag its SHA-256 gives.
  for (let count = 0; count < 12; count += 1) standIn.advance();
  const builds = standIn.view().builds.length;
  const release = releaseOf("c2", workersStack());
  const again = await adapter.uploadRelease("shop-web", adapter.serviceUpload(release.archive, release.declarations.web));
  assert.deepEqual([again.version, standIn.view().builds.length], [second.record.run.services.web.version, builds]);

  // A release's rollout is the refresh its answer names, rolling until ECS or Auto Scaling has moved to it.
  for (const service of ["web", "workers"]) {
    const { id } = second.record.items[`service.${service}`];
    const { refreshId } = await adapter.releaseService(id, adapter.serviceUpload(release.archive, release.declarations[service]));
    assert.deepEqual((await adapter.inventory()).find((one) => one.id === id).refresh, { id: refreshId, state: "rolling" });
    for (let count = 0; count < 3; count += 1) standIn.advance();
    assert.deepEqual([(await adapter.readRefresh(id, refreshId)).state, (await adapter.inventory()).find((one) => one.id === id).refresh], ["succeeded", null]);
  }
});

test("changed counts and sizes: setInstances counts web's tasks and workers' machines in place, at once; workers' bigger machines roll in by a Deploy's refresh", async () => {
  const { standIn, adapter, run, record } = awsWorld();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const name = `v64-${shortOf(record)}-service-workers`;
  const revisions = standIn.requests().filter((request) => request.action === "RegisterTaskDefinition").length;
  const { needs } = workersStack();
  for (const [service, instances] of [["web", 3], ["workers", 4]]) {
    assert.deepEqual(await setInstances(adapter, first.record, needs, { service, instances }), { service, instances, refreshId: null });
  }
  const resized = await run({ record: first.record, commit: "c1", choices: { services: { workers: { size: "m7i.2xlarge" } } } });
  assert.equal(resized.outcome, "live", resized.message);
  // The same commit hands neither service a release: web keeps its revision, its tasks only counted up.
  assert.deepEqual(resized.steps.filter((step) => step.startsWith("releaseService")), []);
  assert.equal(standIn.requests().filter((request) => request.action === "RegisterTaskDefinition").length, revisions);
  assert.equal(standIn.view().services.find((one) => one.name === "shop-web").desiredCount, 3);
  const group = standIn.view().scalingGroups.find((one) => one.name === name);
  assert.deepEqual([group.desired, group.max], [4, 8]);
  const live = group.instances.filter((one) => one.state !== "Terminated");
  assert.equal(live.length, 4);
  assert.deepEqual([...new Set(live.map((one) => standIn.view().templates.find((template) => template.id === group.template.id).versions[Number(one.version) - 1].InstanceType))], ["m7i.2xlarge"]);
  // A Fargate size is refused for workers, which need machines of their own: by the Plan, and by the adapter itself.
  const refused = await run({ record: resized.record, commit: "c1", choices: { services: { workers: { size: "fargate-4x16" } } } }).catch((error) => error);
  assert.equal(refused.code, "deployment_plan_refused");
  const service = (item, app, size) => ({
    name: app, exposure: "internal", size, instances: 1, app, version: resized.record.run.services[item].version, settings: {}, secrets: {}, connections: [],
    labels: labelsFor(record, { kind: "service", name: `${item}-again` })
  });
  const writes = standIn.requests().length;
  const onFargate = await adapter.createService(service("workers", "shop-workers", "fargate-4x16"), { idempotencyKey: "k1" }).catch((error) => error);
  assert.deepEqual([onFargate.code, onFargate.retryable], ["aws_sandbox_needs_machine", false]);
  const onMachine = await adapter.createService(service("web", "shop-web", "m7i.xlarge"), { idempotencyKey: "k2" }).catch((error) => error);
  assert.deepEqual([onMachine.code, onMachine.retryable], ["aws_size_unsupported", false]);
  assert.deepEqual(standIn.requests().slice(writes).filter(isWrite), []);
});

test("taking the app offline removes the services and their secrets; the resources stay until deleted, then go with their key", async () => {
  const { standIn, client, adapter, run, record } = awsWorld();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const name = `v64-${shortOf(record)}-service-workers`;

  const offline = await takeOffline(adapter, first.record, { pause: () => standIn.advance() });
  assert.deepEqual(Object.keys(offline.items).sort(), ["resource.database", "resource.files"]);
  assert.deepEqual([standIn.view().services.filter((one) => one.status !== "INACTIVE"), standIn.view().scalingGroups], [[], []]);
  assert.deepEqual(standIn.view().listeners.find((one) => one.port === 443).actions[0].Type, "fixed-response");
  // The services' own secrets wait out their recovery window; the bucket's key and RDS's login stay.
  const secrets = Object.fromEntries(standIn.view().secrets.map((one) => [one.name.split("/").slice(-2).join("/"), Boolean(one.deleted)]));
  assert.deepEqual(secrets, { [standIn.view().secrets[0].name]: false, "resources/files": false, "services/workers": true, "services/web": true });
  assert.equal(standIn.view().databases[0].status, "available");

  // Deployed again, the services come back, their secrets restored.
  const again = await run({ record: offline, commit: "c1" });
  assert.equal(again.outcome, "live", again.message);
  assert.equal(standIn.environmentOf("shop-web").env.SESSION_SECRET, "session-1");
  assert.equal(standIn.environmentOf(name).env.MAX_JOBS, "8");

  // Once genesis/stack.md drops a resource, its own action deletes it: the database with a final snapshot, the bucket
  // (empty) with its user, its key and the secret that held it.
  const offlineAgain = await takeOffline(adapter, again.record, { pause: () => standIn.advance() });
  const stack = workersStack(undefined, []);
  const withoutDatabase = await deleteResource(adapter, offlineAgain, stack.needs, { name: "database", typed: "database" });
  assert.equal(withoutDatabase.items["resource.database"], undefined);
  const database = standIn.view().databases[0];
  assert.deepEqual([database.status, database.finalSnapshot], ["deleting", `${database.id}-final-202611200${database.finalSnapshot.slice(-3)}`]);
  standIn.advance();
  assert.deepEqual(standIn.view().databases, []);
  // A bucket that still holds files is not deleted; emptied, it is.
  const bucketName = `v64-${shortOf(record)}-bucket-files`;
  await client.s3("PUT", bucketName, "kept.txt", { body: Buffer.from("kept") });
  const full = await deleteResource(adapter, withoutDatabase, stack.needs, { name: "files", typed: "files" }).catch((error) => error);
  assert.deepEqual([full.code, full.retryable], ["aws_bucket_not_empty", false]);
  await client.s3("DELETE", bucketName, "kept.txt");
  const withoutFiles = await deleteResource(adapter, withoutDatabase, stack.needs, { name: "files", typed: "files" });
  assert.deepEqual(Object.keys(withoutFiles.items), []);
  assert.equal(standIn.view().buckets.some((one) => one.name.endsWith("-bucket-files")), false);
  assert.deepEqual(standIn.view().users, []);
  assert.equal(standIn.view().secrets.find((one) => one.name.endsWith("/resources/files")).deleted !== null, true);
});

test("a failed build, tasks that never get healthy and machines that never say they are ready each fail the Deploy with AWS's reason", async () => {
  for (const [fault, message] of [
    ["buildFails", /^createService workers: shop-workers's image did not build \(BUILD\): Error while executing command: docker build .* Its log is in CloudWatch Logs, \/vibe64\/shop\/production\//u],
    ["tasksFail", /web: .*Task failed container health checks/u],
    ["machinesNeverReady", /workers: .*A machine of v64-[a-z2-7]{8}-service-workers did not start: Instance failed to complete user's Lifecycle Action: .*the service never answered its health path/u]
  ]) {
    const { standIn, run, record } = awsWorld();
    standIn.faults[fault] = true;
    const result = await run({ record, commit: "c1" });
    assert.equal(result.outcome, "failed", fault);
    assert.match(result.message, message, fault);
  }
});

test("a release whose tasks never get healthy is rolled back by ECS to the version before, and the Deploy fails saying so", async () => {
  const { standIn, run, record } = awsWorld();
  const first = await run({ record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  standIn.faults.tasksFail = true;
  const second = await run({ record: first.record, commit: "c2" });
  assert.equal(second.outcome, "failed");
  assert.match(second.message, /web: /u);
  const web = standIn.view().services.find((one) => one.name === "shop-web");
  assert.match(web.deployments[0].taskDefinition, /:1$/u);
  assert.equal(web.deployments[0].rolloutState, "COMPLETED");
});

test("a name another AWS account or someone's own hand holds is refused, never adopted; this deployment's own is", async () => {
  const { standIn, adapter, record } = awsWorld();
  const short = shortOf(record);
  const labels = (name) => labelsFor(record, { kind: "resource", name });
  /** A call tried again while AWS answers that it isn't ready yet, AWS moving on in between. */
  const settled = async (call) => {
    for (let tries = 0; tries < 30; tries += 1) {
      try {
        return await call();
      } catch (error) {
        if (error?.retryable !== true) throw error;
        standIn.advance();
      }
    }
    throw new Error("never settled");
  };
  // Another account's bucket under the name: S3 answers BucketAlreadyExists.
  standIn.takeBucketName(`v64-${short}-bucket-files`);
  const taken = await settled(() => adapter.createResource({ name: adapter.hostedName("shop", "files"), kind: "bucket", size: "standard", labels: labels("files") })).catch((error) => error);
  assert.deepEqual([taken.code, taken.retryable], ["aws_name_taken", false]);
  // An RDS instance of the name made by hand, untagged.
  handMade(standIn, `v64-${short}-cache`);
  const hand = await settled(() => adapter.createResource({ name: adapter.hostedName("shop", "cache"), kind: "mysql", size: "db.t4g.small", labels: labels("cache") })).catch((error) => error);
  assert.deepEqual([hand.code, hand.retryable], ["aws_not_ours", false]);
  assert.match(hand.message, new RegExp(`^The RDS database v64-${short}-cache is in this AWS account but isn't tagged as this deployment's`, "u"));
  assert.deepEqual(standIn.view().databases.find((one) => one.id === `v64-${short}-cache`).tags, {});
  // This deployment's own, made by a step cut short, is taken as it is.
  const spec = { name: adapter.hostedName("shop", "database"), kind: "postgresql", size: "db.t4g.small", labels: labels("database") };
  const made = await settled(() => adapter.createResource(spec));
  assert.deepEqual(await adapter.createResource(spec), made);
  assert.equal(standIn.view().databases.filter((one) => one.id === `v64-${short}-database`).length, 1);
  // A change while RDS applies another is tried again at the next step.
  standIn.advance();
  standIn.advance();
  await adapter.resizeResource(made.id, "db.t4g.medium");
  const busy = await adapter.resizeResource(made.id, "db.m7g.large").catch((error) => error);
  assert.deepEqual([busy.code, busy.retryable], ["aws_database_busy", true]);
});

test("a domain whose records aren't in place: the Deploy waits a while for the certificate, then fails naming both records", async () => {
  const { standIn, adapter, run, record } = awsWorld({ issued: false });
  const result = await run({ record, commit: "c1" });
  assert.equal(result.outcome, "failed");
  const { records, certificate } = await adapter.domainRecords(DOMAIN);
  assert.equal(certificate, "PENDING_VALIDATION");
  assert.match(result.message, new RegExp(`^ensureDomain: AWS issues ${DOMAIN}'s certificate once two DNS records are in place at the domain's DNS: CNAME ${records[0].name.replace(/\./gu, "\\.")} with the value ${records[0].data.replace(/\./gu, "\\.")}, and ${DOMAIN} pointed at ${records[1].data.slice(0, -1).replace(/\./gu, "\\.")}`, "u"));
  // It waited (AWS's clock moved past the wait) rather than failing at once.
  assert.ok(result.steps.filter((step) => step === "ensureDomain").length > 10);
  // With the records in place, the next Deploy goes live on the same certificate.
  standIn.issue(DOMAIN);
  const again = await run({ record: result.record, commit: "c1" });
  assert.equal(again.outcome, "live", again.message);
  assert.equal(standIn.view().certificates.length, 1);
});

test("a sandboxed service reached as one still runs on machines of its own; a mysql resource is RDS for MariaDB", async () => {
  const stack = workersStack((lines) => lines.filter((line) => line !== "- Reached: `each instance`"), WORKERS_RESOURCES.map((one) => (one.resource.kind === "postgresql"
    ? { component: "jskit-mysql", resource: { ...one.resource, kind: "mysql" } } : one)));
  const { standIn, run, record } = awsWorld();
  const result = await run({ stack, record, commit: "c1" });
  assert.equal(result.outcome, "live", result.message);
  const name = `v64-${shortOf(record)}-service-workers`;
  assert.equal(standIn.view().scalingGroups.some((one) => one.name === name), true);
  assert.equal(standIn.view().services.some((one) => one.name === "shop-workers"), false);
  const database = standIn.view().databases[0];
  assert.deepEqual([database.engine, database.instanceClass], ["mariadb", "db.t4g.small"]);
  const { env } = standIn.environmentOf("shop-web");
  assert.deepEqual([env.V64_DATABASE_PORT, env.V64_DATABASE_SSLMODE], ["3306", undefined]);
});

test("through a gateway the same Deploy goes live, every request carrying the gateway's token and none signed here", async () => {
  const { standIn, run, record } = awsWorld({ gateway: true });
  const result = await run({ record, commit: "c1" });
  assert.equal(result.outcome, "live", result.message);
  const requests = standIn.requests();
  assert.deepEqual([...new Set(requests.map((one) => one.mode))], ["gateway"]);
  assert.equal(requests.some((one) => one.status === 401), false);
  assert.equal(standIn.view().scalingGroups[0].instances.filter((one) => one.state === "InService").length, 2);
});

test("a service on machines takes the 100 settings mobilynet takes: its user data names where its spec is, never a setting", async () => {
  const { standIn, run, record } = awsWorld();
  // workers given 100 settings, half of them secret, each value 60 characters: far past what a machine's user data
  // (16 KB at AWS) could carry with the settings in it.
  const base = Object.keys(releaseOf("c1", workersStack()).settings.workers).length;
  const extra = Array.from({ length: 100 - base }, (_, at) => ({ key: `WORKERS_SETTING_${at}`, secret: at % 2 === 0, services: ["workers"] }));
  const env = { ...ENV, ...Object.fromEntries(extra.map(({ key }, at) => [key, `value ${at} `.padEnd(60, "x")])) };
  const records = [...ENV_RECORDS, ...extra];
  assert.equal(Object.keys(releaseOf("c1", workersStack(), env, records).settings.workers).length, 100);

  const done = await run({ record, commit: "c1", env, records });
  assert.equal(done.outcome, "live", done.message);
  const short = shortOf(record);
  const group = standIn.view().scalingGroups.find((one) => one.name === `v64-${short}-service-workers`);
  const userData = Buffer.from(standIn.view().templates.find((one) => one.id === group.template.id).versions.at(-1).UserData, "base64").toString("utf8");
  assert.ok(userData.length < 16384, `user data of ${userData.length} bytes`);
  assert.equal(extra.some(({ key }) => userData.includes(key)), false);
  // Each machine starts with every one of them, the secret ones read from Secrets Manager.
  const running = standIn.environmentOf(group.name);
  assert.deepEqual(extra.map(({ key }) => running.env[key]), extra.map(({ key }) => env[key]));
  assert.deepEqual(running.secrets.filter((name) => name.startsWith("WORKERS_SETTING_")).length, extra.filter((one) => one.secret).length);
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { servicePackages } from "../../packages/vibe64-deploy/src/adapters/mobilynet/declaration.js";
import { createMobilynetAdapter } from "../../packages/vibe64-deploy/src/adapters/mobilynet/index.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { settingsPerService, withRootFile } from "../../packages/vibe64-deploy/src/package.js";
import { planOf } from "../../packages/vibe64-deploy/src/plan.js";
import { newRecord } from "../../packages/vibe64-deploy/src/record.js";
import { deploy } from "../../packages/vibe64-deploy/src/steps.js";
import { MEMOBOT_COMPUTERS_PACKAGES, MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES } from "../fixtures/deploymentServices.js";
import { world } from "./vibe64DeployStandInHelpers.js";

// One build per Deployment build: a two-service app whose services build from one source is one app at mobilynet, its
// one release uploaded once and built once, each App Service running that app with its own settings, exposure, count
// and size. A Production made with one app per service moves to it on its next Deploy, its old App Services serving
// until the new ones are healthy, its resources kept.
const exec = promisify(execFile);
const DOMAIN = "memobot.example.com";
const HOLDER = "Vibe64 on laptop";
const ENV_RECORDS = [
  { key: "STRIPE_SECRET_KEY", secret: true, services: ["web"] },
  { key: "MEMOBOT_MAX_COMPUTERS", secret: false, services: ["computers"] }
];
const ENV = {
  AUTH_LOCAL_SESSION_SECRET: "session-1", MEMOBOT_VAULT_KEY: "vault-1", AUTH_LOCAL_SECOND_FACTOR_KEY: "second-1",
  MEMOBOT_FILES_PASSPHRASE: "files-1", MEMOBOT_COMPUTERS_SECRET: "computers-1", AUTH_LOCAL_SETUP_CODE: "setup-1",
  STRIPE_SECRET_KEY: "sk_test_1", MEMOBOT_MAX_COMPUTERS: "4"
};

/** The two-service Stack (web public in gVisor, computers internal and reached at each instance, with packages of its own). */
function stackOf() {
  const deployment = vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources: MEMOBOT_RESOURCES },
    section: { status: "ready", stackHash: "sha256:stack", lines: [...MEMOBOT_DEPLOYMENT_LINES], components: [], source: "project" }
  });
  return { deployment, needs: needsOfStack(deployment, { preferredAlternative, resourceKindIsDatabase }).needs };
}

/**
 * The same Stack as the engine before one build per Deployment build packed it: each service its own build and its own
 * app at mobilynet (its needs say each service is built alone).
 */
function perServiceStackOf() {
  const { deployment, needs } = stackOf();
  return { deployment, needs: { ...needs, services: needs.services.map((service) => ({ ...service, builtWith: service.id })) } };
}

/** A release of a commit, its declarations and settings from the Stack, as a host makes one. */
function releaseOf(commit, { deployment, needs }) {
  const settings = settingsPerService(needs, ENV_RECORDS);
  const { declarations, scripts } = servicePackages({ app: "memobot", deployment, needs, settings });
  return { id: commit, archive: withRootFile(gzipSync(Buffer.alloc(1024)), "commit.txt", commit).bytes, declarations, scripts, settings, env: ENV, domain: DOMAIN };
}

/** mobilynet's stand-in with room for both services, the adapter over it, and a Deploy that reads its plan first. */
function setup() {
  const parts = world();
  parts.standIn.setQuota(parts.projectId, { vcpus: 192, memoryGib: 384 });
  const adapter = createMobilynetAdapter({ client: parts.client, project: parts.projectId, leases: true });
  const planFor = async (stack, record) => planOf({ needs: stack.needs, record, observed: await adapter.inventory(), offer: await adapter.offer() });
  const run = async ({ stack, record, commit, pause = () => parts.standIn.advance() }) => {
    const plan = await planFor(stack, record);
    const result = await deploy({ adapter, needs: stack.needs, record, planHash: plan.hash, release: releaseOf(commit, stack), holder: HOLDER, pause });
    return { ...result, plan };
  };
  return { ...parts, adapter, run, planFor, record: newRecord({ app: "memobot", environment: "production", provider: { id: "mobilynet", project: parts.projectId } }) };
}

const uploadsOf = (requests) => requests.filter((request) => request.method === "POST" && /^\/v1\/projects\/[^/]+\/apps\/[^/]+\/releases$/u.test(request.path))
  .map((request) => request.path.split("/")[5]);
const handedOf = (requests) => requests.filter((request) => request.method === "POST" && /^\/v1\/services\/[^/]+\/releases$/u.test(request.path));
const madeOf = (requests) => requests.filter((request) => request.method === "POST" && /^\/v1\/projects\/[^/]+\/services$/u.test(request.path));

test("two services built from one source are one app at mobilynet: one declaration with every service's packages, each service's own script picked by its V64_SERVICE", async (t) => {
  const stack = stackOf();
  const { declarations, scripts } = releaseOf("c1", stack);
  // One declaration for both, named after the public service, with the shared packages and computers' own.
  assert.deepEqual(declarations.web, declarations.computers);
  const declaration = declarations.web;
  assert.equal(declaration.name, "memobot-web");
  for (const name of [...stack.deployment.packages, ...MEMOBOT_COMPUTERS_PACKAGES]) assert.ok(declaration.requiredPackages.includes(name), name);
  assert.equal(new Set(declaration.requiredPackages).size, declaration.requiredPackages.length);
  // One service of the release, whose script runs the instance's own service; one health path and the same machine
  // features for both.
  assert.deepEqual(declaration.services, [{ name: "app", command: "bash vibe64-app/serve.sh", user: "memobot-web", port: 3000, healthPath: "/api/health" }]);
  assert.deepEqual(declaration.machineFeatures, ["userns"]);
  assert.equal(declaration.tasks.migrate.command.endsWith(" bash vibe64-app/migrate.sh"), true);
  // A setting one service requires and the other doesn't is declared optional: the engine checks each service's own.
  assert.equal(declaration.settings.MEMOBOT_COMPUTERS_URL.required, false);
  assert.equal(declaration.settings.AUTH_LOCAL_SESSION_SECRET.required, true);
  assert.deepEqual(Object.keys(scripts).sort(), ["vibe64-app/build.sh", "vibe64-app/migrate-computers.sh", "vibe64-app/migrate-web.sh", "vibe64-app/migrate.sh",
    "vibe64-app/serve-computers.sh", "vibe64-app/serve-web.sh", "vibe64-app/serve.sh"]);

  // The release's service script runs the service V64_SERVICE names, as the instance's login, from the settings start
  // left; with none, or one the release has no script for, it stops naming why.
  const root = await mkdtemp(path.join(tmpdir(), "deploy-one-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "vibe64-app"));
  await writeFile(path.join(root, "vibe64-app/serve.sh"), scripts["vibe64-app/serve.sh"].replaceAll("/run/app-settings/memobot-web/settings.json", path.join(root, "settings.json")));
  for (const service of ["web", "computers"]) await writeFile(path.join(root, `vibe64-app/serve-${service}.sh`), `echo "serving ${service}"\n`);
  await chmod(path.join(root, "vibe64-app/serve.sh"), 0o755);
  const serve = async (settings) => {
    await writeFile(path.join(root, "settings.json"), JSON.stringify(settings));
    return exec("bash", ["vibe64-app/serve.sh"], { cwd: root }).then(({ stdout }) => ({ stdout }), (error) => ({ code: error.code, stderr: error.stderr }));
  };
  assert.deepEqual(await serve({ V64_SERVICE: "computers" }), { stdout: "serving computers\n" });
  assert.deepEqual(await serve({ V64_SERVICE: "web" }), { stdout: "serving web\n" });
  const unknown = await serve({ V64_SERVICE: "nothing" });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /V64_SERVICE/u);
  assert.equal((await serve({})).code, 1);

  // Services built apart stay apart: a different health path is a different app.
  const apart = servicePackages({
    app: "memobot", deployment: { ...stack.deployment, services: stack.deployment.services.map((one) => (one.id === "computers" ? { ...one, readyWhen: { ...one.readyWhen, path: "/api/agent-health" } } : one)) },
    needs: { ...stack.needs, services: stack.needs.services.map((one) => ({ ...one, builtWith: one.id })) }, settings: settingsPerService(stack.needs, ENV_RECORDS)
  });
  assert.deepEqual([apart.declarations.web.name, apart.declarations.computers.name], ["memobot-web", "memobot-computers"]);
});

test("a first Deploy of two services uploads their one release once, builds it once, and the second service releases the first's version", async () => {
  const { standIn, run, record } = setup();
  const before = standIn.requests().length;
  const first = await run({ stack: stackOf(), record, commit: "c1" });
  assert.equal(first.outcome, "live", first.message);
  const asked = standIn.requests().slice(before);
  // One upload, of one app; both App Services made from that one version.
  assert.deepEqual(uploadsOf(asked), ["memobot-web"]);
  const made = madeOf(asked).map((request) => request.body);
  assert.deepEqual(made.map((body) => [body.name, body.app.name]).sort(), [["memobot-computers", "memobot-web"], ["memobot-web", "memobot-web"]]);
  assert.equal(made[0].app.version, made[1].app.version);
  const web = standIn.services.service(first.record.items["service.web"].id);
  const computers = standIn.services.service(first.record.items["service.computers"].id);
  assert.deepEqual([web.app, computers.app, web.version === computers.version], ["memobot-web", "memobot-web", true]);
  // Each App Service keeps its own: exposure, settings (V64_SERVICE naming its service), the reached address.
  assert.deepEqual([web.exposure, computers.exposure], ["public", "internal"]);
  assert.deepEqual([web.settings.V64_SERVICE, computers.settings.V64_SERVICE], ["web", "computers"]);
  assert.deepEqual([web.settings.MEMOBOT_MAX_COMPUTERS, computers.settings.MEMOBOT_MAX_COMPUTERS], [undefined, "4"]);
  assert.equal(web.settings.MEMOBOT_COMPUTERS_URL, `http://${computers.internalName}:3000`);

  // The next commit: one upload again, and each service handed the one version.
  const at = standIn.requests().length;
  const second = await run({ stack: stackOf(), record: first.record, commit: "c2" });
  assert.equal(second.outcome, "live", second.message);
  const again = standIn.requests().slice(at);
  assert.deepEqual(uploadsOf(again), ["memobot-web"]);
  const handed = handedOf(again);
  assert.equal(handed.length, 2);
  assert.equal(handed[0].body.version, handed[1].body.version);
  assert.equal(standIn.services.service(first.record.items["service.web"].id).version, standIn.services.service(first.record.items["service.computers"].id).version);
});

test("a Production made with one app per service moves to one app on its next Deploy: the plan says which App Service is made again, the old one serves until the new one is healthy, and nothing holding data changes", async () => {
  const { standIn, run, planFor, record } = setup();
  // The Production as the engine made it before: two apps, one per service.
  const old = await run({ stack: perServiceStackOf(), record, commit: "c1" });
  assert.equal(old.outcome, "live", old.message);
  const oldWeb = old.record.items["service.web"].id;
  const oldComputers = old.record.items["service.computers"].id;
  assert.deepEqual([standIn.services.service(oldWeb).app, standIn.services.service(oldComputers).app], ["memobot-web", "memobot-computers"]);
  const resources = [old.record.items["resource.database"].id, old.record.items["resource.files"].id];

  // The plan of the next Deploy says it exactly: web kept, computers made again on web's app, the resources kept.
  const plan = await planFor(stackOf(), old.record);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.items.map((item) => [item.kind, item.name, item.verb]),
    [["service", "web", "kept"], ["service", "computers", "replaced"], ["resource", "database", "kept"], ["resource", "files", "kept"]]);
  const replaced = plan.items.find((item) => item.name === "computers");
  assert.deepEqual(replaced.changes, [{ field: "app", from: "memobot-computers", to: "memobot-web" }]);
  assert.match(replaced.note, /keeps serving until the new one is healthy/u);

  // While it deploys, the old computers serves until the new one is healthy, and web always reaches a computers that serves.
  const seen = [];
  const pause = () => {
    standIn.advance();
    const fresh = standIn.services.all().filter((one) => one.name !== "memobot-web" && one.id !== oldComputers && one.state !== "deleted");
    const oldOne = standIn.services.service(oldComputers);
    seen.push({
      oldServing: oldOne.state !== "deleted" && oldOne.state !== "deleting",
      newHealthy: fresh.some((one) => one.instances.healthy > 0)
    });
  };
  const at = standIn.requests().length;
  const moved = await run({ stack: stackOf(), record: old.record, commit: "c2", pause });
  assert.equal(moved.outcome, "live", moved.message);
  assert.ok(seen.every((one) => one.oldServing || one.newHealthy), "a computers serves at every step");
  const asked = standIn.requests().slice(at);
  assert.deepEqual(uploadsOf(asked), ["memobot-web"], "one upload, of the one app");
  // web kept its App Service (its routes and domain); computers is a new App Service of web's app; the old one deleted
  // last, once web runs the release that reaches the new one.
  assert.equal(moved.record.items["service.web"].id, oldWeb);
  const newComputers = moved.record.items["service.computers"].id;
  assert.notEqual(newComputers, oldComputers);
  assert.equal(moved.record.items["service.computers"].replaces, undefined);
  const web = standIn.services.service(oldWeb);
  const computers = standIn.services.service(newComputers);
  assert.deepEqual([web.app, computers.app, web.version === computers.version], ["memobot-web", "memobot-web", true]);
  assert.equal(standIn.services.service(oldComputers).state, "deleted");
  const deletes = asked.filter((request) => request.method === "DELETE" && !request.path.startsWith("/v1/leases/"));
  assert.deepEqual(deletes.map((request) => request.path), [`/v1/services/${oldComputers}`]);
  const webReleased = asked.findIndex((request) => request.method === "POST" && request.path === `/v1/services/${oldWeb}/releases`);
  assert.ok(webReleased >= 0 && webReleased < asked.indexOf(deletes[0]), "web reaches the new computers before the old one goes");
  assert.equal(web.settings.MEMOBOT_COMPUTERS_URL, `http://${computers.internalName}:3000`);
  assert.equal(standIn.services.reaches(oldWeb, newComputers, 3000), true);
  // The resources: the same hosted services, never deleted, each linked to the new computers.
  assert.deepEqual([moved.record.items["resource.database"].id, moved.record.items["resource.files"].id], resources);
  for (const id of resources) {
    const hosted = standIn.hosted.service(id);
    assert.notEqual(hosted.state, "deleted");
    assert.ok(hosted.links.some((link) => link.state === "active" && link.consumer.id === newComputers), id);
  }
  // The Deploy after it changes nothing.
  const after = await planFor(stackOf(), moved.record);
  assert.deepEqual(after.items.map((item) => item.verb), ["kept", "kept", "kept", "kept"]);
});

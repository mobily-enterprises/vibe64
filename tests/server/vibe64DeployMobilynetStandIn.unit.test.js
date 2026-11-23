import assert from "node:assert/strict";
import test from "node:test";

import { AT, DAY, HOST, SHOP, refusal, refused, runningShop, settle, upload, webSpec, world } from "./vibe64DeployStandInHelpers.js";
import { createMobilynetClient } from "../../packages/vibe64-deploy/src/adapters/mobilynet/client.js";
import { createMobilynetAdapter } from "../../packages/vibe64-deploy/src/adapters/mobilynet/index.js";

// The deploy engine's mobilynet stand-in, asked through the engine's client with no server: a project's releases,
// App Services made from them and refreshed, public and internal with connections, hosted services linked to several
// services, prices and the catalogue; and what mobilynet is building for the engine: tags on services and hosted
// services, service instances in the project's quotas, the spending cap, and leases.

const DB_SETTINGS = ["DB_DATABASE", "DB_HOST", "DB_PORT", "DB_SSLMODE", "DB_USER"];

test("a project's release is uploaded and checked as mobilynet checks it, and built when mobilynet moves on", async () => {
  const { standIn, production, projectId } = world();
  const first = upload(SHOP, "1");
  const { release } = await production.createRelease("shop", first);
  assert.match(release.version, new RegExp(`^${DAY}-${first.sha256.slice(0, 7)}$`, "u"));
  assert.deepEqual(
    { state: release.state, source: release.source, declaration: release.declaration, retiredAt: release.retiredAt },
    { state: "active", source: { upload: { sha256: first.sha256, sizeBytes: first.archive.length, deletedAt: null } }, declaration: null, retiredAt: null }
  );
  assert.equal((await production.createRelease("shop", first)).release.version, release.version, "the same bytes answer the release they made");
  assert.deepEqual(standIn.releases(projectId, "shop").map((one) => [one.version, one.build]), [[release.version, "building"]]);
  standIn.advance();
  assert.deepEqual(standIn.releases(projectId, "shop").map((one) => [one.version, one.build]), [[release.version, "built"]]);

  const wrongName = await refused(production.createRelease("shop", upload({ ...SHOP, name: "other" }, "2")));
  assert.deepEqual(refusal(wrongName), { status: 422, code: "validation_failed", fields: ["declaration.name"] });
  const unknownInterface = await refused(production.createRelease("shop", upload({ ...SHOP, needs: [{ interface: "mongodb", as: "DB" }] }, "3")));
  assert.deepEqual(refusal(unknownInterface), { status: 422, code: "validation_failed", fields: ["declaration.needs.0"] });
  const clash = await refused(production.createRelease("shop", upload({ ...SHOP, settings: { ...SHOP.settings, DB_HOST: { type: "string" } } }, "4")));
  assert.deepEqual(refusal(clash), { status: 422, code: "validation_failed", fields: ["declaration.needs.0.as"] });
  assert.match(clash.details.fieldErrors["declaration.needs.0.as"], /DB_HOST, which the app declares itself/u);
  const gone = await refused(production.createRelease("shop", upload({ ...SHOP, testApps: [] }, "5")));
  assert.deepEqual(refusal(gone), { status: 422, code: "validation_failed", fields: ["declaration.testApps"] });
  const mismatch = await refused(production.createRelease("shop", { archive: first.archive, sha256: "0".repeat(64) }));
  assert.deepEqual(refusal(mismatch), { status: 422, code: "validation_failed", fields: ["archive"] });
  assert.equal(standIn.releases(projectId, "shop").length, 1, "nothing refused is kept");
});

test("an App Service made from a release runs once its instances are healthy, each with its own _mobilynet, and its route serves once its domain is verified", async () => {
  const parts = world();
  const { standIn, client, production, projectId } = parts;
  await production.createDomain(HOST, { idempotencyKey: "domain-shop" });
  const { release } = await production.createRelease("shop", upload(SHOP, "1"));
  const spec = webSpec(release.version);
  const created = await production.createService(spec, { idempotencyKey: "service-web" });
  assert.equal(created.service.state, "creating");
  assert.deepEqual(created.service.instances, { wanted: 2, running: 0, inRotation: 0, healthy: 0 });
  assert.deepEqual([created.service.settings, created.service.secrets], [["mode"], ["sessionKey"]], "named, never shown");
  assert.equal(created.service.internalName, `web.${projectId.replace("_", "-")}.internal`);
  // The service's own name is the service's; its route's DNS target is the route's own name, region-free.
  const own = `${created.service.id.replace("_", "-")}.us.mobilynet.standin`;
  const [asked] = created.service.routes;
  const routeName = `${asked.id.replace("_", "-")}.routes.mobilynet.standin`;
  assert.deepEqual([created.service.target, created.service.routes.map((one) => [one.host, one.target])], [own, [[HOST, routeName]]]);
  assert.deepEqual(
    { kind: created.refresh.kind, state: created.refresh.state, fromVersion: created.refresh.fromVersion, toVersion: created.refresh.toVersion },
    { kind: "create", state: "queued", fromVersion: null, toVersion: release.version }
  );
  assert.equal((await production.createService(spec, { idempotencyKey: "service-web" })).service.id, created.service.id, "the key answers the first create");
  const reused = await refused(production.createService({ ...spec, instances: 3 }, { idempotencyKey: "service-web" }));
  assert.deepEqual([reused.status, reused.code, reused.retryable], [409, "idempotency_key_reused", false]);

  settle(standIn);
  let service = await client.readService(created.service.id);
  assert.deepEqual(
    { state: service.state, version: service.version, instances: service.instances, port: service.port, healthPath: service.healthPath, refresh: service.refresh },
    { state: "running", version: release.version, instances: { wanted: 2, running: 2, inRotation: 2, healthy: 2 }, port: 3000, healthPath: "/api/health", refresh: null }
  );
  assert.equal(service.routes[0].live, false, "its domain isn't verified yet");
  standIn.verifyDomain(HOST, projectId);
  service = await client.readService(created.service.id);
  const [route] = service.routes;
  assert.deepEqual({ id: route.id, host: route.host, tls: route.tls, target: route.target, live: route.live }, { id: asked.id, host: HOST, tls: "edge", target: routeName, live: true });
  const listed = (await production.listRoutes()).find((one) => one.id === route.id);
  assert.deepEqual(
    { serviceId: listed.serviceId, vpsId: listed.vpsId, group: listed.group, port: listed.port, target: listed.target, live: listed.live },
    { serviceId: service.id, vpsId: null, group: null, port: 3000, target: routeName, live: true }
  );
  const kept = await refused(client.project(projectId).deleteDomain(listed.domainId));
  assert.deepEqual([kept.status, kept.code], [409, "domain_in_use"]);
  const steps = (await client.readServiceRefresh(service.id, created.refresh.id)).steps.map((step) => step.step);
  assert.deepEqual(steps.slice(0, 2), ["build_started", "build_passed"]);
  assert.equal(steps.filter((step) => step === "instance_joined").length, 2);

  const instances = await client.listServiceInstances(service.id);
  assert.deepEqual(instances.map((one) => [one.version, one.size, one.rotation, one.health]), [
    [release.version, "a-2", "in", "healthy"], [release.version, "a-2", "in", "healthy"]
  ]);
  const held = standIn.services.instances(service.id);
  assert.deepEqual(held.map((one) => [one.settings, one.secrets]), [[{ mode: "web" }, { sessionKey: "session-1" }], [{ mode: "web" }, { sessionKey: "session-1" }]]);
  assert.deepEqual(held[0].mobilynet, {
    instanceId: instances[0].id,
    hostname: instances[0].name,
    privateAddress: instances[0].privateAddress,
    service: "web",
    serviceId: service.id,
    projectId,
    version: release.version,
    edgeAddresses: ["203.0.113.40", "203.0.113.41"]
  }, "each instance gets its own _mobilynet");
  assert.notEqual(held[0].mobilynet.instanceId, held[1].mobilynet.instanceId);
  const reserved = await refused(client.putServiceSettings(service.id, { settings: { mode: "web", _mobilynet: "{}" }, secrets: {} }));
  assert.deepEqual(refusal(reserved), { status: 422, code: "validation_failed", fields: ["_mobilynet"] });

  const taken = await refused(production.createService(spec, { idempotencyKey: "service-web-2" }));
  assert.deepEqual([taken.status, taken.code], [409, "name_taken"]);
  const uncovered = await refused(production.createService(webSpec(release.version, { name: "api", routes: [{ host: "api.other.example" }] }), { idempotencyKey: "service-api" }));
  assert.deepEqual(refusal(uncovered), { status: 422, code: "validation_failed", fields: ["routes.0.host"] });
  const wrongSize = await refused(production.createService(webSpec(release.version, { name: "api", size: "a-3", routes: [] }), { idempotencyKey: "service-api-2" }));
  assert.deepEqual(refusal(wrongSize), { status: 422, code: "validation_failed", fields: ["size"] });
  const unknownRelease = await refused(production.createService(webSpec("20261120-0000000", { name: "api", routes: [] }), { idempotencyKey: "service-api-3" }));
  assert.deepEqual([unknownRelease.status, unknownRelease.code], [404, "not_found"]);
  const noKey = await refused(production.createService(webSpec(release.version, { name: "api", routes: [] }), { idempotencyKey: undefined }));
  assert.deepEqual([noKey.status, noKey.code], [400, "invalid_request"]);
  // mobilynet takes a key of 1 to 128 printable characters (its idempotency.js).
  const longKey = await refused(production.createService(webSpec(release.version, { name: "api", routes: [] }), { idempotencyKey: "k".repeat(129) }));
  assert.deepEqual([longKey.status, longKey.code, longKey.details], [400, "invalid_request", { header: "Idempotency-Key" }]);
  assert.equal((await production.createService(webSpec(release.version, { name: "api", routes: [] }), { idempotencyKey: "k".repeat(128) })).service.name, "api");
});

test("a settings replace takes a name its release doesn't declare as a plain setting or a secret, text of up to 4096 characters, but not one mobilynet's runtime sets, and at most as many in all as its region holds", async () => {
  const { standIn, client, serviceId } = await runningShop();
  // The shop's release declares mode and sessionKey alone: GREETING, API_KEY and V64_INSTANCE_ID are new to it, and V64_*
  // names are Vibe64's own, which mobilynet leaves open.
  const taken = await client.putServiceSettings(serviceId, {
    settings: { mode: "web", GREETING: "x".repeat(4096) }, secrets: { sessionKey: "session-1", API_KEY: "key-1", V64_INSTANCE_ID: "i-1" }
  });
  assert.equal(taken.refresh.kind, "settings");
  settle(standIn);
  const service = await client.readService(serviceId);
  assert.deepEqual([service.settings, service.secrets], [["GREETING", "mode"], ["API_KEY", "V64_INSTANCE_ID", "sessionKey"]]);
  const serving = standIn.services.instances(serviceId).filter((one) => one.rotation !== "gone");
  assert.ok(serving.length === 2 && serving.every((one) => one.settings.GREETING.length === 4096 && one.secrets.API_KEY === "key-1"), "onto new instances with both");
  // Such a name's value is text of up to 4096 characters, by a name mobilynet's runtime doesn't set on every instance,
  // as a plain setting or a secret. A link's own names are refused below.
  const given = (settings, secrets = {}) => refused(client.putServiceSettings(serviceId, { settings: { mode: "web", ...settings }, secrets: { sessionKey: "session-1", ...secrets } }));
  assert.deepEqual(refusal(await given({ GREETING: "x".repeat(4097) })), { status: 422, code: "validation_failed", fields: ["settings.GREETING"] });
  assert.deepEqual(refusal(await given({ RETRIES: 3 })), { status: 422, code: "validation_failed", fields: ["settings.RETRIES"] });
  const runtime = await given({ PATH: "/bin", HOME: "/root", LANG: "C", GIT_CONFIG_COUNT: "1" }, { GIT_CONFIG_KEY_0: "k", GIT_CONFIG_VALUE_0: "v", MOBILYNET_TOKEN: "t" });
  assert.deepEqual(refusal(runtime), { status: 422, code: "validation_failed", fields: [
    "secrets.GIT_CONFIG_KEY_0", "secrets.GIT_CONFIG_VALUE_0", "secrets.MOBILYNET_TOKEN", "settings.GIT_CONFIG_COUNT", "settings.HOME", "settings.LANG", "settings.PATH"
  ] });
  assert.equal(runtime.details.fieldErrors["settings.PATH"], "MobilyNet sets PATH itself on every instance: name it otherwise.");
  assert.equal(runtime.details.fieldErrors["secrets.MOBILYNET_TOKEN"], "MobilyNet's own names start with MOBILYNET_, which it sets on every instance: name it otherwise.");
  // As many settings and secrets in all as the region holds, 199 where every host runs agent 2.9.0 or later: mode and
  // sessionKey with 197 more are taken, 198 more are refused. While a host of the region runs an earlier agent, it holds
  // 49: 48 more are refused, naming that.
  const more = (count) => Object.fromEntries(Array.from({ length: count }, (_, at) => [`EXTRA_${at}`, "x"]));
  assert.equal((await client.putServiceSettings(serviceId, { settings: { mode: "web", ...more(197) }, secrets: { sessionKey: "session-1" } })).refresh.kind, "settings");
  settle(standIn);
  const crowded = await given(more(198));
  assert.deepEqual(refusal(crowded), { status: 422, code: "validation_failed", fields: ["settings"] });
  assert.equal(crowded.details.fieldErrors.settings, "At most 199 settings and secrets in all, its links' among them, as an instance takes no more: these would be 200.");
  standIn.faults.olderHost = true;
  const older = await given(more(48));
  assert.deepEqual(refusal(older), { status: 422, code: "validation_failed", fields: ["settings"] });
  assert.equal(older.details.fieldErrors.settings, "At most 49 settings and secrets in all, its links' among them, as an instance takes no more: these would be 50.");
  assert.deepEqual(standIn.services.refreshes(serviceId).map((one) => one.kind), ["create", "settings", "settings"], "a refused replace starts no refresh");
});

test("an internal service has no routes and is reached by another's connection on its port", async () => {
  const { standIn, client, production, projectId, release, serviceId } = await runningShop();
  const computers = await production.createService(webSpec(release.version, { name: "computers", exposure: "internal", routes: [], instances: 1 }), { idempotencyKey: "service-computers" });
  assert.deepEqual([computers.service.exposure, computers.service.target, computers.service.routes], ["internal", null, []]);
  assert.equal(computers.service.internalName, `computers.${projectId.replace("_", "-")}.internal`);
  const routed = await refused(production.createService(webSpec(release.version, { name: "worker", exposure: "internal" }), { idempotencyKey: "service-worker" }));
  assert.deepEqual(refusal(routed), { status: 422, code: "validation_failed", fields: ["routes"] });
  const nowhere = await refused(client.changeService(serviceId, { connections: [{ to: "svc_nothing", port: 3000 }] }));
  assert.deepEqual(refusal(nowhere), { status: 422, code: "validation_failed", fields: ["connections.0.to"] });

  const connected = await client.changeService(serviceId, { connections: [{ to: computers.service.id, port: 3000 }] });
  assert.deepEqual([connected.refresh, connected.service.connections], [null, [{ to: computers.service.id, port: 3000, ruleId: null }]]);
  settle(standIn);
  assert.equal(standIn.services.reaches(serviceId, computers.service.id, 3000), true);
  assert.equal(standIn.services.reaches(computers.service.id, serviceId, 3000), false, "a connection opens one way");
  assert.equal(standIn.services.reaches(serviceId, computers.service.id, 4000), false, "on its port only");
  const [instance] = await client.listServiceInstances(computers.service.id);
  assert.equal(instance.internalName, `${instance.name}.computers.${projectId.replace("_", "-")}.internal`);
  assert.equal(standIn.services.instances(computers.service.id)[0].mobilynet.service, "computers");
  assert.equal((await production.listServices()).length, 2);
});

test("a hosted PostgreSQL made with a link gives the service its need's settings, the password shown once", async () => {
  const { standIn, client, production, projectId, serviceId } = await runningShop();
  const made = await production.createHostedService({ app: "postgresql-18", links: [{ consumer: { service: serviceId } }] }, { idempotencyKey: "hosted-db" });
  const { hostedService } = made;
  assert.match(hostedService.name, /^postgresql-[a-z2-7]{4}$/u);
  const host = `${hostedService.name}.${projectId.replace("_", "-")}.internal`;
  assert.deepEqual(
    { state: hostedService.state, size: hostedService.size, machine: hostedService.machine, connection: hostedService.connection, links: hostedService.links },
    {
      state: "creating", size: "small", machine: { size: "m-1", vcpus: 1, memoryGib: 2, dataDiskGib: 10 },
      connection: { host, port: 5432, database: "app", sslmode: "disable" }, links: { active: 0, pending: 1 }
    }
  );
  assert.equal(made.operation.kind, "create");
  const [link] = made.links;
  assert.deepEqual(
    { state: link.state, need: link.need, consumer: link.consumer, settings: link.settings },
    { state: "issuing", need: "DB", consumer: { kind: "service", id: serviceId, name: "web" }, settings: ["DB_HOST", "DB_PORT", "DB_DATABASE", "DB_USER", "DB_PASSWORD", "DB_SSLMODE"] }
  );
  assert.equal(link.connection.user, link.id, "the link signs in as a role named by its id");
  assert.match(link.connection.password, /^[A-Za-z0-9_-]{43}$/u, "its secret field shown this once");
  const again = await production.createHostedService({ app: "postgresql-18", links: [{ consumer: { service: serviceId } }] }, { idempotencyKey: "hosted-db" });
  assert.deepEqual([again.hostedService.id, again.links[0].connection.password], [hostedService.id, undefined], "a replay never shows the secret again");
  const [listed] = await client.listHostedLinks(hostedService.id);
  assert.deepEqual([listed.id, listed.connection.password], [link.id, undefined], "a listed link carries no secret");

  settle(standIn);
  const read = await client.readHostedService(hostedService.id);
  assert.deepEqual([read.state, read.health.state, read.links], ["running", "healthy", { active: 1, pending: 0 }]);
  const held = standIn.services.service(serviceId);
  assert.deepEqual(held.settings, { mode: "web", DB_HOST: host, DB_PORT: 5432, DB_DATABASE: "app", DB_USER: link.id, DB_SSLMODE: "disable" });
  assert.deepEqual(held.secrets, { sessionKey: "session-1", DB_PASSWORD: link.connection.password }, "the password reaches the service as a secret");
  const service = await client.readService(serviceId);
  assert.deepEqual([service.settings, service.secrets], [[...DB_SETTINGS, "mode"], ["DB_PASSWORD", "sessionKey"]]);
  const serving = standIn.services.instances(serviceId).filter((one) => one.rotation !== "gone");
  assert.ok(serving.length === 2 && serving.every((one) => one.secrets.DB_PASSWORD === link.connection.password), "through a settings refresh, onto new instances");

  const named = await refused(client.putServiceSettings(serviceId, { settings: { mode: "worker", DB_HOST: "elsewhere" }, secrets: {} }));
  assert.deepEqual(refusal(named), { status: 422, code: "validation_failed", fields: ["DB_HOST"] });
  const replaced = await client.putServiceSettings(serviceId, { settings: { mode: "worker" }, secrets: { sessionKey: "session-2" } });
  assert.equal(replaced.refresh.kind, "settings");
  settle(standIn);
  assert.equal(standIn.services.service(serviceId).settings.mode, "worker");
  assert.equal(standIn.services.service(serviceId).secrets.DB_PASSWORD, link.connection.password, "a replace keeps its link's settings");

  const resized = await client.changeHostedService(hostedService.id, { size: "medium" });
  assert.deepEqual([resized.hostedService.state, resized.operation.kind], ["resizing", "resize"]);
  settle(standIn);
  assert.deepEqual((await client.readHostedService(hostedService.id)).machine, { size: "m-2", vcpus: 2, memoryGib: 4, dataDiskGib: 40 });
  assert.equal((await client.changeHostedService(hostedService.id, { size: "medium" })).operation, null, "its size already");
});

test("one hosted service holds a link for each service that needs it, each its own login", async () => {
  const { standIn, client, production, release, serviceId } = await runningShop();
  const worker = await production.createService(webSpec(release.version, { name: "worker", exposure: "internal", routes: [], instances: 1, settings: { mode: "worker" } }), { idempotencyKey: "service-worker" });
  settle(standIn);
  const made = await production.createHostedService({
    app: "postgresql-18",
    links: [{ consumer: { service: serviceId } }, { consumer: { service: worker.service.id }, need: "DB" }]
  }, { idempotencyKey: "hosted-db" });
  assert.deepEqual(made.links.map((one) => one.consumer.name), ["web", "worker"]);
  const [web, other] = made.links;
  assert.notEqual(web.connection.password, other.connection.password);
  const twice = await refused(production.createHostedService({ app: "postgresql-18", links: [{ consumer: { service: serviceId } }, { consumer: { service: serviceId } }] }, { idempotencyKey: "hosted-db-2" }));
  assert.deepEqual([twice.status, twice.code], [409, "need_linked"]);
  settle(standIn);
  assert.deepEqual((await client.readHostedService(made.hostedService.id)).links, { active: 2, pending: 0 });
  assert.deepEqual(
    [standIn.services.service(serviceId).settings.DB_USER, standIn.services.service(worker.service.id).settings.DB_USER],
    [web.id, other.id]
  );
  assert.deepEqual(
    [standIn.services.service(serviceId).secrets.DB_PASSWORD, standIn.services.service(worker.service.id).secrets.DB_PASSWORD],
    [web.connection.password, other.connection.password]
  );
  await client.unlinkHostedService(made.hostedService.id, other.id);
  settle(standIn);
  assert.deepEqual((await client.listHostedLinks(made.hostedService.id)).map((one) => one.id), [web.id], "the other link stays");
  assert.equal("DB_USER" in standIn.services.service(worker.service.id).settings, false);
  assert.equal(standIn.services.service(serviceId).settings.DB_USER, web.id);
});

test("a link is refused as mobilynet refuses it: an app unknown, a size unknown, a release not built, a need not declared or not named", async () => {
  const { standIn, client, production, release, serviceId } = await runningShop();
  const unknownApp = await refused(production.createHostedService({ app: "mongodb-8" }, { idempotencyKey: "hosted-1" }));
  assert.deepEqual(refusal(unknownApp), { status: 422, code: "validation_failed", fields: ["app"] });
  const unknownSize = await refused(production.createHostedService({ app: "valkey-9", size: "tiny" }, { idempotencyKey: "hosted-2" }));
  assert.equal(unknownSize.details.fieldErrors.size, "One of small, medium, large, xlarge.");
  const { hostedService: db } = await production.createHostedService({ app: "postgresql-18" }, { idempotencyKey: "hosted-3" });
  // A service whose first release failed runs none and has no refresh ahead.
  standIn.faults.instancesUnhealthy = true;
  const waiting = await production.createService(webSpec(release.version, { name: "worker", exposure: "internal", routes: [] }), { idempotencyKey: "service-worker" });
  settle(standIn);
  standIn.faults.instancesUnhealthy = false;
  const notBuilt = await refused(client.linkHostedService(db.id, { consumer: { service: waiting.service.id } }));
  assert.equal(notBuilt.details.fieldErrors.consumer, "Its app has no release built yet: link it once one has.");
  const shape = await refused(client.linkHostedService(db.id, { consumer: { svc: serviceId } }));
  assert.deepEqual(refusal(shape), { status: 422, code: "validation_failed", fields: ["consumer"] });
  const { hostedService: cache } = await production.createHostedService({ app: "valkey-9" }, { idempotencyKey: "hosted-4" });
  const noNeed = await refused(client.linkHostedService(cache.id, { consumer: { service: serviceId } }));
  assert.equal(noNeed.details.fieldErrors.need, "Its app declares no need of redis (the needs of its mobilynet.json).");
  const linked = await client.linkHostedService(db.id, { consumer: { service: serviceId } }, { idempotencyKey: "link-1" });
  const twice = await refused(client.linkHostedService(db.id, { consumer: { service: serviceId }, need: "DB" }));
  assert.deepEqual([twice.status, twice.code, twice.details], [409, "need_linked", { need: "DB", linkId: linked.link.id }]);

  const two = await runningShop(world(), { ...SHOP, needs: [{ interface: "postgresql", as: "DB" }, { interface: "postgresql", as: "AUDIT" }] });
  const { hostedService: other } = await two.production.createHostedService({ app: "postgresql-18" }, { idempotencyKey: "hosted-5" });
  const several = await refused(two.client.linkHostedService(other.id, { consumer: { service: two.serviceId } }));
  assert.equal(several.details.fieldErrors.need, "Its app declares several needs of postgresql: name one of DB, AUDIT.");
  assert.deepEqual((await two.client.linkHostedService(other.id, { consumer: { service: two.serviceId }, need: "AUDIT" })).link.settings.slice(0, 2), ["AUDIT_HOST", "AUDIT_PORT"]);
});

const NOT_READ = "The release it is moving to isn't read yet (its refresh is queued or starting): try again once that refresh is building; its build reads the release first.";
/** The names of an instance's or a refresh target's settings and secrets that start with `prefix`. */
const namesFrom = (values, prefix) => [...Object.keys(values.settings ?? {}), ...Object.keys(values.secrets ?? {})].filter((name) => name.startsWith(prefix)).sort();

test("a link is made ahead of the release the refresh in progress moves to: tried again while that refresh is queued, made while it builds so no instance restarts, and its started instances replaced while it rolls", async () => {
  // engine-support M14: checked against the release the service runs, else the release its refresh in progress moves to.
  const { standIn, client, production, release, serviceId } = await runningShop();
  const { hostedService: db } = await production.createHostedService({ app: "postgresql-18" }, { idempotencyKey: "hosted-db" });
  const { hostedService: cache } = await production.createHostedService({ app: "valkey-9" }, { idempotencyKey: "hosted-cache" });
  settle(standIn);
  const live = (id) => standIn.services.instances(id).filter((one) => one.rotation !== "gone");

  // A service just made: its create is queued, so a link is refused for the moment, a refusal the client tries again.
  const worker = await production.createService(webSpec(release.version, { name: "worker", exposure: "internal", routes: [] }), { idempotencyKey: "service-worker" });
  const soon = await refused(client.linkHostedService(db.id, { consumer: { service: worker.service.id } }, { idempotencyKey: "link-worker-soon" }));
  assert.deepEqual([refusal(soon), soon.details.fieldErrors.consumer, soon.retryable], [{ status: 422, code: "validation_failed", fields: ["consumer"] }, NOT_READ, true]);
  // Once it builds: linked against the release it moves to, before any instance started, so none restarts.
  standIn.advance();
  assert.equal((await client.readService(worker.service.id)).refresh.state, "building");
  const early = await client.linkHostedService(db.id, { consumer: { service: worker.service.id } }, { idempotencyKey: "link-worker" });
  assert.equal(early.link.need, "DB");
  settle(standIn);
  assert.equal((await client.readService(worker.service.id)).version, release.version);
  assert.deepEqual(live(worker.service.id).map((one) => namesFrom(one, "DB_")), [0, 1].map(() => ["DB_DATABASE", "DB_HOST", "DB_PASSWORD", "DB_PORT", "DB_SSLMODE", "DB_USER"]));
  assert.deepEqual(standIn.services.instances(worker.service.id).filter((one) => one.removedReason), [], "no instance restarted");
  assert.deepEqual(standIn.services.refreshes(worker.service.id).map((one) => one.kind), ["create"], "no settings refresh of its own");

  // A new release naming a new need: refused for the moment while queued; linked once it rolls, the instances it
  // started already are drained and started again, and every instance it leaves serving has the cache's settings.
  const withCache = { ...SHOP, needs: [...SHOP.needs, { interface: "redis", as: "CACHE" }] };
  const next = await client.createServiceRelease(serviceId, upload(withCache, "2"));
  assert.equal((await refused(client.linkHostedService(cache.id, { consumer: { service: serviceId } }))).retryable, true);
  for (let step = 0; step < 20 && live(serviceId).every((one) => one.refreshId !== next.refresh.id); step += 1) standIn.advance();
  const before = live(serviceId).filter((one) => one.refreshId === next.refresh.id).map((one) => one.id);
  assert.ok(before.length > 0);
  await client.linkHostedService(cache.id, { consumer: { service: serviceId } }, { idempotencyKey: "link-cache" });
  assert.deepEqual(standIn.services.instances(serviceId).filter((one) => before.includes(one.id)).map((one) => [one.rotation, one.removedReason]), before.map(() => ["gone", "link_changed"]));
  settle(standIn);
  assert.equal((await client.readService(serviceId)).version, next.release.version);
  assert.ok(live(serviceId).every((one) => namesFrom(one, "CACHE_").length > 0));
  assert.deepEqual(standIn.services.refreshes(serviceId).map((one) => one.kind), ["create", "release"]);
});

test("a link made ahead joins the changes of settings queued behind its refresh, a settings replace waits for the move, a need both releases name queues its own change, and a failed move ends the link and takes its settings out", async () => {
  const { standIn, client, production, release, serviceId } = await runningShop();
  const { hostedService: db } = await production.createHostedService({ app: "postgresql-18" }, { idempotencyKey: "hosted-db" });
  const { hostedService: cache } = await production.createHostedService({ app: "valkey-9" }, { idempotencyKey: "hosted-cache" });
  settle(standIn);
  const withCache = { ...SHOP, needs: [...SHOP.needs, { interface: "redis", as: "CACHE" }] };
  const next = await client.createServiceRelease(serviceId, upload(withCache, "2"));
  // A replace made before linking is taken, queued behind the release.
  await client.putServiceSettings(serviceId, { settings: { mode: "web-2" }, secrets: { sessionKey: "session-1" } }, { idempotencyKey: "settings-1" });
  standIn.advance();
  const refreshesOf = (kind) => standIn.services.refreshes(serviceId).filter((one) => one.kind === kind);
  assert.equal(refreshesOf("release").at(-1).state, "building");

  // DB, which the release it runs names too: not made ahead, its settings in a change of its own queued behind the move.
  await client.linkHostedService(db.id, { consumer: { service: serviceId } }, { idempotencyKey: "link-db" });
  assert.deepEqual(namesFrom(refreshesOf("release").at(-1).target, "DB_"), []);
  assert.deepEqual(refreshesOf("settings").map((one) => [one.state, namesFrom(one.target, "DB_").length > 0]), [["queued", false], ["queued", true]]);
  // CACHE, which only the release ahead names: made ahead, its settings in that refresh and every change queued behind it.
  const { link: cacheLink } = await client.linkHostedService(cache.id, { consumer: { service: serviceId } }, { idempotencyKey: "link-cache" });
  assert.ok([refreshesOf("release").at(-1), ...refreshesOf("settings")].every((one) => namesFrom(one.target, "CACHE_").length > 0));
  // A replace now is checked against the release it runs, which doesn't declare the cache's settings: refused until the move ends.
  const late = await refused(client.putServiceSettings(serviceId, { settings: { mode: "web-3" }, secrets: { sessionKey: "session-1" } }, { idempotencyKey: "settings-2" }));
  assert.deepEqual([late.status, late.code], [422, "validation_failed"]);
  assert.deepEqual(Object.keys(late.details.fieldErrors).map((key) => key.replace(/^(settings|secrets)\./u, "")).sort(), [...cacheLink.settings].sort());
  assert.ok(Object.values(late.details.fieldErrors).every((words) => words === "The app declares no such setting."));

  // The move fails: the cache's link ends, as a deleted consumer's would, and leaves the changes queued; DB's stands.
  standIn.faults.instancesUnhealthy = true;
  for (let step = 0; step < 20 && refreshesOf("release").at(-1).state !== "failed"; step += 1) standIn.advance();
  standIn.faults.instancesUnhealthy = false;
  assert.equal(refreshesOf("release").at(-1).id, next.refresh.id);
  assert.equal(refreshesOf("release").at(-1).state, "failed");
  const linkOf = (hosted) => standIn.hosted.service(hosted.id).links.find((one) => one.consumer.id === serviceId);
  assert.ok(["revoking", "revoked"].includes(linkOf(cache).state));
  assert.ok(["issuing", "active"].includes(linkOf(db).state));
  assert.ok(refreshesOf("settings").every((one) => namesFrom(one.target, "CACHE_").length === 0));
  settle(standIn);
  // The changes queued behind ran on the release it runs: the replace and DB's settings, none of the cache's.
  const served = standIn.services.service(serviceId);
  assert.deepEqual([served.version, served.settings.mode, namesFrom(served, "CACHE_"), namesFrom(served, "DB_").length > 0], [release.version, "web-2", [], true]);
});

test("a count change places or drains instances at once, and a new size is a refresh", async () => {
  const { standIn, client, serviceId } = await runningShop();
  const raised = await client.changeService(serviceId, { instances: 3 });
  assert.deepEqual([raised.refresh, raised.service.instances.wanted], [null, 3]);
  settle(standIn);
  assert.deepEqual((await client.readService(serviceId)).instances, { wanted: 3, running: 3, inRotation: 3, healthy: 3 });
  await client.changeService(serviceId, { instances: 1 });
  settle(standIn);
  assert.equal((await client.listServiceInstances(serviceId)).length, 1);
  const resized = await client.changeService(serviceId, { size: "a-4" });
  assert.deepEqual([resized.refresh.kind, resized.refresh.state], ["size", "queued"]);
  settle(standIn);
  assert.deepEqual((await client.listServiceInstances(serviceId)).map((one) => one.size), ["a-4"]);
  standIn.faults.noCapacity = true;
  const full = await refused(client.changeService(serviceId, { instances: 4 }));
  assert.deepEqual([full.status, full.code], [409, "no_capacity"]);
  assert.equal((await client.readService(serviceId)).instances.wanted, 1, "the count stays as it was");
});

test("a release whose build fails, or whose new instances never get healthy, leaves the old version serving; a later one rolls back", async () => {
  const { standIn, client, release: first, serviceId } = await runningShop();
  standIn.faults.releaseBuildFails = true;
  const broken = await client.createServiceRelease(serviceId, upload(SHOP, "2"));
  assert.deepEqual([broken.refresh.kind, broken.refresh.fromVersion, broken.build.state], ["release", first.version, "queued"]);
  settle(standIn);
  const failed = await client.readServiceRefresh(serviceId, broken.refresh.id);
  assert.deepEqual([failed.state, failed.error.code, failed.steps.map((step) => step.step)], ["failed", "app_build_failed", ["build_started", "build_failed"]]);
  let service = await client.readService(serviceId);
  assert.deepEqual([service.state, service.version, service.lastError.code], ["running", first.version, "app_build_failed"]);
  assert.ok(standIn.events().some((event) => event.type === "service.refresh_failed" && event.details.refreshId === broken.refresh.id));
  standIn.faults.releaseBuildFails = false;

  standIn.faults.instancesUnhealthy = true;
  const unhealthy = await client.createServiceRelease(serviceId, upload(SHOP, "3"));
  settle(standIn);
  assert.equal((await client.readServiceRefresh(serviceId, unhealthy.refresh.id)).error.code, "instance_never_healthy");
  service = await client.readService(serviceId);
  assert.deepEqual([service.version, service.instances], [first.version, { wanted: 2, running: 2, inRotation: 2, healthy: 2 }], "the old version kept serving");
  standIn.faults.instancesUnhealthy = false;

  const fixed = await client.createServiceRelease(serviceId, upload(SHOP, "4"));
  settle(standIn);
  service = await client.readService(serviceId);
  assert.deepEqual([service.version, service.previousVersion, service.lastError], [fixed.release.version, first.version, null]);
  assert.deepEqual((await client.listServiceInstances(serviceId)).map((one) => one.version), [fixed.release.version, fixed.release.version]);
  assert.equal((await client.listServiceInstances(serviceId, { removed: true })).length, 5, "removed instances listed for their 7 days");
  const back = await client.rollBackService(serviceId);
  assert.deepEqual([back.refresh.kind, back.refresh.toVersion], ["rollback", first.version]);
  settle(standIn);
  assert.equal((await client.readService(serviceId)).version, first.version);
  const fresh = await runningShop();
  const none = await refused(fresh.client.rollBackService(fresh.serviceId));
  assert.deepEqual([none.status, none.code], [409, "no_previous_version"]);
});

test("a release by version brings settings, secrets and names to remove: its instances start with them, the service takes them once it succeeded, and one that fails keeps the service's as they were", async () => {
  const { standIn, client, production, projectId, serviceId } = await runningShop();
  // Version 2 requires `region`, which the service lacks.
  const declaration = { ...SHOP, settings: { ...SHOP.settings, region: { type: "string", required: true } } };
  const { release: second } = await production.createRelease("shop", upload(declaration, "2"));
  const missing = await refused(client.releaseServiceVersion(serviceId, { version: second.version, settings: { greeting: "Hello" } }));
  assert.deepEqual([missing.status, missing.code, missing.details.settings], [422, "settings_missing", ["region"]]);
  // A name only a link sets, given or removed; a name both given and removed; a version the project lacks.
  assert.deepEqual(refusal(await refused(client.releaseServiceVersion(serviceId, { version: second.version, remove: ["DB_HOST"] }))),
    { status: 422, code: "validation_failed", fields: ["DB_HOST"] });
  assert.deepEqual(refusal(await refused(client.releaseServiceVersion(serviceId, { version: second.version, settings: { region: "eu", greeting: "Hi" }, remove: ["greeting"] }))),
    { status: 422, code: "validation_failed", fields: ["remove.greeting"] });
  assert.equal((await refused(client.releaseServiceVersion(serviceId, { version: "999" }))).status, 404);
  // Settings are services:manage's: a key that deploys alone hands a release, but not one that brings settings.
  const deployOnly = createMobilynetClient({ baseUrl: standIn.baseUrl, credential: standIn.addKey({ projectId, scopes: ["services:read", "services:deploy"] }), fetch: standIn.fetch });
  const scoped = await refused(deployOnly.releaseServiceVersion(serviceId, { version: second.version, secrets: { sessionKey: "session-2" } }));
  assert.deepEqual([scoped.status, scoped.code, scoped.details], [403, "scope_missing", { scope: "services:manage" }]);
  assert.equal(standIn.services.refreshes(serviceId).length, 1, "nothing refused was queued");

  const asked = { version: second.version, settings: { region: "eu", greeting: "Hello" }, secrets: { sessionKey: "session-2" } };
  const handed = await client.releaseServiceVersion(serviceId, asked, { idempotencyKey: "release-2" });
  assert.deepEqual([handed.release.version, handed.refresh.kind, handed.refresh.toVersion], [second.version, "release", second.version]);
  assert.equal(JSON.stringify(handed).includes("session-2"), false, "no secret in the answer");
  assert.equal((await client.releaseServiceVersion(serviceId, asked, { idempotencyKey: "release-2" })).refresh.id, handed.refresh.id, "the same key answers again");
  const reused = await refused(client.releaseServiceVersion(serviceId, { ...asked, secrets: { sessionKey: "session-9" } }, { idempotencyKey: "release-2" }));
  assert.deepEqual([reused.status, reused.code], [409, "idempotency_key_reused"]);
  assert.equal(standIn.services.service(serviceId).secrets.sessionKey, "session-1", "the service keeps its own while the refresh runs");
  settle(standIn);
  const held = standIn.services.service(serviceId);
  assert.deepEqual([held.version, held.settings.mode, held.settings.region, held.settings.greeting, held.secrets.sessionKey], [second.version, "web", "eu", "Hello", "session-2"]);
  const serving = standIn.services.instances(serviceId).filter((one) => !one.removedReason);
  assert.ok(serving.length === 2 && serving.every((one) => one.version === second.version && one.settings.greeting === "Hello" && one.secrets.sessionKey === "session-2"));

  // A release that fails, removing `greeting` and bringing a new key: its instances started without and with them, and
  // the service keeps both as they were.
  const { release: third } = await production.createRelease("shop", upload(declaration, "3"));
  standIn.faults.instancesUnhealthy = true;
  const failing = await client.releaseServiceVersion(serviceId, { version: third.version, secrets: { sessionKey: "session-3" }, remove: ["greeting"] });
  settle(standIn);
  standIn.faults.instancesUnhealthy = false;
  assert.equal((await client.readServiceRefresh(serviceId, failing.refresh.id)).state, "failed");
  const tried = standIn.services.instances(serviceId).filter((one) => one.version === third.version);
  assert.ok(tried.length > 0 && tried.every((one) => one.secrets.sessionKey === "session-3" && !Object.hasOwn(one.settings, "greeting")), "its instances started with them");
  const kept = standIn.services.service(serviceId);
  assert.deepEqual([kept.version, kept.settings.greeting, kept.secrets.sessionKey], [second.version, "Hello", "session-2"], "the service's settings as they were");
  assert.ok(standIn.services.instances(serviceId).filter((one) => !one.removedReason).every((one) => one.version === second.version && one.secrets.sessionKey === "session-2"));

  // Handed again, it succeeds: `greeting` gone, the new key taken.
  await client.releaseServiceVersion(serviceId, { version: third.version, secrets: { sessionKey: "session-3" }, remove: ["greeting"] });
  settle(standIn);
  const now = standIn.services.service(serviceId);
  assert.deepEqual([now.version, Object.hasOwn(now.settings, "greeting"), now.settings.region, now.secrets.sessionKey], [third.version, false, "eu", "session-3"]);
});

test("deletes: a linked hosted service stays until its links go with it, and a deleted service's instances go while its route is kept", async () => {
  const { standIn, client, production, serviceId } = await runningShop();
  const { hostedService: db, links: [dbLink] } = await production.createHostedService({ app: "postgresql-18", links: [{ consumer: { service: serviceId } }] }, { idempotencyKey: "hosted-db" });
  settle(standIn);
  const linked = await refused(client.deleteHostedService(db.id));
  assert.deepEqual([linked.status, linked.code, linked.details], [409, "hosted_service_linked", { hostedServiceId: db.id, links: 1 }]);
  assert.equal((await client.deleteHostedService(db.id, { revokeLinks: true })).hostedService.state, "deleted");
  assert.equal(await client.readHostedService(db.id), null);
  settle(standIn);
  assert.deepEqual(Object.keys(standIn.services.service(serviceId).settings), ["mode"], "its link's settings taken out");
  assert.deepEqual(standIn.hosted.all().find((one) => one.id === db.id).links.map((link) => [link.id, link.state]), [[dbLink.id, "revoked"]]);
  assert.deepEqual(await client.deleteHostedService(db.id), { removed: true }, "one mobilynet no longer has is removed");

  const { hostedService: files } = await production.createHostedService({ app: "garage-2" }, { idempotencyKey: "hosted-files" });
  assert.deepEqual(files.connection, { endpoint: `http://${files.name}.${files.projectId.replace("_", "-")}.internal:3900`, region: "us", bucket: "files" });
  const [route] = (await client.readService(serviceId)).routes;
  assert.equal((await client.deleteService(serviceId)).service.state, "deleting");
  settle(standIn);
  assert.equal(await client.readService(serviceId), null);
  const kept = standIn.routes().find((one) => one.id === route.id);
  assert.deepEqual({ serviceId: kept.serviceId, target: kept.target, live: kept.live, waitingFor: kept.waitingFor }, { serviceId: null, target: route.target, live: false, waitingFor: "target" },
    "its route is kept, sending to nothing, its name the same");
  assert.ok(standIn.services.instances(serviceId).every((one) => one.rotation === "gone"), "its instances go");
  assert.deepEqual(await client.deleteService(serviceId), { removed: true });
  assert.deepEqual(await production.listServices(), []);
});

let routesCalls = 0;
/** A call of the stand-in's routes API with its key and a key of its own, answered as `{ status, body }`. */
async function routesCall(standIn, method, suffix = "", body = undefined) {
  routesCalls += 1;
  const response = await standIn.fetch(`${standIn.baseUrl}/v1/projects/${standIn.projectId}/routes${suffix}`, {
    method,
    headers: { authorization: `Bearer ${standIn.key}`, "content-type": "application/json", "idempotency-key": `routes-${routesCalls}` },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

test("a route outlives its App Service: kept sending to nothing, taken with its name by the next service asking for it; a name another service holds is refused naming its route unless take moves it; the routes API moves or deletes any route", async () => {
  const { standIn, client, production, release, serviceId } = await runningShop();
  const [first] = (await client.readService(serviceId)).routes;
  const asking = await refused(production.createService(webSpec(release.version, { name: "site" }), { idempotencyKey: "service-site" }));
  assert.deepEqual([asking.status, asking.code, asking.details], [409, "name_taken", { host: HOST, routeId: first.id }]);
  // Made with no route, a service takes the name once healthy with `take`: the same route and name, now sending to it.
  const site = (await production.createService(webSpec(release.version, { name: "site", routes: [] }), { idempotencyKey: "service-site-2" })).service;
  settle(standIn);
  const took = await client.changeService(site.id, { routes: [{ host: HOST, tls: "edge", take: true }] });
  assert.deepEqual(took.service.routes.map((one) => [one.id, one.host, one.target, one.live]), [[first.id, HOST, first.target, true]]);
  assert.deepEqual((await client.readService(serviceId)).routes, [], "the service it was taken from no longer lists it");
  const badTake = await refused(client.changeService(site.id, { routes: [{ host: HOST, take: "yes" }] }));
  assert.deepEqual(refusal(badTake), { status: 422, code: "validation_failed", fields: ["routes.0.take"] });

  // A name a service no longer asks for keeps its route, sending to nothing; the next service asking for it takes it.
  await client.changeService(site.id, { routes: [] });
  let route = await production.readRoute(first.id);
  assert.deepEqual([route.serviceId, route.target, route.live, route.waitingFor, route.waitingWords],
    [null, first.target, false, "target", "Nothing to send it to: an App Service asking for its name takes it, or give it a machine, a group or an App Service"]);
  await client.changeService(serviceId, { routes: [{ host: HOST }] });
  route = await production.readRoute(first.id);
  assert.deepEqual([route.serviceId, route.target, route.live], [serviceId, first.target, true]);

  // Any route is moved to a public service of the project or deleted through the routes API; its id, host and name stay.
  const moved = await routesCall(standIn, "PATCH", `/${first.id}`, { serviceId: site.id });
  assert.deepEqual([moved.status, moved.body.id, moved.body.host, moved.body.serviceId, moved.body.target], [200, first.id, HOST, site.id, first.target]);
  assert.deepEqual((await client.readService(serviceId)).routes, []);
  const withPort = await routesCall(standIn, "PATCH", `/${first.id}`, { serviceId: serviceId, port: 8080 });
  assert.deepEqual([withPort.status, withPort.body.error.code, Object.keys(withPort.body.error.details.fieldErrors)], [422, "validation_failed", ["port"]]);
  const removed = await routesCall(standIn, "DELETE", `/${first.id}`);
  assert.deepEqual([removed.status, removed.body], [200, { removed: true }]);
  assert.equal(await production.readRoute(first.id), null);
  assert.deepEqual((await client.readService(site.id)).routes, []);
  const made = await routesCall(standIn, "POST", "", { host: HOST, serviceId: site.id });
  assert.deepEqual([made.status, made.body.host, made.body.serviceId, made.body.target, made.body.live],
    [201, HOST, site.id, `${made.body.id.replace("_", "-")}.routes.mobilynet.standin`, true]);
  const again = await routesCall(standIn, "POST", "", { host: HOST, serviceId: serviceId });
  assert.deepEqual([again.status, again.body.error.code, again.body.error.details], [409, "name_taken", { host: HOST, routeId: made.body.id }]);
  const toMachine = await routesCall(standIn, "POST", "", { host: `www.${HOST}`, vpsId: "vps_any", port: 3000 });
  assert.deepEqual([toMachine.status, Object.keys(toMachine.body.error.details.fieldErrors)], [422, ["vpsId"]], "the stand-in has no machines");
  const elsewhere = await routesCall(standIn, "PATCH", `/${made.body.id}`, { serviceId: "svc_unknown" });
  assert.deepEqual([elsewhere.status, Object.keys(elsewhere.body.error.details.fieldErrors)], [422, ["serviceId"]]);
});

test("the adapter's domainRecords names what the owner adds: mobilynet's TXT while the domain is unverified, and the CNAME to the route's own name while the route stands, Offline too", async () => {
  const { standIn, client, production, projectId } = world();
  const adapter = createMobilynetAdapter({ client, project: projectId });
  assert.deepEqual(await adapter.domainRecords(HOST), { domain: HOST, live: false, waitingFor: null, target: null, certificate: null, records: [] });
  await adapter.ensureDomain(HOST, { idempotencyKey: "domain-shop" });
  const [domain] = await production.listDomains();
  const txt = { name: `_mobilynet.${HOST}.`, type: "TXT", data: domain.records[0].value };
  assert.deepEqual(await adapter.domainRecords(HOST), { domain: HOST, live: false, waitingFor: "domain", target: null, certificate: null, records: [txt] });
  const { release } = await production.createRelease("shop", upload(SHOP, "1"));
  const created = await production.createService(webSpec(release.version), { idempotencyKey: "service-web" });
  const [route] = created.service.routes;
  const cname = { name: `${HOST}.`, type: "CNAME", data: `${route.target}.` };
  assert.deepEqual(await adapter.domainRecords(HOST), { domain: HOST, live: false, waitingFor: "domain", target: route.target, certificate: null, records: [txt, cname] });
  standIn.verifyDomain(HOST, projectId);
  settle(standIn);
  assert.deepEqual(await adapter.domainRecords(HOST), { domain: HOST, live: true, waitingFor: null, target: route.target, certificate: null, records: [cname] });
  await client.deleteService(created.service.id);
  settle(standIn);
  assert.deepEqual(await adapter.domainRecords(HOST), { domain: HOST, live: false, waitingFor: "target", target: route.target, certificate: null, records: [cname] },
    "Offline, the domain keeps its route and the same CNAME");
});

test("a route whose DNS target is not its own name (an older mobilynet's: its App Service's name) gives no target, so nothing says it stays", async () => {
  const route = { id: "rte_k7m2abcdef", host: HOST, target: "svc-nr4nhn642f3tnrxl.us.mobilynet.standin", live: true, waitingFor: null, certificate: { state: "issued" } };
  const calls = { listDomains: async () => [{ name: HOST, state: "verified", records: [] }], listRoutes: async () => [route] };
  const adapter = createMobilynetAdapter({ client: { project: () => calls }, project: "prj_any" });
  assert.deepEqual(await adapter.domainRecords(HOST), {
    domain: HOST, live: true, waitingFor: null, target: null, certificate: "issued", records: [{ name: `${HOST}.`, type: "CNAME", data: `${route.target}.` }]
  });
  route.target = "rte-k7m2abcdef.routes.mobilynet.standin";
  assert.equal((await adapter.domainRecords(HOST)).target, route.target);
});

test("prices list instances, the load balancer and the disk, and the catalogue prices each size", async () => {
  const { standIn, client } = world();
  const { inForce, sizes } = await client.readPrices();
  const row = (kind, size) => inForce.prices.find((price) => price.kind === kind && (size === undefined || price.size === size));
  assert.deepEqual(row("vps", "m-2"), { kind: "vps", size: "m-2", class: "shared", unit: "month", monthly: "20.00", monthlyNano: "20000000000", hourlyNano: "27397260", includedDiskGib: 40 });
  assert.deepEqual(row("instance", "a-4"), { kind: "instance", size: "a-4", unit: "month", monthly: "32.00", monthlyNano: "32000000000", hourlyNano: "43835616" });
  assert.deepEqual(row("disk"), { kind: "disk", unit: "GiB-month", monthly: "0.10", monthlyNano: "100000000", hourlyNano: "136986" });
  assert.deepEqual(row("load_balancer"), { kind: "load_balancer", unit: "month", monthly: "10.00", monthlyNano: "10000000000", hourlyNano: "13698630" });
  assert.deepEqual(sizes.filter((size) => size.kind === "instance").map((size) => [size.name, size.vcpus, size.memoryGib]), [["a-1", 1, 1], ["a-2", 2, 2], ["a-4", 4, 8], ["a-8", 8, 16]]);
  const keyless = await standIn.fetch(`${standIn.baseUrl}/v1/prices`);
  assert.equal(keyless.status, 200, "prices need no key");

  const catalogue = await client.readHostedCatalogue();
  assert.deepEqual(catalogue.items.map((item) => [item.app, item.interface.id, item.port]), [
    ["postgresql-18", "postgresql", 5432], ["mariadb-11-4", "mysql", 3306], ["valkey-9", "redis", 6379], ["garage-2", "s3", 3900]
  ]);
  const [postgresql, , , garage] = catalogue.items;
  assert.deepEqual(postgresql.sizes[0], { name: "small", size: "m-1", vcpus: 1, memoryGib: 2, dataDiskGib: 10, monthlyNano: "10000000000" });
  assert.deepEqual(postgresql.sizes.map((size) => size.monthlyNano), ["10000000000", "20000000000", "44000000000", "93000000000"]);
  assert.equal(garage.sizes[0].monthlyNano, "13000000000");
  assert.deepEqual(postgresql.settings, [{ name: "database", title: "Database name", type: "string", required: false, default: "app" }]);
  const regions = await client.listRegions();
  assert.deepEqual(regions.map((region) => [region.id, region.edge.addresses.length]), [["us", 2], ["eu", 0]]);
});

test("each region says how many settings and secrets an App Service there holds now, and the adapter counts against its own region's, 49 where mobilynet doesn't say", async () => {
  const { standIn, client, projectId } = world();
  const held = async () => (await client.listRegions()).map((region) => [region.id, region.serviceSettingsMax]);
  const adapter = createMobilynetAdapter({ client, project: projectId });
  // Every host runs agent 2.9.0 or later: 199, its links' among them. A region with no host holds the same.
  assert.deepEqual(await held(), [["us", 199], ["eu", 199]]);
  assert.equal(await adapter.serviceSettingsMax(), 199);
  assert.equal(standIn.requests().at(-1).path, "/v1/regions", "read from mobilynet each time it is asked");
  // A host of us runs an earlier agent, which takes 50 entries for an app: us holds 49, eu still 199.
  standIn.faults.olderHost = true;
  assert.deepEqual(await held(), [["us", 49], ["eu", 199]]);
  assert.equal(await adapter.serviceSettingsMax(), 49);
  assert.equal(await createMobilynetAdapter({ client, project: projectId, region: "eu" }).serviceSettingsMax(), 199);
  standIn.faults.olderHost = false;
  assert.equal(await adapter.serviceSettingsMax(), 199, "and 199 again once it is updated");
  // A mobilynet that doesn't say (before its regions list gave the figure), or lists no such region: 49, what a host
  // on an earlier agent holds.
  const listing = (items) => ({ project: () => ({}), listRegions: async () => items });
  const unsaid = createMobilynetAdapter({ client: listing([{ id: "us", name: "United States", state: "open", edge: { addresses: [] } }]), project: projectId });
  assert.equal(await unsaid.serviceSettingsMax(), 49);
  assert.equal(await createMobilynetAdapter({ client: listing([]), project: projectId }).serviceSettingsMax(), 49);
  for (const figure of [null, 0, -1, 1.5, "199"]) {
    const odd = createMobilynetAdapter({ client: listing([{ id: "us", serviceSettingsMax: figure }]), project: projectId });
    assert.equal(await odd.serviceSettingsMax(), 49, String(figure));
  }
});

test("tags: set at create, answered in reads and lists, a list filtered by them, replaced whole by a PATCH that starts no refresh", async () => {
  const { standIn, client, production, release, serviceId } = await runningShop();
  const mark = { "vibe64-deployment": "dep_one", "vibe64-app": "shop", "vibe64-environment": "production" };
  const computers = await production.createService(webSpec(release.version, {
    name: "computers", exposure: "internal", routes: [], instances: 1, tags: { ...mark, "vibe64-item": "service.computers" }
  }), { idempotencyKey: "service-computers" });
  assert.deepEqual(computers.service.tags, { ...mark, "vibe64-item": "service.computers" });
  assert.equal(Object.hasOwn(computers.service, "labels"), false, "an answer names tags alone");
  const { hostedService: db } = await production.createHostedService({ app: "postgresql-18", tags: { ...mark, "vibe64-item": "resource.database" } }, { idempotencyKey: "hosted-db" });
  await production.createHostedService({ app: "valkey-9", tags: { "vibe64-deployment": "dep_two" } }, { idempotencyKey: "hosted-cache" });
  assert.deepEqual(db.tags, { ...mark, "vibe64-item": "resource.database" });
  assert.equal(Object.hasOwn(db, "labels"), false, "an answer names tags alone");
  assert.deepEqual((await client.readService(serviceId)).tags, {}, "a service made without tags has none");

  assert.deepEqual((await production.listServices({ tags: { "vibe64-deployment": "dep_one" } })).map((one) => one.id), [computers.service.id]);
  assert.deepEqual((await production.listServices({ tags: { "vibe64-deployment": "dep_one", "vibe64-item": "service.web" } })), [], "each tag must match");
  assert.deepEqual((await production.listHostedServices({ tags: { "vibe64-deployment": "dep_one" } })).map((one) => one.id), [db.id]);
  assert.equal((await production.listHostedServices()).length, 2);
  assert.deepEqual(standIn.requests().filter((one) => one.method === "GET" && one.query.tag).map((one) => one.query.tag), [
    ["vibe64-deployment:dep_one"], ["vibe64-deployment:dep_one", "vibe64-item:service.web"], ["vibe64-deployment:dep_one"]
  ], "a list is filtered by tag=name:value");

  settle(standIn);
  const refreshes = (await client.listServiceRefreshes(serviceId)).length;
  const retagged = await client.changeService(serviceId, { tags: { ...mark, "vibe64-item": "service.web" } });
  assert.deepEqual([retagged.refresh, retagged.service.tags["vibe64-item"]], [null, "service.web"]);
  assert.equal((await client.listServiceRefreshes(serviceId)).length, refreshes, "a change of tags starts no refresh");
  const replaced = await client.changeService(serviceId, { tags: { "vibe64-deployment": "dep_one" } });
  assert.deepEqual(replaced.service.tags, { "vibe64-deployment": "dep_one" }, "the whole set replaced");
  const hostedTags = await client.changeHostedService(db.id, { tags: { ...mark, "vibe64-item": "resource.db" } });
  assert.deepEqual([hostedTags.operation, hostedTags.hostedService.tags["vibe64-item"], hostedTags.hostedService.state], [null, "resource.db", "running"]);
  await client.createServiceRelease(serviceId, upload(SHOP, "2"));
  settle(standIn);
  assert.deepEqual((await client.readService(serviceId)).tags, { "vibe64-deployment": "dep_one" }, "a release keeps them");
  assert.ok(standIn.events().some((event) => event.type === "service.changed" && event.details.fields[0] === "tags"));
  assert.ok(standIn.events().some((event) => event.type === "hosted.changed" && event.details.fields[0] === "tags"));

  const reserved = await refused(client.changeService(serviceId, { tags: { "mobilynet-service": "x" } }));
  assert.deepEqual(refusal(reserved), { status: 422, code: "validation_failed", fields: ["tags.mobilynet-service"] });
  assert.equal(reserved.details.fieldErrors["tags.mobilynet-service"], "Tags starting with mobilynet are MobilyNet's.");
  const control = await refused(client.changeHostedService(db.id, { tags: { note: "a\nb" } }));
  assert.deepEqual(refusal(control), { status: 422, code: "validation_failed", fields: ["tags.note"] });
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`k${index}`, "v"]));
  const tooMany = await refused(production.createHostedService({ app: "valkey-9", tags: many }, { idempotencyKey: "hosted-many" }));
  assert.deepEqual(refusal(tooMany), { status: 422, code: "validation_failed", fields: ["tags"] });
  assert.equal(tooMany.details.fieldErrors.tags, "At most 20 tags.");
  const upper = await refused(production.createService(webSpec(release.version, { name: "api", routes: [], tags: { Upper: "x" } }), { idempotencyKey: "service-api" }));
  assert.deepEqual(refusal(upper), { status: 422, code: "validation_failed", fields: ["tags.Upper"] });
  assert.equal((await client.readService(serviceId)).tags["vibe64-deployment"], "dep_one", "a refused change changes nothing");
});

test("labels, tags' previous name, is refused 422 under its own name in a body and a list's filter, never read as tags", async () => {
  const { standIn, client, production, projectId, release, serviceId } = await runningShop();
  settle(standIn);
  const made = await refused(production.createService(webSpec(release.version, { name: "api", routes: [], labels: { "vibe64-deployment": "dep_one" } }), { idempotencyKey: "service-api" }));
  assert.deepEqual(refusal(made), { status: 422, code: "validation_failed", fields: ["labels"] });
  assert.equal(made.details.fieldErrors.labels, "Give tags: labels is their previous name.");
  const hosted = await refused(production.createHostedService({ app: "valkey-9", labels: { "vibe64-deployment": "dep_one" } }, { idempotencyKey: "hosted-cache" }));
  assert.deepEqual(refusal(hosted), { status: 422, code: "validation_failed", fields: ["labels"] });
  const changed = await refused(client.changeService(serviceId, { labels: { "vibe64-deployment": "dep_one" } }));
  assert.deepEqual(refusal(changed), { status: 422, code: "validation_failed", fields: ["labels"] });
  const both = await refused(client.changeService(serviceId, { tags: { "vibe64-deployment": "dep_one" }, labels: { "vibe64-deployment": "dep_one" } }));
  assert.deepEqual(refusal(both), { status: 422, code: "validation_failed", fields: ["labels"] }, "naming both is refused too");
  assert.deepEqual((await client.readService(serviceId)).tags, {}, "a refused change changes nothing");
  assert.deepEqual((await production.listServices()).map((one) => one.name), ["web"], "a refused create makes nothing");
  assert.deepEqual(await production.listHostedServices(), []);

  for (const list of ["services", "hosted-services"]) {
    const answered = await standIn.fetch(`${standIn.baseUrl}/v1/projects/${projectId}/${list}?label=vibe64-deployment:dep_one`, { headers: { authorization: `Bearer ${standIn.key}` } });
    const { error } = await answered.json();
    assert.deepEqual([answered.status, error.code, error.details.fieldErrors], [422, "validation_failed", { label: "Filter by tag: label is its previous name." }], list);
  }
  // As mobilynet checks a key's scopes before what it sends: a key without the scope is refused 403 whatever its body.
  const reader = standIn.addKey({ projectId, scopes: ["services:read"] });
  const unscoped = await standIn.fetch(`${standIn.baseUrl}/v1/projects/${projectId}/services`, {
    method: "POST",
    headers: { authorization: `Bearer ${reader}`, "content-type": "application/json", "idempotency-key": "unscoped" },
    body: JSON.stringify({ name: "api", labels: { "vibe64-deployment": "dep_one" } })
  });
  assert.deepEqual([unscoped.status, (await unscoped.json()).error.code], [403, "scope_missing"]);
});

test("App Service instances times their size count against the project's vCPU and memory quotas beside its hosted services' machines", async () => {
  const { standIn, client, production, release, serviceId, projectId } = await runningShop();
  // web: 2 × a-2 = 4 vCPUs, 4 GiB.
  const big = await refused(production.createService(webSpec(release.version, { name: "computers", exposure: "internal", routes: [], size: "a-8", instances: 3 }), { idempotencyKey: "service-computers" }));
  assert.deepEqual([big.status, big.code, big.message, big.details, big.retryable], [429, "quota_exceeded", "The project has used its quota of vcpus (20).", { quota: "vcpus", limit: 20 }, false]);
  const computers = await production.createService(webSpec(release.version, { name: "computers", exposure: "internal", routes: [], size: "a-8", instances: 2 }), { idempotencyKey: "service-computers-2" });
  settle(standIn);
  // 4 + 16 = 20 vCPUs: a raise of web past it is refused, as is a larger size; a lower count is not.
  const raise = await refused(client.changeService(serviceId, { instances: 3 }));
  assert.deepEqual([raise.status, raise.details], [429, { quota: "vcpus", limit: 20 }]);
  const larger = await refused(client.changeService(serviceId, { size: "a-4" }));
  assert.deepEqual([larger.status, larger.details], [429, { quota: "vcpus", limit: 20 }]);
  assert.equal((await client.changeService(computers.service.id, { instances: 1 })).service.instances.wanted, 1);
  // 4 + 8 = 12 vCPUs, 4 + 16 = 20 GiB: a hosted service's machine counts too.
  standIn.setQuota(projectId, { memoryGib: 22 });
  await production.createHostedService({ app: "postgresql-18" }, { idempotencyKey: "hosted-db" });
  const memory = await refused(production.createHostedService({ app: "valkey-9" }, { idempotencyKey: "hosted-cache" }));
  assert.deepEqual([memory.status, memory.details], [429, { quota: "memoryGib", limit: 22 }]);
  standIn.setQuota(projectId, { memoryGib: 40, machines: 1 });
  const machines = await refused(production.createHostedService({ app: "valkey-9" }, { idempotencyKey: "hosted-cache-2" }));
  assert.deepEqual(machines.details, { quota: "machines", limit: 1 });
  standIn.setQuota(projectId, { machines: 10, diskGib: 15 });
  const [db] = await production.listHostedServices();
  settle(standIn);
  const disk = await refused(client.changeHostedService(db.id, { size: "medium" }));
  assert.deepEqual(disk.details, { quota: "diskGib", limit: 15 }, "a resize up asks for its larger disk");
  assert.deepEqual(await client.listServiceInstances(computers.service.id).then((all) => all.length), 1);
});

test("a project at its spending cap refuses new creates and scale-ups, while releases, scale-downs and deletes still work", async () => {
  const { standIn, client, production, release, serviceId, projectId } = await runningShop();
  const { hostedService: db } = await production.createHostedService({ app: "postgresql-18" }, { idempotencyKey: "hosted-db" });
  settle(standIn);
  assert.deepEqual(await production.readSpendingCap(), {
    projectId, capNano: null, month: "2026-11", spentNano: "0", state: "none", currency: "USD", meteredUntil: AT.toISOString(), changedAt: null
  });
  standIn.setSpendingCap(projectId, 50_000_000_000n);
  standIn.spend(projectId, 40_000_000_000n);
  const capped = await production.readSpendingCap();
  // mobilynet names when the cap last changed changedAt (its engine-support 092dbb87).
  assert.deepEqual([capped.state, capped.changedAt, "setAt" in capped], ["warning", AT.toISOString(), false]);
  assert.equal((await client.changeService(serviceId, { instances: 3 })).service.instances.wanted, 3, "under the cap a raise works");
  standIn.spend(projectId, 10_000_000_000n);
  assert.deepEqual((await production.readSpendingCap()).state, "reached");

  const reached = { projectId, capNano: "50000000000", spentNano: "50000000000", month: "2026-11", currency: "USD" };
  const create = await refused(production.createService(webSpec(release.version, { name: "api", routes: [] }), { idempotencyKey: "service-api" }));
  assert.deepEqual([create.status, create.code, create.details, create.retryable], [409, "spending_cap_reached", reached, false]);
  for (const ask of [
    () => client.changeService(serviceId, { instances: 4 }),
    () => client.changeService(serviceId, { size: "a-4" }),
    () => production.createHostedService({ app: "valkey-9" }, { idempotencyKey: "hosted-cache" }),
    () => client.changeHostedService(db.id, { size: "medium" })
  ]) {
    const error = await refused(ask());
    assert.deepEqual([error.code, error.details], ["spending_cap_reached", reached]);
  }
  assert.equal((await client.changeService(serviceId, { instances: 2 })).service.instances.wanted, 2, "a scale-down works");
  assert.equal((await client.changeService(serviceId, { size: "a-1" })).refresh.kind, "size", "a smaller size works");
  const next = await client.createServiceRelease(serviceId, upload(SHOP, "2"));
  settle(standIn);
  assert.equal((await client.readService(serviceId)).version, next.release.version, "a release works");
  assert.equal((await client.rollBackService(serviceId)).refresh.kind, "rollback");
  assert.equal((await client.deleteHostedService(db.id)).hostedService.state, "deleted", "a delete works");
  standIn.setSpendingCap(projectId, null);
  assert.equal((await production.createHostedService({ app: "valkey-9" }, { idempotencyKey: "hosted-cache-2" })).hostedService.state, "creating");
});

test("keys: a project's key reaches its project alone, a revoked or expired key is refused, a token source refreshes once, and each route needs its scope", async () => {
  const { standIn, client, projectId } = world();
  const other = standIn.addProject("Staging");
  const elsewhere = await refused(client.project(other).listServices());
  assert.deepEqual([elsewhere.status, elsewhere.code], [404, "not_found"]);
  const organisation = createMobilynetClient({ baseUrl: standIn.baseUrl, credential: standIn.addKey(), fetch: standIn.fetch });
  assert.deepEqual([await organisation.project(other).listServices(), await organisation.project(projectId).listServices()], [[], []]);

  let token = standIn.addKey({ projectId });
  const seen = [];
  const refreshing = createMobilynetClient({
    baseUrl: standIn.baseUrl,
    credential: { token: () => token, refresh: () => { token = standIn.addKey({ projectId }); } },
    fetch: standIn.fetch,
    onRequest: (entry) => seen.push([entry.status, entry.errorCode])
  });
  standIn.expireKey(token);
  assert.deepEqual(await refreshing.project(projectId).listServices(), []);
  assert.deepEqual(seen, [[401, "key_expired"], [200, null]], "refused once, refreshed, asked again");
  standIn.revokeKey(token);
  const revoked = await refused(refreshing.project(projectId).listServices());
  assert.deepEqual([revoked.status, revoked.code], [401, "key_revoked"], "a revoked key is not refreshed");
  const nobody = await refused(createMobilynetClient({ baseUrl: standIn.baseUrl, credential: "mnk_unknown", fetch: standIn.fetch }).project(projectId).listServices());
  assert.deepEqual([nobody.status, nobody.code], [401, "unauthenticated"]);

  const deployOnly = createMobilynetClient({ baseUrl: standIn.baseUrl, credential: standIn.addKey({ projectId, scopes: ["services:read", "services:deploy"] }), fetch: standIn.fetch });
  const retag = await refused(deployOnly.changeService("svc_any", { tags: {} }));
  assert.deepEqual([retag.status, retag.code, retag.details], [403, "scope_missing", { scope: "services:manage" }]);
  const cap = await refused(deployOnly.project(projectId).readSpendingCap());
  assert.deepEqual(cap.details, { scope: "usage:read" });
  const hosted = await refused(deployOnly.project(projectId).createHostedService({ app: "valkey-9" }, { idempotencyKey: "hosted" }));
  assert.deepEqual(hosted.details, { scope: "hosted:manage" });
  assert.equal((await deployOnly.readHostedCatalogue()).items.length, 4, "any key reads the catalogue");
});

test("leases: a second take is refused naming the holder, a renewal extends it, its expiry frees it, and another project's lease is its own", async () => {
  let clock = AT.getTime();
  const { standIn, client, projectId } = world({ now: () => new Date(clock) });
  const { lease } = await client.takeLease({ name: "deploy:dep_one", holder: "Vibe64 on my-workstation", seconds: 600 });
  assert.deepEqual(lease, { id: lease.id, name: "deploy:dep_one", holder: "Vibe64 on my-workstation", since: AT.toISOString(), expiresAt: new Date(clock + 600_000).toISOString() });
  const held = await refused(client.takeLease({ name: "deploy:dep_one", holder: "Vibe64 on laptop", seconds: 600 }));
  assert.deepEqual([held.status, held.code, held.details, held.retryable], [409, "lease_held", { name: "deploy:dep_one", holder: "Vibe64 on my-workstation", since: AT.toISOString(), expiresAt: lease.expiresAt }, false]);
  const long = await refused(client.takeLease({ name: "deploy:dep_two", holder: "x", seconds: 3601 }));
  assert.deepEqual(refusal(long), { status: 422, code: "validation_failed", fields: ["seconds"] });

  clock += 500_000;
  assert.equal((await client.renewLease(lease.id, { seconds: 600 })).lease.expiresAt, new Date(clock + 600_000).toISOString());
  clock += 599_000;
  await refused(client.takeLease({ name: "deploy:dep_one", holder: "Vibe64 on laptop", seconds: 600 }));
  const other = standIn.addProject("Staging");
  const otherClient = createMobilynetClient({ baseUrl: standIn.baseUrl, credential: standIn.addKey({ projectId: other }), fetch: standIn.fetch });
  const own = await otherClient.takeLease({ name: "deploy:dep_one", holder: "Vibe64 elsewhere", seconds: 60 });
  assert.equal(own.lease.holder, "Vibe64 elsewhere", "another project's lease of the same name is its own");
  assert.deepEqual(await otherClient.releaseLease(lease.id), { removed: true }, "and it can't see this one");
  assert.equal(standIn.leases().filter((one) => one.projectId === projectId).length, 1);

  clock += 2_000;
  const expired = await refused(client.renewLease(lease.id, { seconds: 600 }));
  assert.deepEqual([expired.status, expired.code], [404, "not_found"]);
  const taken = await client.takeLease({ name: "deploy:dep_one", holder: "Vibe64 on laptop", seconds: 600 });
  assert.equal(taken.lease.holder, "Vibe64 on laptop", "its expiry freed it");
  assert.deepEqual(await client.releaseLease(taken.lease.id), { removed: true });
  assert.equal(standIn.leases().filter((one) => one.projectId === projectId).length, 0);
});

test("every request is kept in order with what it asked of what, and a stand-in that is down answers nothing", async () => {
  const { standIn, client, production, serviceId } = await runningShop();
  const { hostedService } = await production.createHostedService({ app: "valkey-9", tags: { "vibe64-deployment": "dep_one" } }, { idempotencyKey: "hosted-cache" });
  await production.listHostedServices({ tags: { "vibe64-deployment": "dep_one", "vibe64-item": "resource.cache" } });
  const asked = standIn.requests();
  const create = asked.find((one) => one.method === "POST" && one.path.endsWith("/hosted-services"));
  assert.deepEqual(
    [create.idempotencyKey, create.body.tags, create.status, create.errorCode],
    ["hosted-cache", { "vibe64-deployment": "dep_one" }, 202, null]
  );
  assert.deepEqual(asked.at(-1).query.tag, ["vibe64-deployment:dep_one", "vibe64-item:resource.cache"]);
  const releaseUpload = asked.find((one) => one.path.endsWith("/apps/shop/releases"));
  assert.match(releaseUpload.body.upload, /^[0-9a-f]{64}$/u, "an upload is kept as its SHA-256");
  assert.equal(asked.some((one) => one.method === "DELETE"), false);
  settle(standIn);
  await client.deleteHostedService(hostedService.id);
  assert.deepEqual(standIn.requests().filter((one) => one.method === "DELETE").map((one) => one.path), [`/v1/hosted-services/${hostedService.id}`]);

  standIn.faults.down = true;
  const down = await refused(client.readService(serviceId));
  assert.deepEqual([down.status, down.code, down.retryable], [null, "unreachable", true]);
});

// mobilynet's page of an App Service's logs (its openApiServices.js readServiceLogs and machines' serviceLogs.js,
// mobilynet main 17340a6a): the keys of its answer and of each line.
const LOGS_KEYS = ["after", "before", "instances", "lines", "more", "operations", "readAt", "units"];
const LOG_LINE_KEYS = ["at", "error", "instance", "name", "text", "unit"];

test("a service's logs are a page of its instances' lines in time order, read by operations: 202 with them first, then 200 with the page, each secret masked, the instances chosen by only or except", async () => {
  const parts = await runningShop();
  const { standIn, client, serviceId } = parts;
  const [one, other] = standIn.services.instances(serviceId);
  standIn.services.setLogs(one.id, "listening on 3000\nsigned in with session-1\n");
  standIn.services.setLogs(other.id, "listening on 3000\nError: no database\n");

  const pending = await client.readServiceLogs(serviceId, { only: [one.name], lines: 50 });
  assert.deepEqual(Object.keys(pending).sort(), LOGS_KEYS);
  const { operations: running, ...waiting } = pending;
  assert.deepEqual(waiting, {
    instances: [{ id: one.id, name: one.name, live: true, removedAt: null, error: null }],
    units: ["web"], lines: null, before: null, after: null, more: false, readAt: null
  });
  assert.deepEqual(running.map((operation) => [operation.kind, operation.state]), [["app_logs", "running"]]);
  standIn.advance();
  const page = await client.readServiceLogs(serviceId, { only: [one.name], lines: 50 });
  assert.deepEqual(Object.keys(page).sort(), LOGS_KEYS);
  for (const line of page.lines) {
    assert.deepEqual(Object.keys(line).sort(), LOG_LINE_KEYS);
    assert.match(line.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u, "to the microsecond");
  }
  // The service's own secret (sessionKey's value) is masked as mobilynet masks it.
  assert.deepEqual(page.lines.map((line) => [line.instance, line.name, line.unit, line.text, line.error]), [
    [one.id, one.name, "web", "listening on 3000", false], [one.id, one.name, "web", "signed in with [secret]", false]
  ]);
  assert.deepEqual([page.before, typeof page.after, page.more, page.operations.map((operation) => operation.state)], [null, "string", false, ["succeeded"]]);
  assert.ok(Number.isFinite(Date.parse(page.readAt)));

  // Every instance's lines merged in time order, a line reading as an error marked; `text` keeps the lines holding it,
  // `except` leaves an instance out, `lines` keeps the newest; each new ask is read again.
  const ask = async (asked) => {
    await client.readServiceLogs(serviceId, asked);
    standIn.advance();
    return client.readServiceLogs(serviceId, asked);
  };
  const all = await ask({});
  assert.deepEqual(all.instances.map((instance) => instance.id).sort(), [one.id, other.id].sort());
  assert.deepEqual(all.lines.map((line) => [line.name, line.text, line.error]).sort(), [
    [one.name, "listening on 3000", false], [one.name, "signed in with [secret]", false], [other.name, "Error: no database", true], [other.name, "listening on 3000", false]
  ].sort());
  assert.ok(all.lines.every((line, index) => index === 0 || all.lines[index - 1].at <= line.at), "in time order");
  assert.deepEqual((await ask({ text: "DATABASE" })).lines.map((line) => line.text), ["Error: no database"]);
  assert.deepEqual((await ask({ except: [one.id] })).instances.map((instance) => instance.id), [other.id]);
  const newest = await ask({ lines: 1 });
  assert.deepEqual([newest.lines.length, newest.lines[0].at, typeof newest.before], [1, all.lines.at(-1).at, "string"]);
  // The page before it holds the lines older than it.
  assert.deepEqual((await ask({ before: newest.before, lines: 1000 })).lines, all.lines.slice(0, -1));

  // An instance it has no logs of, a page size past its limits, a unit the app doesn't declare and two cursors are refused.
  assert.deepEqual(refusal(await refused(client.readServiceLogs(serviceId, { only: ["web-none"] }))), { status: 422, code: "validation_failed", fields: ["only"] });
  assert.deepEqual(refusal(await refused(client.readServiceLogs(serviceId, { except: ["vps_none"] }))), { status: 422, code: "validation_failed", fields: ["except"] });
  assert.deepEqual(refusal(await refused(client.readServiceLogs(serviceId, { lines: 1001 }))), { status: 422, code: "validation_failed", fields: ["lines"] });
  assert.deepEqual(refusal(await refused(client.readServiceLogs(serviceId, { unit: "worker" }))), { status: 422, code: "validation_failed", fields: ["unit"] });
  assert.deepEqual(refusal(await refused(client.readServiceLogs(serviceId, { before: newest.before, after: page.after }))), { status: 422, code: "validation_failed", fields: ["after"] });
  // It needs services:read.
  const blind = standIn.addKey({ projectId: parts.projectId, scopes: ["hosted:read"] });
  const outsider = createMobilynetClient({ baseUrl: standIn.baseUrl, credential: blind, fetch: standIn.fetch });
  assert.equal((await refused(outsider.readServiceLogs(serviceId))).code, "scope_missing");
});

test("a release task runs once, after its build passed and before any instance, on an instance of its own that no list shows, whose logs hold its output", async () => {
  const parts = await runningShop();
  const { standIn, client, production, serviceId } = parts;
  // mobilynet takes a task as { command } alone, at most 10, a name as TASK_NAME, a command as start's.
  const tasked = (tasks) => upload({ ...SHOP, tasks }, JSON.stringify(tasks));
  for (const [tasks, field] of [
    [{ migrate: { command: "bin/migrate", user: "shop" } }, "declaration.tasks.migrate"],
    [{ migrate: { command: "bin/migrate", timeoutSeconds: 900 } }, "declaration.tasks.migrate"],
    [{ migrate: { command: "bash -c 'npm run migrate'" } }, "declaration.tasks.migrate"],
    [{ Migrate: { command: "bin/migrate" } }, "declaration.tasks.Migrate"],
    [Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`task-${index}`, { command: "bin/migrate" }])), "declaration.tasks"]
  ]) {
    assert.deepEqual(refusal(await refused(production.createRelease("shop", tasked(tasks)))), { status: 422, code: "validation_failed", fields: [field] }, JSON.stringify(tasks));
  }
  // A malformed task's name is refused as it is asked; one the release doesn't declare fails the refresh once it built.
  const declared = tasked({ migrate: { command: "bin/migrate --all" } });
  assert.deepEqual(refusal(await refused(client.createServiceRelease(serviceId, declared, { task: "Migrate" }))), { status: 422, code: "validation_failed", fields: ["task"] });
  const undeclared = await client.createServiceRelease(serviceId, declared, { task: "seed" });
  assert.equal(undeclared.refresh.task, "seed");
  settle(standIn);
  const [notDeclared] = standIn.services.refreshes(serviceId).slice(-1);
  assert.deepEqual([notDeclared.state, notDeclared.error.code, notDeclared.steps.at(-1).step], ["failed", "release_task_not_declared", "task_failed"]);

  // Asked, it runs before any instance starts, on an instance of its own: task_started names it, task_succeeded follows.
  const asked = await client.createServiceRelease(serviceId, upload({ ...SHOP, tasks: { migrate: { command: "bin/migrate" } } }, "migrating"), { task: "migrate" });
  const refreshId = asked.refresh.id;
  let refresh = await client.readServiceRefresh(serviceId, refreshId);
  for (let step = 0; step < 4 && !refresh.steps.some((one) => one.step === "task_started"); step += 1) {
    standIn.advance();
    refresh = await client.readServiceRefresh(serviceId, refreshId);
  }
  assert.deepEqual([refresh.task, refresh.held, refresh.state], ["migrate", false, "building"]);
  const started = refresh.steps.find((one) => one.step === "task_started");
  assert.equal(started.detail, "migrate");
  assert.equal((await client.listServiceInstances(serviceId)).some((one) => one.id === started.instanceId), false, "its instance is no instance of the service");
  standIn.advance();
  refresh = await client.readServiceRefresh(serviceId, refreshId);
  const names = refresh.steps.map((one) => one.step);
  assert.ok(names.indexOf("task_succeeded") > names.indexOf("task_started") && !names.slice(0, names.indexOf("task_succeeded")).includes("instance_started"),
    names.join(" "));
  assert.equal(refresh.steps.find((one) => one.step === "task_succeeded").instanceId, started.instanceId);
  settle(standIn);
  assert.equal((await client.readServiceRefresh(serviceId, refreshId)).state, "succeeded");
  // Deleted once it ran, it is listed with the removed instances, and its output is its logs, as the start's.
  const removed = await client.listServiceInstances(serviceId, { removed: true });
  assert.equal(removed.find((one) => one.id === started.instanceId)?.rotation, "gone");
  const read = async () => {
    await client.readServiceLogs(serviceId, { only: [started.instanceId] });
    standIn.advance();
    return client.readServiceLogs(serviceId, { only: [started.instanceId] });
  };
  const logs = await read();
  assert.deepEqual([logs.instances[0].live, logs.lines.map((line) => line.unit)], [false, ["start"]]);

  // A task that fails fails its refresh with nothing rolled out, naming its outcome and where its output is.
  const before = (await client.readService(serviceId)).version;
  standIn.faults.releaseTaskFails = { outcome: "failed", output: ["Running 20261123_add_column", "error: column \"x\" already exists"] };
  const failing = await client.createServiceRelease(serviceId, upload({ ...SHOP, tasks: { migrate: { command: "bin/migrate" } } }, "failing"), { task: "migrate" });
  settle(standIn);
  standIn.faults.releaseTaskFails = false;
  const failed = await client.readServiceRefresh(serviceId, failing.refresh.id);
  const instanceId = failed.steps.find((one) => one.step === "task_started").instanceId;
  assert.deepEqual([failed.state, failed.error], ["failed", {
    code: "release_task_failed",
    message: `The release task migrate exited with an error; nothing rolled out. Its output: GET /v1/services/${serviceId}/logs?only=${instanceId}.`,
    details: { task: "migrate", instanceId, outcome: "failed" }
  }]);
  assert.deepEqual([failed.steps.at(-1).step, failed.steps.at(-1).instanceId, failed.steps.some((one) => one.step === "instance_started")], ["task_failed", undefined, false]);
  assert.equal((await client.readService(serviceId)).version, before, "the version before serves");
  await client.readServiceLogs(serviceId, { only: [instanceId] });
  standIn.advance();
  const output = await client.readServiceLogs(serviceId, { only: [instanceId] });
  assert.deepEqual(output.lines.map((line) => [line.unit, line.text, line.error]), [
    ["start", "Running 20261123_add_column", false], ["start", "error: column \"x\" already exists", true]
  ]);
});

test("a build's log is read from a byte on, as mobilynet answers it, with vps:read or packages:publish, and names a failed build's reason", async () => {
  const { standIn, client, production, projectId } = world();
  const { release } = await production.createRelease("shop", upload(SHOP, "1"));
  const [{ buildId }] = standIn.releases(projectId, "shop");
  // The engine's scopes hold neither: mobilynet's buildReader refuses them.
  assert.deepEqual(refusal(await refused(client.readBuildLog(buildId))), { status: 403, code: "scope_missing", fields: [] });
  const reader = createMobilynetClient({ baseUrl: standIn.baseUrl, fetch: standIn.fetch, credential: standIn.addKey({ projectId, scopes: ["packages:publish"] }) });
  const first = await reader.readBuildLog(buildId);
  assert.deepEqual([first.state, first.done, first.text], ["building", false, `Building shop ${release.version}: running its build command\n`]);
  standIn.faults.releaseBuildFails = { code: "output_too_large", message: "The output is 4440 MiB; it may be at most 4096 MiB." };
  standIn.advance();
  const rest = await reader.readBuildLog(buildId, { after: first.next });
  assert.deepEqual(rest, { text: "The output is 4440 MiB; it may be at most 4096 MiB.\n", next: first.next + rest.text.length, state: "failed", done: true });
  assert.deepEqual(refusal(await refused(reader.readBuildLog("bld_nope"))), { status: 404, code: "not_found", fields: [] });
});

test("a hosted service's backups are read with hosted:read as mobilynet answers them, and the adapter names its point-in-time window and its disk backups", async () => {
  const { standIn, client, production, projectId } = world();
  const { hostedService } = await production.createHostedService({ app: "postgresql-18" }, { idempotencyKey: "hosted-db" });
  const fresh = await client.readHostedBackups(hostedService.id);
  assert.deepEqual(fresh.apps, [{ app: "postgresql-18", lastLog: null, lastLogAt: null, failure: null, restorable: null }]);
  assert.deepEqual([fresh.enabled, fresh.disk.server, fresh.disk.everyHours, fresh.disk.backups], [true, "making", 24, []]);
  const adapter = createMobilynetAdapter({ client, project: projectId });
  assert.deepEqual(await adapter.backupsOf(hostedService.id), {
    enabled: true, pointInTime: null, failure: null, disk: { made: true, everyHours: 24, failure: null, backups: [] }
  }, "before its first base backup nothing is restorable");
  standIn.hosted.setBackups(hostedService.id, {
    apps: [{
      app: "postgresql-18", lastLog: "000000010000000000000007", lastLogAt: "2026-11-19T00:20:00.000Z", failure: null,
      restorable: { from: "2026-11-12T00:21:00.000Z", to: null }
    }],
    disk: {
      enabled: true, available: true, server: "making", everyHours: 24, failure: { code: "store_failed", message: "The store did not answer.", at: "2026-11-19T00:00:00.000Z" },
      held: null, newest: null, storedBytes: 9, backups: [
        { label: "d2", at: "2026-11-18T03:00:00.000Z", chain: "c1", diskBytes: 10, dataBytes: 4, storedBytes: 1, restorableUntil: "2026-12-18T03:00:00.000Z" },
        { label: "d1", at: "2026-11-17T03:00:00.000Z", chain: "c1", diskBytes: 10, dataBytes: 4, storedBytes: 8, restorableUntil: "2026-12-17T03:00:00.000Z" }
      ]
    }
  });
  assert.deepEqual(await adapter.backupsOf(hostedService.id), {
    enabled: true,
    pointInTime: { from: "2026-11-12T00:21:00.000Z", to: null, latest: "2026-11-19T00:20:00.000Z" },
    failure: null,
    disk: {
      made: true, everyHours: 24, failure: "The store did not answer.",
      backups: [{ at: "2026-11-18T03:00:00.000Z", restorableUntil: "2026-12-18T03:00:00.000Z" }, { at: "2026-11-17T03:00:00.000Z", restorableUntil: "2026-12-17T03:00:00.000Z" }]
    }
  });
  assert.equal(standIn.requests().at(-1).path, `/v1/hosted-services/${hostedService.id}/backups`);
  // It needs hosted:read; another project's hosted service is not found.
  const blind = createMobilynetClient({ baseUrl: standIn.baseUrl, fetch: standIn.fetch, credential: standIn.addKey({ projectId, scopes: ["services:read"] }) });
  assert.equal((await refused(blind.readHostedBackups(hostedService.id))).code, "scope_missing");
  assert.deepEqual(refusal(await refused(client.readHostedBackups("hsv_none"))), { status: 404, code: "not_found", fields: [] });
});

test("a build that waits says why in mobilynet's words and ends at once when ended; a refresh aborted keeps the version before, and one asked onto that release again builds it again", async () => {
  const { standIn, client, release: first, serviceId, projectId } = await runningShop();
  const words = "No build server it may run on holds its base ubuntu-26.04-20261123.1 yet; a new base reaches them within minutes.";
  standIn.faults.buildsWait = { for: "base", words, latestAt: "2026-11-20T09:30:00.000Z", startsBy: "2026-11-20T09:10:00.000Z" };
  const asked = await client.createServiceRelease(serviceId, upload(SHOP, "2"));
  settle(standIn, 3);
  // The refresh building, its build still queued behind the wait, said in mobilynet's words with its times.
  const building = await client.readServiceRefresh(serviceId, asked.refresh.id);
  assert.deepEqual([building.state, building.steps.map((step) => step.step)], ["building", ["build_started"]]);
  const queued = await client.readBuild(building.buildId);
  assert.deepEqual([queued.id, queued.state, queued.waiting, queued.estimate.startsBy, queued.startedAt],
    [building.buildId, "queued", { for: "base", words, ahead: null, latestAt: "2026-11-20T09:30:00.000Z" }, "2026-11-20T09:10:00.000Z", null]);
  assert.equal(await client.readBuild("bld_nope"), null);
  // A build is read with services:read; ending one takes services:deploy.
  const reader = createMobilynetClient({ baseUrl: standIn.baseUrl, fetch: standIn.fetch, credential: standIn.addKey({ projectId, scopes: ["services:read"] }) });
  assert.equal((await reader.readBuild(building.buildId)).state, "queued");
  assert.deepEqual(refusal(await refused(reader.endBuild(building.buildId))), { status: 403, code: "scope_missing", fields: [] });
  assert.deepEqual(refusal(await refused(reader.abortServiceRefresh(serviceId, asked.refresh.id))), { status: 403, code: "scope_missing", fields: [] });

  // Aborted while it builds: aborting until mobilynet's next step, then aborted, the service on the version it ran.
  assert.equal((await client.abortServiceRefresh(serviceId, asked.refresh.id)).state, "aborting");
  assert.deepEqual(refusal(await refused(client.abortServiceRefresh(serviceId, asked.refresh.id))), { status: 409, code: "refresh_not_running", fields: [] });
  const { build: ended } = await client.endBuild(building.buildId);
  assert.deepEqual([ended.state, ended.error.code, ended.waiting], ["failed", "cancelled", null]);
  assert.deepEqual(refusal(await refused(client.endBuild(building.buildId))), { status: 409, code: "invalid_state", fields: [] });
  standIn.advance();
  const aborted = await client.readServiceRefresh(serviceId, asked.refresh.id);
  assert.deepEqual([aborted.state, aborted.error, aborted.steps.at(-1).step], ["aborted", null, "aborted"]);
  let service = await client.readService(serviceId);
  assert.deepEqual([service.state, service.version, service.lastError], ["running", first.version, null]);
  assert.ok(standIn.events().some((event) => event.type === "service.refresh_aborted" && event.details.refreshId === asked.refresh.id));

  // The same release asked for again, nothing holding builds now: a new build, which runs and passes.
  standIn.faults.buildsWait = false;
  const again = await client.createServiceRelease(serviceId, upload(SHOP, "2"));
  assert.equal(again.release.version, asked.release.version);
  settle(standIn);
  const moved = await client.readServiceRefresh(serviceId, again.refresh.id);
  assert.equal(moved.state, "succeeded");
  assert.notEqual(moved.buildId, building.buildId);
  assert.equal((await client.readBuild(moved.buildId)).state, "succeeded");
  service = await client.readService(serviceId);
  assert.equal(service.version, asked.release.version);

  // A queued refresh aborts at once.
  standIn.faults.buildsWait = true;
  const third = await client.createServiceRelease(serviceId, upload(SHOP, "3"));
  const queuedAbort = await client.abortServiceRefresh(serviceId, third.refresh.id);
  assert.equal(queuedAbort.state, "aborted");
});

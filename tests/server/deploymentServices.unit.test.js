import assert from "node:assert/strict";
import test from "node:test";

import { runAgentSpecCli } from "../../server/lib/agentSpecCli.js";
import {
  DEPLOYMENT_HEADING_FORMS,
  DEPLOYMENT_RESOURCE_ENTRY_FORMS,
  DEPLOYMENT_SERVICE_ENTRY_FORMS,
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
  parseVibe64DeploymentLines,
  vibe64DeploymentInspection
} from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { stackOperationHash } from "../../packages/vibe64-genesis/src/server/stackOperation.js";
import { MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES, MEMOBOT_SERVICES } from "../fixtures/deploymentServices.js";

// A Deployment may describe several services under `### Service` headings and say how development provides a bucket
// under `### Resource`; a Deployment without them is one public service, `web`, as before.
const READY = "- Ready when: `GET` `/api/health` returns `200`";
const PLAIN = Object.freeze([
  "- Runtimes: `nodejs`",
  "- Recreate on restore: `node_modules`",
  "- Generated secrets: `SESSION_SECRET`",
  "- Instances: up to `4`",
  "- Sandbox allows: `gvisor`",
  READY,
  "- Prepare `Install`: `npm` `ci`",
  "- Build `Build`: `npm` `run` `build`",
  "- Migrate `Migrate`: `npm` `run` `db:migrate`",
  "- Serve `Start`: `npm` `start`"
]);

function inspect(lines, resources = MEMOBOT_RESOURCES) {
  return vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources },
    section: { status: "ready", stackHash: "sha256:stack", lines, components: [], source: "project" }
  });
}

/** Refused with VIBE64_DEPLOYMENT_INVALID at that line of the section, saying what the pattern matches. */
function refused(run, line, pattern) {
  assert.throws(run, (error) => {
    assert.equal(error?.code, "VIBE64_DEPLOYMENT_INVALID", error?.message);
    assert.equal(error.details?.line, line, error.message);
    assert.match(error.message, pattern);
    return true;
  });
}

/** The two-service section with one line replaced (or removed with null), or more added after another. */
function memobotWith(changes) {
  const lines = [...MEMOBOT_DEPLOYMENT_LINES];
  for (const [index, replacement] of Object.entries(changes).sort(([a], [b]) => Number(b) - Number(a))) {
    lines.splice(Number(index) - 1, 1, ...(replacement === null ? [] : [replacement].flat()));
  }
  return lines;
}

test("a Deployment with services parses each one, its own lines under its heading, and the resources' development", () => {
  const parsed = parseVibe64DeploymentLines(MEMOBOT_DEPLOYMENT_LINES);
  assert.deepEqual(parsed.services, MEMOBOT_SERVICES);
  assert.deepEqual(parsed.deploymentResources, { files: { development: "local folder" } });
  // The shared lines stay the whole Deployment's: one build serves every service.
  assert.deepEqual(parsed.runtimeRequirements, ["nodejs"]);
  assert.deepEqual(parsed.generatedSecrets, ["AUTH_LOCAL_SESSION_SECRET", "MEMOBOT_VAULT_KEY", "AUTH_LOCAL_SECOND_FACTOR_KEY",
    "MEMOBOT_FILES_PASSPHRASE", "MEMOBOT_COMPUTERS_SECRET"]);
  assert.equal(parsed.setupCode, "AUTH_LOCAL_SETUP_CODE");
  assert.equal(parsed.packages.length, 82);
  assert.deepEqual(parsed.packages.slice(-3), ["nix-ld", "gcc-unwrapped^lib", "dpkg"]);
  // A reader of one service sees the public one after the shared steps, and the allowances of all.
  assert.deepEqual(parsed.steps.map(({ role, label }) => [role, label]), [
    ["prepare", "Fetch public Memobot at the lock, install dependencies and tools, then compose from it"],
    ["build", "Build"],
    ["migrate", "Migrate database"],
    ["serve", "Start"]
  ]);
  assert.deepEqual(parsed.readiness, { kind: "http", method: "GET", path: "/api/health", status: 200 });
  assert.deepEqual(parsed.instances, { max: 6 });
  assert.deepEqual(parsed.sandboxAllowances, ["gvisor"]);

  const inspection = inspect(MEMOBOT_DEPLOYMENT_LINES);
  assert.equal(inspection.contract, "vibe64.application-deployment.v2");
  assert.equal(inspection.contract, VIBE64_APPLICATION_DEPLOYMENT_CONTRACT);
  assert.equal(inspection.status, "ready");
  assert.deepEqual(inspection.services, MEMOBOT_SERVICES);
  assert.deepEqual(inspection.deploymentResources, { files: { development: "local folder" } });
  // Genesis's resources stay as they were.
  assert.deepEqual(inspection.resources, MEMOBOT_RESOURCES);
  // The services are part of the recipe's identity.
  const fewer = inspect(memobotWith({ 30: "- Production: `3` instances" }));
  assert.notEqual(fewer.recipeHash, inspection.recipeHash);
});

test("a Deployment without services is one public service, web, and otherwise reads and hashes exactly as before", () => {
  const parsed = parseVibe64DeploymentLines(PLAIN);
  assert.deepEqual(parsed.services, [{
    id: "web",
    summary: "",
    exposure: "public",
    reached: "any",
    serve: { label: "Start", argv: ["npm", "start"] },
    readyWhen: { method: "GET", path: "/api/health", status: 200 },
    instances: { min: 1, max: 4, production: 1 },
    atLeast: null,
    reaches: [],
    settings: {},
    packages: [],
    sandboxAllowances: ["gvisor"]
  }]);
  assert.deepEqual(parsed.deploymentResources, {});
  const v1Fields = ["version", "artifact", "workdir", "runtimeRequirements", "generatedSecrets", "setupCode", "sandboxAllowances",
    "packages", "instances", "readiness", "steps"];
  assert.deepEqual(Object.keys(parsed), [...v1Fields, "services", "deploymentResources"]);
  const inspection = inspect(PLAIN, []);
  // The recipe's identity is v1's: the same fields, hashed the same way.
  assert.equal(inspection.recipeHash, stackOperationHash(Object.fromEntries(v1Fields.map((field) => [field, parsed[field]]))));
  assert.deepEqual(inspection.services, parsed.services);
  // An empty Deployment has no service.
  assert.deepEqual(parseVibe64DeploymentLines(["- Nothing."]).services, []);
  // A bucket's development line also works without services, and joins the recipe's identity.
  const resources = [{ component: "jskit", resource: { id: "files", kind: "bucket", environmentAlternatives: [] } }];
  const local = inspect([...PLAIN, "", "### Resource `files`", "", "- Development: `local folder`"], resources);
  assert.deepEqual(local.deploymentResources, { files: { development: "local folder" } });
  assert.deepEqual(local.services, parsed.services);
  assert.notEqual(local.recipeHash, inspect(PLAIN, resources).recipeHash);
});

test("each wrong service or resource line is refused at its line, saying what is wrong and the form", () => {
  const parse = (lines) => () => parseVibe64DeploymentLines(lines);
  // Ids and headings.
  refused(parse(memobotWith({ 11: "### Service `Web`: pages" })), 11, /lowercase letter, then up to 15/u);
  refused(parse(memobotWith({ 22: "### Service `web`: again" })), 22, /declares service `web` twice/u);
  refused(parse(memobotWith({ 22: "### Worker `x`: x" })), 22, /Unknown Deployment heading.*### Service `id`: summary/u);
  const nine = Array.from({ length: 9 }, (_, at) => [
    `### Service \`s${at}\`: s${at}`, `- Exposure: \`${at === 0 ? "public" : "internal"}\``, "- Serve `Start`: `npm` `start`",
    READY, "- Instances: `1` to `1`"
  ]).flat();
  refused(parse(["- Prepare `Install`: `npm` `ci`", ...nine]), 42, /at most 8 services/u);
  // Exposure: exactly one public.
  refused(parse(memobotWith({ 13: "- Exposure: `internal`" })), 11, /exactly one public service/u);
  refused(parse(memobotWith({ 24: "- Exposure: `public`", 25: null })), 22, /exactly one public service; `web` and `computers` are both public/u);
  refused(parse(memobotWith({ 13: "- Exposure: `private`" })), 13, /Exposure is `public` or `internal`/u);
  // Required lines.
  refused(parse(memobotWith({ 14: null })), 11, /Service `web`: it needs a Serve line/u);
  refused(parse(memobotWith({ 16: null })), 11, /it needs an Instances line/u);
  // Instances, Needs at least, Production.
  refused(parse(memobotWith({ 16: "- Instances: `6` to `1`" })), 16, /the least first/u);
  refused(parse(memobotWith({ 16: "- Instances: `1` to `101`" })), 16, /from 1 to 100/u);
  refused(parse(memobotWith({ 16: "- Instances: up to `6`" })), 16, /Instances is a range/u);
  refused(parse(memobotWith({ 17: "- Needs at least: `0.5` vCPU, `2` GiB memory" })), 17, /whole numbers of vCPUs and GiB/u);
  refused(parse(memobotWith({ 18: "- Production: `7` instances" })), 18, /Production starts with 7 instances, outside its Instances, 1 to 6/u);
  // Reached: internal only.
  refused(parse(memobotWith({ 13: ["- Exposure: `public`", "- Reached: `each instance`"] })), 14, /Reached is for an internal service/u);
  refused(parse(memobotWith({ 25: "- Reached: `all`" })), 25, /`any instance` or `each instance`/u);
  // Reaches: a known other service, a setting name of its own.
  refused(parse(memobotWith({ 19: "- Reaches: `computer` as `MEMOBOT_COMPUTERS_URL`" })), 19,
    /there is no service `computer`; this Deployment's services are `web`, `computers`/u);
  refused(parse(memobotWith({ 19: "- Reaches: `web` as `SELF_URL`" })), 19, /doesn't reach itself/u);
  refused(parse(memobotWith({ 19: "- Reaches: `computers` as `PORT`" })), 19, /PORT is a setting the host gives every service itself/u);
  refused(parse(memobotWith({ 19: "- Reaches: `computers` as `V64_COMPUTERS`" })), 19, /starts with V64_/u);
  refused(parse(memobotWith({ 19: "- Reaches: `computers` as `MEMOBOT_COMPUTERS_SECRET`" })), 19, /Deployment's generated secret/u);
  refused(parse(memobotWith({ 31: ["- Setting `X`: `1`", "- Setting `X`: `2`"] })), 32, /names the setting X twice/u);
  refused(parse(memobotWith({ 31: "- Setting `APP_PUBLIC_URL`: `x`" })), 31, /APP_PUBLIC_URL is a setting the host gives/u);
  refused(parse(memobotWith({ 31: "- Setting `lower`: `x`" })), 31, /isn't a setting's name/u);
  // Sandbox allowances from the closed set; shared lines stay above the headings; service lines below them.
  refused(parse(memobotWith({ 20: "- Sandbox allows: `docker`" })), 20, /Sandbox allows takes only `fuse` and `gvisor`/u);
  refused(parse(memobotWith({ 2: ["- Runtimes: `nodejs`", "- Instances: up to `4`"] })), 3, /move `- Instances: up to `4`` under its `### Service` heading/u);
  refused(parse(memobotWith({ 2: ["- Runtimes: `nodejs`", READY] })), 3, /each service says its own Serve, Ready when/u);
  refused(parse(memobotWith({ 2: ["- Runtimes: `nodejs`", "- Sandbox allows: `gvisor`"] })), 3, /under its `### Service` heading/u);
  refused(parse(memobotWith({ 2: ["- Runtimes: `nodejs`", "- Serve `Start`: `npm` `start`"] })), 3, /under its `### Service` heading/u);
  refused(parse(memobotWith({ 31: "- Build `Build`: `npm` `run` `build`" })), 31, /Build is the whole Deployment's/u);
  refused(parse(memobotWith({ 31: "- Runtimes: `nodejs`" })), 31, /Runtimes is the whole Deployment's/u);
  refused(parse(memobotWith({ 31: "- Restart: `always`" })), 31, /Unknown Service `computers` entry.*- Exposure: `public` or `internal`/u);
  refused(parse(memobotWith({ 37: "- Production: `local folder`" })), 37, /Unknown Resource `files` entry/u);
  refused(parse(memobotWith({ 37: "- Development: `shared bucket`" })), 37, /`local folder` or `own bucket`/u);
  refused(parse([...MEMOBOT_DEPLOYMENT_LINES, "### Resource `files`"]), 38, /second ### Resource `files`/u);
});

test("what needs ## Resources is checked by the inspection, at its line", () => {
  // A ### Resource names a declared resource, and Development is a bucket's.
  refused(() => inspect(memobotWith({ 35: "### Resource `uploads`" })), 35, /## Resources declares no resource `uploads`; its resources are `database`, `files`/u);
  refused(() => inspect([...memobotWith({ 35: "### Resource `database`" })]), 37, /`database` is a postgresql resource/u);
  // No service's Reaches or Setting takes a name a resource binds.
  refused(() => inspect(memobotWith({ 19: "- Reaches: `computers` as `DB_HOST`" })), 19, /DB_HOST is the setting resource `database` binds/u);
  refused(() => inspect(memobotWith({ 31: "- Setting `MEMOBOT_FILES_BUCKET`: `x`" })), 31, /MEMOBOT_FILES_BUCKET is the setting resource `files` binds/u);
});

test("the Deployment spec an assistant reads gives every service and resource form, so it can write services", async () => {
  const out = [];
  assert.equal(await runAgentSpecCli(["deployment"], { write: (text) => out.push(text), writeError: () => {} }), 0);
  const spec = out.join("\n");
  for (const form of [...DEPLOYMENT_HEADING_FORMS, ...DEPLOYMENT_SERVICE_ENTRY_FORMS, ...DEPLOYMENT_RESOURCE_ENTRY_FORMS]) {
    assert.ok(spec.includes(form), form);
  }
  assert.match(spec, /Without such headings the Deployment is one public service, `web`/u);
});

test("a host reading releases it recorded before services takes the v1 contract's name from the Genesis boundary", async () => {
  const boundary = await import("../../packages/vibe64-genesis/src/server/index.js");
  assert.equal(boundary.VIBE64_APPLICATION_DEPLOYMENT_CONTRACT, "vibe64.application-deployment.v2");
  assert.equal(boundary.VIBE64_APPLICATION_DEPLOYMENT_V1_CONTRACT, "vibe64.application-deployment.v1");
});

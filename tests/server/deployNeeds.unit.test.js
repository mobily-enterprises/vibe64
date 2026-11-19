import assert from "node:assert/strict";
import test from "node:test";

import { vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { boundSettings, needsProblem, productionAppName } from "../../packages/vibe64-deploy/src/needs.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES } from "../fixtures/deploymentServices.js";

// Production's needs from a Stack's Deployment section and resources, as the editor reads them before it plans: only
// from genesis/stack.md, never guessed from the app's files.
const RESOURCE_RULES = Object.freeze({ preferredAlternative, resourceKindIsDatabase });

// The Stack's resources as Genesis inspects them: a MySQL database and a bucket, each with its preferred bindings.
const RESOURCES = [
  {
    component: "jskit-mysql",
    resource: {
      id: "database",
      kind: "mysql",
      environmentAlternatives: [{
        preferred: true,
        bindings: { host: "DB_HOST", port: "DB_PORT", database: "DB_NAME", username: "DB_USER", password: "DB_PASSWORD", url: "DATABASE_URL" }
      }]
    }
  },
  {
    component: "jskit",
    resource: {
      id: "uploads",
      kind: "bucket",
      environmentAlternatives: [{
        preferred: true,
        bindings: {
          bucket: "STORAGE_BUCKET", region: "STORAGE_REGION", endpoint: "STORAGE_ENDPOINT",
          accessKeyId: "STORAGE_KEY_ID", secretAccessKey: "STORAGE_SECRET", driver: "STORAGE_DRIVER"
        }
      }]
    }
  }
];

/** A Deployment section as public Vibe64 inspects it, with these resources. */
function inspected(lines, resources) {
  return vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources },
    section: { status: "ready", stackHash: "sha256:stack", lines, components: [], source: "project" }
  });
}

/**
 * A JSKIT app's Deployment section as public Vibe64 inspects it: the starter's steps, its runtime and health path, the
 * instances it allows and its resources.
 * @param {object} [overrides]
 */
function jskitDeployment(overrides = {}) {
  return {
    ...inspected([
      "- Runtimes: `nodejs`",
      "- Generated secrets: `AUTH_LOCAL_SESSION_SECRET` `APP_SIGNING_KEY`",
      "- Setup code: `AUTH_LOCAL_SETUP_CODE`",
      "- Instances: up to `3`",
      "- Ready when: `GET` `/api/health` returns `200`",
      "- Prepare `Install dependencies`: `npm` `ci` `--include=dev`",
      "- Build `Build`: `npm` `run` `build`",
      "- Migrate `Migrate database`: `npm` `run` `db:migrate`",
      "- Serve `Start`: `npm` `start`"
    ], RESOURCES),
    ...overrides
  };
}

// A Deployment without services is one public service, web, that may run up to its Instances.
const WEB = Object.freeze({
  id: "web", exposure: "public", reached: "any", instances: { min: 1, max: 3, start: 1 }, atLeast: null, reaches: [], settings: {}, sandbox: []
});

test("the needs are the Deployment's services, generated secrets and setup code, and each resource's bindings", () => {
  const { needs, problem } = needsOfStack(jskitDeployment(), RESOURCE_RULES);
  assert.equal(problem, null);
  assert.deepEqual(needs, {
    services: [WEB],
    resources: [
      { id: "database", kind: "mysql", bindings: RESOURCES[0].resource.environmentAlternatives[0].bindings },
      { id: "uploads", kind: "bucket", bindings: RESOURCES[1].resource.environmentAlternatives[0].bindings }
    ],
    supplied: [],
    generatedSecrets: ["AUTH_LOCAL_SESSION_SECRET", "APP_SIGNING_KEY"],
    setupCode: "AUTH_LOCAL_SETUP_CODE"
  });
  assert.equal(needsProblem(needs), "");
  assert.deepEqual([...boundSettings(needs)].sort(), [
    "DATABASE_URL", "DB_HOST", "DB_NAME", "DB_PASSWORD", "DB_PORT", "DB_USER",
    "STORAGE_BUCKET", "STORAGE_DRIVER", "STORAGE_ENDPOINT", "STORAGE_KEY_ID", "STORAGE_REGION", "STORAGE_SECRET"
  ]);
  // A resource Production does not make: its settings come from the Production Env.
  const own = needsOfStack(jskitDeployment({
    resources: [{ component: "stripe", resource: { id: "payments", kind: "stripe", environmentAlternatives: [{ preferred: true, bindings: { secretKey: "STRIPE_SECRET_KEY" } }] } }]
  }), { preferredAlternative: (resource) => resource.environmentAlternatives[0], resourceKindIsDatabase });
  assert.deepEqual(own.needs.supplied, [{ id: "payments", kind: "stripe", settings: ["STRIPE_SECRET_KEY"], allowEmpty: [] }]);
  // The app's name at the provider is the project's own, never a name guessed from its files.
  assert.equal(productionAppName("Books"), "books");
  assert.equal(productionAppName("2048_game"), "p-2048-game");
});

test("a Stack that doesn't say what Production needs is refused, naming the fix in genesis/stack.md", () => {
  const refused = (deployment, code, pattern) => {
    const { needs, problem } = needsOfStack(deployment, RESOURCE_RULES);
    assert.equal(needs, null);
    assert.equal(problem?.code, code, JSON.stringify(problem));
    assert.match(problem.message, pattern);
  };
  refused(null, "production_deployment_missing", /genesis\/stack\.md has no Deployment section.*Declare it in genesis\/stack\.md \(the coding agent can do this\)/u);
  refused({ ...jskitDeployment(), status: "unconfigured", steps: [] }, "production_deployment_missing", /has no Deployment section/u);
  refused({ ...jskitDeployment(), status: "blocked", diagnostics: [{ message: "Duplicate Deployment Instances." }] },
    "production_deployment_invalid", /Duplicate Deployment Instances\. Fix it in genesis\/stack\.md/u);
  refused(jskitDeployment({ resources: [{ component: "sqlite", resource: { id: "database", kind: "sqlite", environmentAlternatives: [{ preferred: true, bindings: { url: "DATABASE_URL" } }] } }] }),
    "production_resource_unsupported", /sqlite database.*Declare it as a mysql or postgresql resource in genesis\/stack\.md/u);
  refused(jskitDeployment({ resources: [{ component: "jskit", resource: { id: "cache", kind: "redis", environmentAlternatives: [{ bindings: { url: "REDIS_URL" } }] } }] }),
    "production_resource_invalid", /resource cache can't be used.*genesis\/stack\.md/u);
  // A generated secret that a resource binds is no need the app can have.
  refused(jskitDeployment({ generatedSecrets: ["DB_PASSWORD"] }), "production_needs_invalid", /needs\.generatedSecrets/u);
});

test("a Deployment with services gives each one's needs: exposure, instances, smallest machine, reaches, settings, sandbox", () => {
  const { needs, problem } = needsOfStack(inspected(MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES), RESOURCE_RULES);
  assert.equal(problem, null);
  assert.deepEqual(needs, {
    services: [
      {
        id: "web", exposure: "public", reached: "any",
        instances: { min: 1, max: 6, start: 2 }, atLeast: { vcpus: 2, memoryGib: 2 },
        reaches: [{ service: "computers", setting: "MEMOBOT_COMPUTERS_URL" }],
        settings: {}, sandbox: ["gvisor"]
      },
      {
        id: "computers", exposure: "internal", reached: "each",
        instances: { min: 1, max: 20, start: 2 }, atLeast: { vcpus: 8, memoryGib: 16 },
        reaches: [], settings: { MEMOBOT_COMPUTERS_AGENT: "1" }, sandbox: ["gvisor"]
      }
    ],
    resources: [
      { id: "database", kind: "postgresql", bindings: MEMOBOT_RESOURCES[0].resource.environmentAlternatives[0].bindings },
      { id: "files", kind: "bucket", bindings: MEMOBOT_RESOURCES[1].resource.environmentAlternatives[0].bindings }
    ],
    supplied: [],
    generatedSecrets: ["AUTH_LOCAL_SESSION_SECRET", "MEMOBOT_VAULT_KEY", "AUTH_LOCAL_SECOND_FACTOR_KEY", "MEMOBOT_FILES_PASSPHRASE",
      "MEMOBOT_COMPUTERS_SECRET"],
    setupCode: "AUTH_LOCAL_SETUP_CODE"
  });
  // A Deployment the grammar refused names its line in the section and the fix.
  const blocked = needsOfStack({ status: "blocked", diagnostics: [{ code: "VIBE64_DEPLOYMENT_INVALID", line: 19,
    message: "Service `web`: there is no service `computer`; this Deployment's services are `web`, `computers`." }] }, RESOURCE_RULES);
  assert.equal(blocked.problem.code, "production_deployment_invalid");
  assert.equal(blocked.problem.line, 19);
  assert.match(blocked.problem.message, /^genesis\/stack\.md's Deployment section can't be used \(line 19 of the section\): Service `web`: there is no service `computer`.* Fix it in genesis\/stack\.md/u);
});

test("needs whose services break a rule of the Stack are refused, naming the service and the rule", () => {
  const { needs } = needsOfStack(inspected(MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES), RESOURCE_RULES);
  const [web, computers] = needs.services;
  const withServices = (services) => needsProblem({ ...needs, services });
  assert.match(withServices([]), /needs\.services lists 1 to 8/u);
  assert.match(withServices(Array.from({ length: 9 }, (_, at) => ({ ...computers, id: `c${at}` }))), /lists 1 to 8/u);
  assert.match(withServices([web, { ...computers, id: "web" }]), /its own id/u);
  assert.match(withServices([web, { ...computers, id: "Computers" }]), /its own id/u);
  assert.match(withServices([web, { ...computers, exposure: "public", reached: "any" }]), /exactly one public service/u);
  assert.match(withServices([{ ...web, exposure: "internal" }, computers]), /exactly one public service/u);
  assert.match(withServices([{ ...web, reached: "each" }, computers]), /needs\.services web is reached at any instance, or at each instance when it is internal/u);
  for (const instances of [{ min: 0, max: 6, start: 1 }, { min: 3, max: 6, start: 2 }, { min: 1, max: 101, start: 2 }, { min: 1, max: 6, start: 7 }]) {
    assert.match(withServices([{ ...web, instances }, computers]), /needs\.services web runs 1 <= min <= start <= max <= 100 instances/u, JSON.stringify(instances));
  }
  assert.match(withServices([web, { ...computers, atLeast: { vcpus: 0.5, memoryGib: 16 } }]), /needs\.services computers needs at least whole positive/u);
  assert.equal(withServices([web, { ...computers, atLeast: null }]), "");
  assert.match(withServices([{ ...web, reaches: [{ service: "computer", setting: "X_URL" }] }, computers]), /needs\.services web reaches other services/u);
  assert.match(withServices([{ ...web, reaches: [{ service: "web", setting: "X_URL" }] }, computers]), /reaches other services/u);
  // A reached service's setting no resource binds, the host doesn't give, and no generated secret or other setting is.
  for (const setting of ["DB_HOST", "PORT", "V64_COMPUTERS", "MEMOBOT_VAULT_KEY", "AUTH_LOCAL_SETUP_CODE"]) {
    assert.match(withServices([{ ...web, reaches: [{ service: "computers", setting }] }, computers]), /reaches other services/u, setting);
  }
  assert.match(withServices([web, { ...computers, settings: { MEMOBOT_FILES_BUCKET: "x" } }]), /needs\.services computers settings are its own/u);
  // Nor one only a host's Staging is given.
  assert.match(withServices([web, { ...computers, settings: { STAGING_REACHES_REAL_PEOPLE: "true" } }]), /settings are its own/u);
  assert.match(withServices([{ ...web, reaches: [{ service: "computers", setting: "STAGING_REACHES_REAL_PEOPLE" }] }, computers]),
    /reaches other services/u);
  assert.match(withServices([web, { ...computers, settings: { APP_PUBLIC_URL: "x" } }]), /settings are its own/u);
  assert.match(withServices([{ ...web, settings: { MEMOBOT_COMPUTERS_URL: "x" } }, computers]), /settings are its own/u);
  assert.match(withServices([web, { ...computers, sandbox: ["docker"] }]), /needs\.services computers sandbox allows only fuse and gvisor/u);
  assert.match(withServices([web, { ...computers, size: "a-8" }]), /needs\.services computers has no field "size"/u);
  // needsOfStack refuses them with the fix in genesis/stack.md.
  const refused = needsOfStack({ ...inspected(MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES), services: [] }, RESOURCE_RULES);
  assert.equal(refused.problem.code, "production_needs_invalid");
  assert.match(refused.problem.message, /needs\.services lists 1 to 8\. Declare it in genesis\/stack\.md/u);
});

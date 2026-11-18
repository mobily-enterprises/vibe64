import assert from "node:assert/strict";
import test from "node:test";

import { VIBE64_APPLICATION_DEPLOYMENT_CONTRACT } from "../../packages/vibe64-genesis/src/server/index.js";
import { boundSettings, needsProblem, productionAppName } from "../../packages/vibe64-deploy/src/needs.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";

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

/**
 * A JSKIT app's Deployment section as Genesis inspects it: the starter's steps, its runtime and health path, the
 * instances it allows and its resources.
 * @param {object} [overrides]
 */
function jskitDeployment(overrides = {}) {
  return {
    contract: VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
    status: "ready",
    runtimeRequirements: ["nodejs"],
    readiness: { kind: "http", path: "/api/health", status: 200 },
    resources: RESOURCES,
    generatedSecrets: ["AUTH_LOCAL_SESSION_SECRET", "APP_SIGNING_KEY"],
    setupCode: "AUTH_LOCAL_SETUP_CODE",
    instances: { max: 3 },
    steps: [
      { role: "prepare", label: "Install dependencies", argv: ["npm", "ci", "--include=dev"] },
      { role: "build", label: "Build", argv: ["npm", "run", "build"] },
      { role: "migrate", label: "Migrate database", argv: ["npm", "run", "db:migrate"] },
      { role: "serve", label: "Start", argv: ["npm", "start"] }
    ],
    ...overrides
  };
}

test("the needs are the Deployment's instances, generated secrets and setup code, and each resource's bindings", () => {
  const { needs, problem } = needsOfStack(jskitDeployment(), RESOURCE_RULES);
  assert.equal(problem, null);
  assert.deepEqual(needs, {
    instances: { max: 3 },
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

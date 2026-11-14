import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createService } from "../../packages/vibe64-project/src/server/service.js";
import {
  bucketDeclarations,
  normalizeResourceEnvironment,
  resourceDeclarationDiagnostics,
  resourceRequiredInDevelopment
} from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { projectServiceCollaborators, sourceMetadata, sourcePath, withTemporaryRoot } from "./vibe64TestHelpers.js";

const CONTRACT = "vibe64.resource-environment.v2";

function redisResource(bindings = { url: "REALTIME_REDIS_URL" }, extra = {}) {
  return {
    component: "jskit",
    resource: { id: "redis", kind: "redis", environmentAlternatives: [{ bindings, preferred: true }], optionalBindings: {}, ...extra }
  };
}

const BUCKET_BINDINGS = Object.freeze({
  accessKeyId: "JSKIT_STORAGE_S3_ACCESS_KEY_ID",
  bucket: "JSKIT_STORAGE_S3_BUCKET",
  driver: "JSKIT_STORAGE_DRIVER",
  endpoint: "JSKIT_STORAGE_S3_ENDPOINT",
  region: "JSKIT_STORAGE_S3_REGION",
  secretAccessKey: "JSKIT_STORAGE_S3_SECRET_ACCESS_KEY"
});

function bucketResource(bindings = BUCKET_BINDINGS, extra = {}) {
  return {
    component: "jskit",
    resource: { id: "bucket", kind: "bucket", environmentAlternatives: [{ bindings, preferred: true, ...extra }], optionalBindings: {} }
  };
}

test("a redis resource binds exactly its url, and the refusal names what is wrong", () => {
  assert.deepEqual(resourceDeclarationDiagnostics([redisResource()]), []);
  const missing = resourceDeclarationDiagnostics([redisResource({ address: "REALTIME_REDIS_URL" })]);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].code, "vibe64_redis_resource_bindings_invalid");
  assert.match(missing[0].message, /The redis resource redis binds `url`/u);
  assert.match(missing[0].message, /It is missing `url`\./u);
  assert.match(missing[0].message, /It binds `address`, which a redis resource does not take\./u);
  const optional = resourceDeclarationDiagnostics([redisResource(undefined, { optionalBindings: { namespace: "REDIS_NAMESPACE" } })]);
  assert.match(optional[0].message, /A redis resource takes no optionalBindings\./u);
});

test("a bucket binds its five settings, may bind its driver, and is refused naming each missing setting", () => {
  assert.deepEqual(resourceDeclarationDiagnostics([bucketResource()]), []);
  const { driver: _driver, ...withoutDriver } = BUCKET_BINDINGS;
  assert.deepEqual(resourceDeclarationDiagnostics([bucketResource(withoutDriver)]), [], "driver is optional");
  const { region: _region, secretAccessKey: _secret, ...partial } = BUCKET_BINDINGS;
  const [refused] = resourceDeclarationDiagnostics([bucketResource({ ...partial, acl: "JSKIT_STORAGE_S3_ACL" })]);
  assert.equal(refused.code, "vibe64_bucket_resource_bindings_invalid");
  assert.match(refused.message, /binds `bucket`, `region`, `endpoint`, `accessKeyId`, `secretAccessKey` and may bind `driver`/u);
  assert.match(refused.message, /It is missing `region`, `secretAccessKey`\./u);
  assert.match(refused.message, /It binds `acl`, which a bucket resource does not take\./u);
  // Databases and other kinds keep their own rules.
  assert.deepEqual(resourceDeclarationDiagnostics([{ component: "x", resource: { id: "database", kind: "mysql",
    environmentAlternatives: [{ bindings: { url: "DATABASE_URL" }, preferred: true }] } }]), []);
});

test("a host serves a redis url to its declared name, and a bucket is never a host's to supply", () => {
  const redis = redisResource();
  const url = "redis://default:secret@127.0.0.1:16400";
  const contribution = normalizeResourceEnvironment([redis, bucketResource()], {
    contract: CONTRACT,
    resourceValues: [{ declaration: { component: "jskit", id: "redis", kind: "redis" }, values: { url } }]
  }, { requireDatabaseTool: false });
  assert.deepEqual(contribution.environment, { REALTIME_REDIS_URL: url }, "the bucket adds nothing of the host's");
  assert.equal(contribution.secretKeys.has("REALTIME_REDIS_URL"), true);
  assert.equal(contribution.sources.REALTIME_REDIS_URL, "vibe64-host:managed-resource:redis:redis");
  assert.throws(() => normalizeResourceEnvironment([redis], { contract: CONTRACT, resourceValues: [] }), {
    code: "vibe64_managed_resource_missing"
  });
  assert.throws(() => normalizeResourceEnvironment([bucketResource()], {
    contract: CONTRACT,
    resourceValues: [{ declaration: { component: "jskit", id: "bucket", kind: "bucket" }, values: { bucket: "theirs" } }]
  }), { code: "vibe64_resource_environment_person_supplied" });
  assert.throws(() => normalizeResourceEnvironment([redisResource({ url: "REALTIME_REDIS_URL", host: "REDIS_HOST" })], {
    contract: CONTRACT,
    resourceValues: [{ declaration: { component: "jskit", id: "redis", kind: "redis" }, values: { url } }]
  }), { code: "vibe64_redis_resource_bindings_invalid" });
});

test("a bucket's names come from its preferred alternative, with which may stay empty and which are secret", () => {
  const [bucket] = bucketDeclarations([bucketResource(BUCKET_BINDINGS, { allowEmpty: ["endpoint"] }), redisResource()]);
  assert.equal(bucket.driver, "JSKIT_STORAGE_DRIVER");
  assert.deepEqual(bucket.settings.map(({ name, optional, secret }) => [name, optional, secret]), [
    ["JSKIT_STORAGE_S3_BUCKET", false, false],
    ["JSKIT_STORAGE_S3_REGION", false, false],
    ["JSKIT_STORAGE_S3_ENDPOINT", true, false],
    ["JSKIT_STORAGE_S3_ACCESS_KEY_ID", false, false],
    ["JSKIT_STORAGE_S3_SECRET_ACCESS_KEY", false, true]
  ]);
  const { driver: _driver, ...withoutDriver } = BUCKET_BINDINGS;
  assert.equal(bucketDeclarations([bucketResource(withoutDriver)])[0].driver, "");
  assert.equal(resourceRequiredInDevelopment(bucketResource().resource), false);
  assert.equal(resourceRequiredInDevelopment(redisResource().resource), true);
});

test("development asks for no bucket settings and stays ready without them, while a redis url is still needed", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let resources = [bucketResource()];
    const service = createService({ ...projectServiceCollaborators(), logger: console, env: {},
      projectContext: createStudioProjectContext({ env: process.env, explicitTargetRoot: targetRoot, home: path.dirname(targetRoot) }),
      inspectEnvironment: () => ({ components: [], environmentDefaults: [], files: [], resources })
    });
    const runtime = await service.createRuntime();
    const sessionId = "bucket";
    await mkdir(path.join(sourcePath(targetRoot, sessionId), ".git", "info"), { recursive: true });
    await runtime.store.createSession({ sessionId, runtimeKind: "genesis", metadata: sourceMetadata(targetRoot, sessionId) });
    const session = await runtime.getSessionWithoutSource(sessionId);

    let status = await service.projectEnvironmentStatus({ sessionId, session });
    assert.equal(status.status, "ready");
    assert.deepEqual(status.resources, [{ configured: false, id: "bucket", kind: "bucket", required: false }]);
    const env = await service.readEnv({ environment: "dev", sessionId, session });
    assert.deepEqual(env.env.records.filter(({ key }) => key.startsWith("JSKIT_STORAGE_")), [],
      "Development lists no bucket rows to fill");

    resources = [bucketResource(), redisResource()];
    status = await service.projectEnvironmentStatus({ sessionId, session });
    assert.equal(status.status, "missing-configuration");
    const redisRow = (await service.readEnv({ environment: "dev", sessionId, session })).env.records
      .find(({ key }) => key === "REALTIME_REDIS_URL");
    assert.equal(redisRow?.valuePresent, false, "a person without a host supplies their own Redis");
    assert.deepEqual(redisRow?.requiredFor, ["server"]);
  });
});

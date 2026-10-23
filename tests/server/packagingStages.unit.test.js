import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUILD_ENVIRONMENT_PASSTHROUGH,
  publishTarget,
  runBuildStage,
  spawnCommand,
  withStageCredentials
} from "../../packages/vibe64-packaging/src/server/stages.js";

const PLAN_HASH = `sha256:${"c".repeat(64)}`;
const TOKEN = "npm_SECRETvalue0123456789";

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-stages-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  await mkdir(source, { recursive: true });
  return { root, source, store: path.join(root, "results") };
}

const exists = (file) => stat(file).then(() => true, () => false);

function buildInput({ source, store }, overrides = {}) {
  return {
    planHash: PLAN_HASH,
    packageId: "sdk",
    steps: [{
      label: "Pack",
      argv: [process.execPath, "-e", "require('fs').writeFileSync('sdk-1.0.0.tgz', 'tarball:' + process.env.BUILD_FLAVOUR)"],
      cwd: source
    }],
    outputs: [path.join(source, "sdk-1.0.0.tgz")],
    environment: [{ name: "BUILD_FLAVOUR", value: "release" }],
    resultStore: store,
    allowedRoots: [source],
    baseEnvironment: {
      PATH: process.env.PATH,
      HOME: "/home/person",
      LANG: "C.UTF-8",
      NPM_TOKEN: TOKEN,
      NODE_AUTH_TOKEN: TOKEN,
      GITHUB_TOKEN: TOKEN,
      GH_TOKEN: TOKEN,
      TWINE_PASSWORD: TOKEN,
      npm_config__authToken: TOKEN,
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      VIBE64_SESSION_SECRET: TOKEN
    },
    ...overrides
  };
}

test("Stage 1 runs with no credential in its environment or argv and snapshots checksummed artifacts", async (t) => {
  const paths = await workspace(t);
  const calls = [];
  const built = await runBuildStage(buildInput(paths), {
    runCommand: async (request) => {
      calls.push(request);
      return spawnCommand(request);
    }
  });
  assert.equal(calls.length, 1);
  const [{ env, args, command }] = calls;
  const allowed = new Set([
    ...BUILD_ENVIRONMENT_PASSTHROUGH, "HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
    "npm_config_userconfig", "npm_config_cache", "GIT_TERMINAL_PROMPT", "CI", "BUILD_FLAVOUR"
  ]);
  for (const name of Object.keys(env)) assert.ok(allowed.has(name), `unexpected build env ${name}`);
  assert.ok(![command, ...args, ...Object.values(env)].some((value) => value.includes(TOKEN)));
  assert.notEqual(env.HOME, "/home/person");
  assert.equal(env.SSH_AUTH_SOCK, undefined);
  assert.equal(await exists(env.HOME), false, "the throwaway build HOME is removed");

  assert.equal(built.reused, false);
  assert.equal(built.manifest.contract, "vibe64.publish-artifacts.v1");
  assert.deepEqual(built.manifest.files.map(({ path: file, size }) => [file, size]), [["sdk-1.0.0.tgz", "tarball:release".length]]);
  assert.match(built.manifest.files[0].sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(built.digest, /^sha256:[0-9a-f]{64}$/u);
  const stored = path.join(built.directory, "files", "sdk-1.0.0.tgz");
  assert.equal(await readFile(stored, "utf8"), "tarball:release");
  assert.equal((await stat(stored)).mode & 0o777, 0o444);
});

test("Stage 1 refuses credential-shaped build Environment and paths outside its roots", async (t) => {
  const paths = await workspace(t);
  const never = async () => assert.fail("no command may run");
  await assert.rejects(
    runBuildStage(buildInput(paths, { environment: [{ name: "NPM_TOKEN", value: "x" }] }), { runCommand: never }),
    (error) => error.code === "VIBE64_PUBLISH_CREDENTIAL_IN_BUILD"
  );
  await assert.rejects(
    runBuildStage(buildInput(paths, { outputs: [path.join(paths.root, "elsewhere.tgz")] }), { runCommand: never }),
    (error) => error.code === "VIBE64_PUBLISH_STAGE_INVALID"
  );
  await assert.rejects(
    runBuildStage(buildInput(paths), { runCommand: async () => ({ ok: false, exitCode: 1, stderr: "boom" }) }),
    (error) => error.code === "VIBE64_PUBLISH_BUILD_FAILED" && error.details.output === "boom"
  );
  assert.equal(await exists(path.join(paths.store, "c".repeat(64), "sdk")), false, "a failed build leaves no artifacts");
});

test("a completed build is reused; changed bytes are refused", async (t) => {
  const paths = await workspace(t);
  const first = await runBuildStage(buildInput(paths));
  const again = await runBuildStage(buildInput(paths), { runCommand: async () => assert.fail("must not rebuild") });
  assert.equal(again.reused, true);
  assert.equal(again.digest, first.digest);

  const stored = path.join(first.directory, "files", "sdk-1.0.0.tgz");
  await chmod(stored, 0o644);
  await writeFile(stored, "tampered");
  await assert.rejects(runBuildStage(buildInput(paths)), (error) => error.code === "VIBE64_PUBLISH_ARTIFACT_CHANGED");
});

test("Stage 2 credentials are private temp files or stdin, removed on success and on throw", async (t) => {
  const paths = await workspace(t);
  const specs = [
    { id: "npmrc", label: "npm token", delivery: "file" },
    { id: "keystore-password", label: "Key password", delivery: "stdin" }
  ];
  const obtained = [];
  const obtainCredential = async (spec) => {
    obtained.push(spec.id);
    return spec.id === "npmrc" ? `//registry.npmjs.org/:_authToken=${TOKEN}\n` : Buffer.from("hunter2");
  };
  let seen;
  const result = await withStageCredentials({ credentials: specs, obtainCredential, tempRoot: paths.root }, async (credentials) => {
    seen = credentials;
    assert.equal((await stat(path.dirname(credentials.files.npmrc))).mode & 0o777, 0o700);
    assert.equal((await stat(credentials.files.npmrc)).mode & 0o777, 0o600);
    assert.match(await readFile(credentials.files.npmrc, "utf8"), /_authToken=/u);
    assert.equal(credentials.stdin["keystore-password"].toString(), "hunter2");
    return "uploaded";
  });
  assert.equal(result, "uploaded");
  assert.deepEqual(obtained, ["npmrc", "keystore-password"]);
  assert.equal(await exists(path.dirname(seen.files.npmrc)), false);
  assert.ok(seen.stdin["keystore-password"].every((byte) => byte === 0), "stdin buffers are zeroed");

  let thrownDirectory;
  await assert.rejects(withStageCredentials({ credentials: specs, obtainCredential, tempRoot: paths.root }, async (credentials) => {
    thrownDirectory = path.dirname(credentials.files.npmrc);
    throw new Error("upload failed");
  }), /upload failed/u);
  assert.equal(await exists(thrownDirectory), false);

  await assert.rejects(
    withStageCredentials({ credentials: specs, tempRoot: paths.root }, async () => assert.fail("no credentials")),
    (error) => error.code === "VIBE64_PUBLISH_CREDENTIAL_MISSING"
  );
});

function fakeDestination({ published = null } = {}) {
  const state = { published, uploads: 0 };
  return {
    state,
    destination: {
      id: "npm",
      label: "npm",
      credentials: [{ id: "npmrc", label: "npm token", delivery: "file" }],
      async readBack() {
        return state.published ? { published: true, checksum: state.published, proof: { url: "https://registry.example/sdk/1.0.0" } } : { published: false };
      },
      async upload({ artifacts, credentials }) {
        assert.ok(credentials.files.npmrc);
        state.uploads += 1;
        state.published = artifacts.digest;
        return { ok: true };
      }
    }
  };
}

test("publishing is proven by read-back, idempotent for identical bytes, and refuses a different checksum", async (t) => {
  const paths = await workspace(t);
  const artifacts = await runBuildStage(buildInput(paths));
  const target = { id: "sdk-npm" };
  const obtainCredential = async () => "token-file";

  const { destination, state } = fakeDestination();
  const proven = await publishTarget({ destination, target, version: "1.0.0", artifacts, obtainCredential, tempRoot: paths.root });
  assert.equal(proven.status, "proven");
  assert.equal(proven.alreadyPublished, false);
  assert.equal(proven.checksum, artifacts.digest);
  assert.deepEqual(proven.proof, { url: "https://registry.example/sdk/1.0.0" });
  assert.equal(state.uploads, 1);

  // Resuming with the recorded result does nothing at all.
  const resumed = await publishTarget({ destination, target, version: "1.0.0", artifacts, previous: proven, obtainCredential: async () => assert.fail("no credential needed") });
  assert.equal(resumed, proven);

  // A fresh run against a registry that already has these exact bytes succeeds without uploading.
  const again = await publishTarget({ destination, target, version: "1.0.0", artifacts, obtainCredential: async () => assert.fail("no credential needed") });
  assert.equal(again.status, "proven");
  assert.equal(again.alreadyPublished, true);
  assert.equal(state.uploads, 1);

  const conflicting = fakeDestination({ published: `sha256:${"d".repeat(64)}` });
  await assert.rejects(
    publishTarget({ destination: conflicting.destination, target, version: "1.0.0", artifacts, obtainCredential }),
    (error) => error.code === "VIBE64_PUBLISH_VERSION_CONFLICT" && error.details.expected === artifacts.digest
  );
  assert.equal(conflicting.state.uploads, 0);

  const silent = fakeDestination();
  silent.destination.upload = async () => ({ ok: true });
  await assert.rejects(
    publishTarget({ destination: silent.destination, target, version: "1.0.0", artifacts, obtainCredential, tempRoot: paths.root }),
    (error) => error.code === "VIBE64_PUBLISH_NOT_PROVEN"
  );

  const stored = path.join(artifacts.directory, "files", "sdk-1.0.0.tgz");
  await chmod(stored, 0o644);
  await writeFile(stored, "swapped");
  await assert.rejects(
    publishTarget({ destination: fakeDestination().destination, target, version: "1.0.0", artifacts, obtainCredential }),
    (error) => error.code === "VIBE64_PUBLISH_ARTIFACT_CHANGED"
  );
});

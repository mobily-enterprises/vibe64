// The GitHub Releases destination against a stand-in GitHub (packagingGithubStandIn.js), in the ordinary suite: the
// exact API requests it sends and gh command lines it runs, signed in with a fake token. A release is created on the
// pushed tag with every built file, read back through GitHub's digests and found again on a re-run; an interrupted
// release is resumed by attaching only what it lacks; the channel picks gh's flags; refusals are told; and a target
// that leaves the stand-in out reaches nothing. packagingGithubReleases.integration.test.js is the opt-in run against
// GitHub itself.
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { githubReleasesDestination } from "../../packages/vibe64-packaging/src/server/destinations/githubReleases/index.js";
import { __testables, publishTarget, runBuildStage, withStageCredentials } from "../../packages/vibe64-packaging/src/server/stages.js";
import { assertOnlyStandIn, startGithubStandIn } from "./packagingGithubStandIn.js";
import { temporaryFolder } from "./packagingRegistryTestTools.js";

const { BUILD_ENVIRONMENT_PASSTHROUGH } = __testables;
const REPOSITORY = "ada/notes";
const SDIST = "ada_notes-0.1.0.tar.gz";
const WHEEL = "ada_notes-0.1.0-py3-none-any.whl";
const FILES = Object.freeze({ [SDIST]: "sdist of ada-notes 0.1.0\n", [WHEEL]: "wheel of ada-notes 0.1.0\n" });
// Upload order is the destination's: by name.
const NAMES = Object.keys(FILES).sort((left, right) => left.localeCompare(right));
const GH_ENVIRONMENT = Object.freeze([
  "GH_CONFIG_DIR", "GH_NO_UPDATE_NOTIFIER", "GH_PROMPT_DISABLED", "GH_SPINNER_DISABLED", "GH_TOKEN",
  "GIT_TERMINAL_PROMPT", "HOME", "NO_COLOR", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"
]);

const apiHeaders = (token, accept = "application/vnd.github+json") => ({
  accept,
  authorization: `Bearer ${token}`,
  "user-agent": "vibe64-publish",
  "x-github-api-version": "2022-11-28"
});
const list = (repository, page) => `GET /repos/${repository}/releases?per_page=100&page=${page}`;
const latest = (repository) => `GET /repos/${repository}/releases/latest`;
// Everything recorded so far, emptying the record for the next step.
const take = (record) => record.splice(0);
const shapes = (requests) => requests.map(({ method, path: sent }) => `${method} ${sent.replace(/\?signature=[0-9a-f]+$/u, "")}`);

// Stage 1 snapshots these files, as a Python package's build leaves them, into checksummed artifacts.
async function builtArtifacts(t, files = FILES) {
  const root = await temporaryFolder(t, "vibe64-github-build-");
  const source = path.join(root, "source");
  await mkdir(source);
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(source, name), content);
  return runBuildStage({
    planHash: `sha256:${"a".repeat(64)}`,
    packageId: "notes",
    steps: [],
    outputs: Object.keys(files).map((name) => path.join(source, name)),
    resultStore: path.join(root, "results"),
    allowedRoots: [source],
    baseEnvironment: process.env
  });
}

const builtPath = (artifacts, name) => path.join(artifacts.directory, "files", name);
const builtSha256 = (artifacts, name) => artifacts.manifest.files.find((file) => file.path === name).sha256;

async function setup(t) {
  const standIn = await startGithubStandIn(t, await temporaryFolder(t, "vibe64-github-stand-in-"));
  const target = ({ repository = REPOSITORY, settings = { api: standIn.api, gh: standIn.gh }, ...rest } = {}) => ({
    id: "notes-release",
    destination: "github-releases",
    package: "notes",
    channel: "latest",
    notes: "- First release.",
    ...rest,
    settings: { repository, ...settings }
  });
  const obtainCredential = async (spec) => {
    assert.equal(spec.id, "github-token");
    return standIn.token;
  };
  const publish = (releaseTarget, artifacts) => publishTarget({
    baseEnvironment: standIn.baseEnvironment,
    destination: githubReleasesDestination,
    target: releaseTarget,
    version: "0.1.0",
    artifacts,
    obtainCredential
  });
  const signedIn = (operation, token = standIn.token) => withStageCredentials({
    credentials: githubReleasesDestination.credentials,
    obtainCredential: async () => token
  }, operation);
  return { standIn, target, publish, signedIn };
}

// gh ran in a private home that is gone now, with the stand-in's sign-in and nothing ambient.
async function assertGhRun(call, standIn) {
  const home = call.env.HOME;
  assert.equal(call.exitCode, 0);
  assert.match(path.basename(home), /^vibe64-publish-tool-/u);
  assert.equal(path.basename(call.cwd), path.basename(home), "gh runs in its home");
  await assert.rejects(stat(home), { code: "ENOENT" }, "gh's home is removed after the upload");
  assert.deepEqual(Object.keys(call.env).filter((name) => !BUILD_ENVIRONMENT_PASSTHROUGH.includes(name)).sort(), GH_ENVIRONMENT);
  assert.deepEqual(
    [call.env.GH_TOKEN, call.env.GH_CONFIG_DIR, call.env.TMPDIR, call.env.GH_PROMPT_DISABLED, call.env.PATH],
    [standIn.token, path.join(home, "gh"), home, "1", standIn.baseEnvironment.PATH]
  );
}

test("a release is created on the pushed tag with every file, read back through GitHub's digests, and found again on a re-run", async (t) => {
  const { standIn, target, publish, signedIn } = await setup(t);
  standIn.repository(REPOSITORY, { tags: ["v0.1.0"] });
  const artifacts = await builtArtifacts(t);

  const verified = await signedIn((credentials) => githubReleasesDestination.verifyCredential({ target: target(), credentials }));
  assert.deepEqual(verified, { ok: true, account: REPOSITORY, message: `Can publish releases to ${REPOSITORY}.` });
  const dry = await signedIn((credentials) => githubReleasesDestination.dryRun({ target: target(), version: "0.1.0", artifacts, credentials }));
  assert.deepEqual([dry.tag, dry.tagPushed, dry.releaseExists, dry.alreadyPublished], ["v0.1.0", true, false, false]);
  assert.deepEqual(dry.files.map(({ name, alreadyAttached }) => [name, alreadyAttached]), NAMES.map((name) => [name, false]));
  const checks = take(standIn.requests);
  assert.deepEqual(shapes(checks).sort(), [`GET /repos/${REPOSITORY}`, `GET /repos/${REPOSITORY}/git/ref/tags/v0.1.0`, list(REPOSITORY, 1)]);
  for (const request of checks) assert.deepEqual(request.headers, apiHeaders(standIn.token), request.path);
  assert.deepEqual(standIn.ghCalls, []);

  const published = await publish(target(), artifacts);
  assert.equal(published.status, "proven");
  assert.equal(published.alreadyPublished, false);
  const release = standIn.release(REPOSITORY, "v0.1.0");
  assert.deepEqual(published.proof, {
    repository: REPOSITORY,
    tag: "v0.1.0",
    release: release.id,
    url: `${standIn.api}${REPOSITORY}/releases/tag/v0.1.0`,
    channel: "latest",
    immutable: false,
    assets: NAMES.map((name) => ({ name, sha256: builtSha256(artifacts, name), size: Buffer.byteLength(FILES[name]) }))
  });
  assert.deepEqual([release.title, release.body, release.draft, release.prerelease], ["v0.1.0", "- First release.\n", false, false]);
  const [create, ...more] = take(standIn.ghCalls);
  assert.deepEqual(more, []);
  assert.deepEqual(create.args, [
    "release", "create", "v0.1.0", ...NAMES.map((name) => builtPath(artifacts, name)),
    "--repo", REPOSITORY, "--verify-tag", "--title", "v0.1.0", "--notes-file", path.join(create.env.HOME, "notes.md"), "--latest"
  ]);
  assert.equal(create.notes, "- First release.\n");
  await assertGhRun(create, standIn);
  // Read back before (nothing yet), the upload's own lookup, and read back after with the latest release.
  const publishing = take(standIn.requests);
  assert.deepEqual(shapes(publishing), [list(REPOSITORY, 1), list(REPOSITORY, 1), list(REPOSITORY, 1), latest(REPOSITORY)]);
  for (const request of publishing) assert.deepEqual(request.headers, apiHeaders(standIn.token), request.path);

  const again = await publish(target(), artifacts);
  assert.deepEqual([again.status, again.alreadyPublished, again.proof], ["proven", true, published.proof]);
  assert.deepEqual(shapes(take(standIn.requests)), [list(REPOSITORY, 1), latest(REPOSITORY)]);
  assert.deepEqual(standIn.ghCalls, []);
  assert.deepEqual(standIn.tags(REPOSITORY), ["v0.1.0"]);
  await assertOnlyStandIn(standIn);
});

test("an interrupted release is resumed: found on a later page, its older asset hashed from its bytes, only the missing file attached", async (t) => {
  const { standIn, target, publish } = await setup(t);
  standIn.repository(REPOSITORY, { tags: ["v0.1.0"] });
  const artifacts = await builtArtifacts(t);
  // The release has the sdist, uploaded before GitHub reported digests, and a hundred newer releases come first.
  const interrupted = standIn.addRelease(REPOSITORY, {
    tag: "v0.1.0",
    body: "- First release.\n",
    latest: true,
    files: [{ name: SDIST, content: FILES[SDIST], withDigest: false }]
  });
  for (let night = 1; night <= 100; night += 1) standIn.addRelease(REPOSITORY, { tag: `nightly-${night}`, prerelease: true });

  const published = await publish(target(), artifacts);
  assert.equal(published.status, "proven");
  assert.equal(published.alreadyPublished, false);
  assert.deepEqual([published.proof.release, published.proof.channel], [interrupted.id, "latest"]);
  assert.deepEqual(published.proof.assets.map(({ name, sha256 }) => [name, sha256]), NAMES.map((name) => [name, builtSha256(artifacts, name)]));
  const [upload, ...more] = take(standIn.ghCalls);
  assert.deepEqual(more, []);
  assert.deepEqual(upload.args, ["release", "upload", "v0.1.0", builtPath(artifacts, WHEEL), "--repo", REPOSITORY]);
  assert.equal(upload.notes, null);
  await assertGhRun(upload, standIn);

  const sdist = interrupted.assets.find(({ name }) => name === SDIST);
  const download = [`GET /repos/${REPOSITORY}/releases/assets/${sdist.id}`, `GET /_storage/${sdist.id}`];
  const sent = take(standIn.requests);
  assert.deepEqual(shapes(sent), [
    list(REPOSITORY, 1), list(REPOSITORY, 2), ...download,
    list(REPOSITORY, 1), list(REPOSITORY, 2),
    list(REPOSITORY, 1), list(REPOSITORY, 2), ...download, latest(REPOSITORY)
  ]);
  for (const request of sent) {
    const asset = request.path.includes("/assets/") || request.path.startsWith("/_storage/");
    assert.deepEqual(request.headers, apiHeaders(standIn.token, asset ? "application/octet-stream" : undefined), request.path);
  }
  assert.deepEqual(interrupted.assets.map(({ name }) => name).sort(), [...NAMES].sort());
  await assertOnlyStandIn(standIn);
});

test("the channel picks gh's flags, and the read-back reports it", async (t) => {
  const { standIn, target, publish } = await setup(t);
  const artifacts = await builtArtifacts(t);
  for (const [channel, flags, reads] of [
    ["draft", ["--draft"], (repository) => [list(repository, 1), list(repository, 1), list(repository, 1)]],
    ["prerelease", ["--prerelease", "--latest=false"], (repository) => [list(repository, 1), list(repository, 1), list(repository, 1), latest(repository)]]
  ]) {
    const repository = `ada/${channel}s`;
    standIn.repository(repository, { tags: ["v0.1.0"] });
    const published = await publish(target({ repository, channel }), artifacts);
    assert.equal(published.proof.channel, channel);
    const [create] = take(standIn.ghCalls);
    assert.deepEqual(create.args.slice(create.args.indexOf("--notes-file") + 2), flags, channel);
    assert.deepEqual(shapes(take(standIn.requests)), reads(repository), channel);
    const release = standIn.release(repository, "v0.1.0");
    assert.deepEqual([release.draft, release.prerelease], [channel === "draft", channel === "prerelease"]);
  }
  await assertOnlyStandIn(standIn);
});

test("a different file under a published name is a conflict, an unpushed tag is never made, and a bad or read-only sign-in is told", async (t) => {
  const { standIn, target, publish, signedIn } = await setup(t);
  const artifacts = await builtArtifacts(t);

  standIn.repository(REPOSITORY, { tags: ["v0.1.0"] });
  const earlier = standIn.addRelease(REPOSITORY, { tag: "v0.1.0", latest: true, files: [{ name: SDIST, content: "an earlier sdist\n" }] });
  await assert.rejects(publish(target(), artifacts), { code: "VIBE64_PUBLISH_VERSION_CONFLICT" });
  assert.deepEqual(standIn.ghCalls, [], "gh never runs for a conflicting release");
  assert.deepEqual(earlier.assets.map(({ name }) => name), [SDIST]);

  standIn.repository("ada/untagged");
  await assert.rejects(publish(target({ repository: "ada/untagged" }), artifacts), (error) => {
    assert.equal(error.code, "VIBE64_PUBLISH_GITHUB_RELEASE_CREATE_FAILED");
    assert.match(error.details.output, /tag v0\.1\.0 doesn't exist in the repo ada\/untagged, aborting due to --verify-tag flag/u);
    assert.ok(!error.details.output.includes(standIn.token));
    return true;
  });
  assert.deepEqual([standIn.tags("ada/untagged"), standIn.release("ada/untagged", "v0.1.0")], [[], null]);

  take(standIn.requests);
  const wrong = await signedIn((credentials) => githubReleasesDestination.verifyCredential({ target: target(), credentials }), "ghp_not-the-stand-in-token");
  assert.deepEqual(wrong, { ok: false, message: `GitHub did not show ${REPOSITORY} to this sign-in (401).` });
  assert.equal(take(standIn.requests)[0].headers.authorization, "Bearer ghp_not-the-stand-in-token");
  standIn.repository("ada/read-only", { push: false });
  const readOnly = await signedIn((credentials) => githubReleasesDestination.verifyCredential({ target: target({ repository: "ada/read-only" }), credentials }));
  assert.deepEqual(readOnly, { ok: false, message: "This GitHub sign-in cannot publish releases to ada/read-only." });
  await assertOnlyStandIn(standIn);
});

test("a target that leaves out the stand-in's address or gh reaches neither GitHub nor the real gh", async (t) => {
  const { standIn, target, publish, signedIn } = await setup(t);
  standIn.repository(REPOSITORY, { tags: ["v0.1.0"] });
  const artifacts = await builtArtifacts(t);

  await assert.rejects(
    signedIn((credentials) => githubReleasesDestination.verifyCredential({ target: target({ settings: {} }), credentials })),
    { code: "VIBE64_PUBLISH_REGISTRY_UNREACHABLE", message: "Could not reach api.github.com: REFUSED_BY_TEST." }
  );
  assert.deepEqual(take(standIn.refusedFetches), [`https://api.github.com/repos/${REPOSITORY}`]);

  await assert.rejects(publish(target({ settings: { api: standIn.api } }), artifacts), (error) => {
    assert.equal(error.code, "VIBE64_PUBLISH_GITHUB_RELEASE_CREATE_FAILED");
    assert.match(error.details.output, /gh refused: the GitHub Releases tests never run the real gh/u);
    return true;
  });
  const [refused, ...more] = await standIn.refusedGh();
  assert.deepEqual(more, []);
  assert.match(refused, /^release create v0\.1\.0 .* --repo ada\/notes --verify-tag /u);
  assert.deepEqual([standIn.ghCalls, standIn.release(REPOSITORY, "v0.1.0"), standIn.refusedFetches], [[], null, []]);
});

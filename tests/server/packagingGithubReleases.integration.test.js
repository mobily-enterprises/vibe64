// Opt-in (VIBE64_TEST_GITHUB_RELEASES=1, with `gh` signed in to an account that
// may create repositories in the vibe64-dev organisation): a canary package is
// released to a throwaway private repository's GitHub Releases, read back
// through the API's asset digests, re-run idempotently, protected against a
// mismatched re-upload, and an earlier release is made latest again. The
// repository is deleted whatever happens.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { promisify } from "node:util";

import { inspectVibe64Packaging } from "../../packages/vibe64-genesis/src/server/index.js";
import { githubReleasesDestination } from "../../packages/vibe64-packaging/src/server/destinations/githubReleases/index.js";
import { createPublishPlan } from "../../packages/vibe64-packaging/src/server/plan.js";
import { buildPackage } from "../../packages/vibe64-packaging/src/server/release/buildPackage.js";
import { publishTarget, withStageCredentials } from "../../packages/vibe64-packaging/src/server/stages.js";
import { commitFiles, gitProject, temporaryFolder } from "./packagingRegistryTestTools.js";

const run = promisify(execFile);
const ENABLED = process.env.VIBE64_TEST_GITHUB_RELEASES === "1";
const ORGANISATION = "vibe64-dev";

const STACK = `# Stack

## Components

- \`nodejs\`

## Connected development

- Nothing.

## Packaging

### Package \`sdk\`: Canary SDK

- Packer: \`npm\`
- Version from: \`package.json\`
`;

const manifest = (version) => `${JSON.stringify({ name: "vibe64-canary-sdk", version, license: "MIT", files: ["index.js"] }, null, 2)}\n`;

test("a canary is released to a throwaway private repository's GitHub Releases", {
  skip: ENABLED ? false : "set VIBE64_TEST_GITHUB_RELEASES=1 to create and delete a private vibe64-dev repository",
  timeout: 600_000
}, async (t) => {
  const repository = `${ORGANISATION}/vibe64-publish-canary-${randomBytes(4).toString("hex")}`;
  const token = (await run("gh", ["auth", "token"])).stdout.trim();
  await run("gh", ["repo", "create", repository, "--private", "--description", "Throwaway Vibe64 publishing canary; deleted by its test."]);
  t.after(() => run("gh", ["repo", "delete", repository, "--yes"]));

  const project = await gitProject(t, { "genesis/stack.md": STACK, "package.json": manifest("0.1.0"), "index.js": "export const answer = 42;\n" });
  const store = await temporaryFolder(t, "vibe64-github-results-");
  const push = (...refs) => run("git", [
    "-C", project.root, "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential",
    "push", "-q", `https://github.com/${repository}.git`, ...refs
  ]);
  await run("git", ["-C", project.root, "tag", "v0.1.0", project.commit]);
  await push("main", "v0.1.0");

  const obtainCredential = async (spec) => {
    assert.equal(spec.id, "github-token");
    return token;
  };
  const credentialed = (operation) => withStageCredentials({ credentials: githubReleasesDestination.credentials, obtainCredential }, operation);
  const target = { id: "sdk-release", destination: "github-releases", package: "sdk", channel: "latest", settings: { repository } };
  const packaging = await inspectVibe64Packaging({ projectRoot: project.root });
  const { plan, planHash } = createPublishPlan({ savedCommit: project.commit, packaging, versions: { sdk: "0.1.0" }, targets: [target] });
  const releaseTarget = { ...target, tag: plan.packages[0].tag, notes: "- First canary." };
  const built = await buildPackage({ projectRoot: project.root, commit: project.commit, packaging, packageId: "sdk", version: "0.1.0", planHash, resultStore: store });

  const verified = await credentialed((credentials) => githubReleasesDestination.verifyCredential({ target: releaseTarget, credentials }));
  assert.equal(verified.ok, true, verified.message);
  const dry = await credentialed((credentials) => githubReleasesDestination.dryRun({ target: releaseTarget, version: "0.1.0", artifacts: built.artifacts, credentials }));
  assert.deepEqual([dry.tag, dry.tagPushed, dry.releaseExists, dry.alreadyPublished], ["v0.1.0", true, false, false]);

  const published = await publishTarget({ destination: githubReleasesDestination, target: releaseTarget, version: "0.1.0", artifacts: built.artifacts, obtainCredential });
  assert.equal(published.status, "proven");
  assert.equal(published.alreadyPublished, false);
  assert.equal(published.proof.channel, "latest");
  assert.deepEqual(published.proof.assets.map(({ name, sha256 }) => [name, sha256]), [["vibe64-canary-sdk-0.1.0.tgz", built.artifacts.manifest.files[0].sha256]]);

  const rerun = await publishTarget({ destination: githubReleasesDestination, target: releaseTarget, version: "0.1.0", artifacts: built.artifacts, obtainCredential });
  assert.equal(rerun.alreadyPublished, true);

  // A different file under a published asset's name is refused, never replaced.
  const changed = await commitFiles(project.root, { "index.js": "export const answer = 43;\n" }, "Change without a version bump");
  const mismatched = await buildPackage({ projectRoot: project.root, commit: changed.commit, packaging, packageId: "sdk", version: "0.1.0", resultStore: store });
  await assert.rejects(
    publishTarget({ destination: githubReleasesDestination, target: releaseTarget, version: "0.1.0", artifacts: mismatched.artifacts, obtainCredential }),
    { code: "VIBE64_PUBLISH_VERSION_CONFLICT" }
  );

  // A second release becomes latest; making the first latest again is the "rollback".
  const next = await commitFiles(project.root, { "package.json": manifest("0.2.0") }, "Release 0.2.0");
  await run("git", ["-C", project.root, "tag", "v0.2.0", next.commit]);
  await push("main", "v0.2.0");
  const nextBuilt = await buildPackage({ projectRoot: project.root, commit: next.commit, packaging, packageId: "sdk", version: "0.2.0", resultStore: store });
  const nextPublished = await publishTarget({
    destination: githubReleasesDestination,
    target: { ...target, tag: "v0.2.0" },
    version: "0.2.0",
    artifacts: nextBuilt.artifacts,
    obtainCredential
  });
  assert.equal(nextPublished.proof.channel, "latest");
  await credentialed((credentials) => githubReleasesDestination.markLatest({ target, tag: "v0.1.0", credentials }));
  const again = await credentialed((credentials) => githubReleasesDestination.readBack({ target: releaseTarget, version: "0.1.0", artifacts: built.artifacts, credentials }));
  assert.equal(again.proof.channel, "latest");
});

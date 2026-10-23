// A canary npm library released end to end against a throwaway Verdaccio:
// build once from the saved commit, dry run, publish, read back, idempotent
// re-run, refused mismatched re-publish, next version, `latest` moved back, and
// the CLI building the same tarball bytes outside the editor.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { inspectVibe64Packaging } from "../../packages/vibe64-genesis/src/server/index.js";
import { npmDestination, npmTokenUserconfig } from "../../packages/vibe64-packaging/src/server/destinations/npm/index.js";
import { createPublishPlan } from "../../packages/vibe64-packaging/src/server/plan.js";
import { buildPackage } from "../../packages/vibe64-packaging/src/server/release/buildPackage.js";
import { applyReleaseChange, prepareReleaseChange } from "../../packages/vibe64-packaging/src/server/release/prepareChange.js";
import { publishTarget, withStageCredentials } from "../../packages/vibe64-packaging/src/server/stages.js";
import { commitFiles, gitProject, startVerdaccio, temporaryFolder } from "./packagingRegistryTestTools.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../../packages/vibe64-packaging/bin/vibe64-publish.js", import.meta.url));

const STACK = `# Stack

## Components

- \`nodejs\`

## Packaging

### Package \`sdk\`: Canary SDK

- Packer: \`npm\`
- Prepare \`Write build stamp\`: \`node\` \`-e\` \`require('fs').writeFileSync('stamp.txt', 'built')\`
- Version from: \`package.json\`
`;

function canaryFiles(body = "export const answer = 42;\n", version = "0.1.0") {
  return {
    "genesis/stack.md": STACK,
    "package.json": `${JSON.stringify({
      name: "vibe64-canary-sdk",
      version,
      description: "Vibe64 publishing canary",
      license: "MIT",
      type: "module",
      main: "index.js",
      files: ["index.js", "stamp.txt"]
    }, null, 2)}\n`,
    "index.js": body,
    "README.md": "# Canary\n"
  };
}

test("an npm library is built once, dry-run, published, read back and re-released safely", { timeout: 600_000 }, async (t) => {
  const registry = await startVerdaccio(t);
  const project = await gitProject(t, canaryFiles());
  const store = await temporaryFolder(t, "vibe64-npm-results-");
  const userconfig = npmTokenUserconfig({ registry: registry.url, token: registry.token });
  const obtainCredential = async (spec) => {
    assert.equal(spec.id, "npm-userconfig");
    return userconfig;
  };
  const target = { id: "sdk-npm", destination: "npm", package: "sdk", channel: "latest", settings: { registry: registry.url } };

  const packaging = await inspectVibe64Packaging({ projectRoot: project.root });
  assert.equal(packaging.status, "ready");
  const { plan, planHash } = createPublishPlan({ savedCommit: project.commit, packaging, versions: { sdk: "0.1.0" }, targets: [target] });
  assert.deepEqual(plan.targets[0].settings, { registry: registry.url });
  assert.deepEqual(plan.tags, ["v0.1.0"]);

  const built = await buildPackage({ projectRoot: project.root, commit: project.commit, packaging, packageId: "sdk", version: "0.1.0", planHash, resultStore: store });
  assert.equal(built.check.packageName, "vibe64-canary-sdk");
  assert.deepEqual(built.artifacts.manifest.files.map(({ path: file }) => file), ["vibe64-canary-sdk-0.1.0.tgz"]);
  const tarballChecksum = built.artifacts.manifest.files[0].sha256;
  // The Prepare step ran in the exported commit, so its output is in the tarball.
  const again = await buildPackage({ projectRoot: project.root, commit: project.commit, packaging, packageId: "sdk", version: "0.1.0", planHash, resultStore: store });
  assert.equal(again.artifacts.reused, true);

  // A working sign-in is proven read-only before anything is published.
  const verified = await withStageCredentials({ credentials: npmDestination.credentials, obtainCredential }, (credentials) => npmDestination.verifyCredential({ target, credentials }));
  assert.equal(verified.ok, true);
  assert.equal(verified.account, "canary");

  // Dry run first: the exact tarball, its contents, nothing published.
  const dry = await withStageCredentials({ credentials: npmDestination.credentials, obtainCredential }, (credentials) => npmDestination.dryRun({
    target, version: "0.1.0", artifacts: built.artifacts, credentials
  }));
  assert.equal(dry.alreadyPublished, false);
  assert.equal(dry.previousVersion, null);
  assert.deepEqual(dry.files.map(({ path: file }) => file), ["index.js", "package.json", "README.md", "stamp.txt"]);
  assert.doesNotMatch(dry.report, new RegExp(registry.token));
  const before = await npmDestination.readBack({ target, version: "0.1.0", artifacts: built.artifacts });
  assert.equal(before.published, false);

  // Publish, proven by the registry's own integrity value.
  const published = await publishTarget({ destination: npmDestination, target, version: "0.1.0", artifacts: built.artifacts, obtainCredential });
  assert.equal(published.status, "proven");
  assert.equal(published.alreadyPublished, false);
  assert.equal(published.proof.integrity, dry.integrity);
  assert.equal(published.proof.channelVersion, "0.1.0");

  // Idempotent: re-running finds the same bytes already published.
  const rerun = await publishTarget({ destination: npmDestination, target, version: "0.1.0", artifacts: built.artifacts, obtainCredential });
  assert.equal(rerun.alreadyPublished, true);
  assert.equal(rerun.checksum, published.checksum);
  assert.equal(await publishTarget({ destination: npmDestination, target, version: "0.1.0", artifacts: built.artifacts, previous: published, obtainCredential }), published);

  // Different contents under the same version are refused, never overwritten.
  const changed = await commitFiles(project.root, { "index.js": "export const answer = 43;\n" }, "Change without a version bump");
  const changedPackaging = await inspectVibe64Packaging({ projectRoot: project.root });
  const mismatched = await buildPackage({ projectRoot: project.root, commit: changed.commit, packaging: changedPackaging, packageId: "sdk", version: "0.1.0", resultStore: store });
  await assert.rejects(
    publishTarget({ destination: npmDestination, target, version: "0.1.0", artifacts: mismatched.artifacts, obtainCredential }),
    (error) => error.code === "VIBE64_PUBLISH_VERSION_CONFLICT" && /different contents/u.test(error.message)
  );

  // The next release: prepared as an ordinary source change, saved, then built.
  const entry = changedPackaging.packages[0];
  const change = await prepareReleaseChange({ projectRoot: project.root, entry, version: "0.2.0", notes: "- The answer changed.", date: "2026-10-23" });
  assert.deepEqual(change.files.map(({ path: file }) => file), ["package.json", "CHANGELOG.md"]);
  await applyReleaseChange({ projectRoot: project.root, change });
  const next = await commitFiles(project.root, {}, "Release 0.2.0");
  const nextBuilt = await buildPackage({ projectRoot: project.root, commit: next.commit, packaging: changedPackaging, packageId: "sdk", version: "0.2.0", resultStore: store });
  const nextDry = await withStageCredentials({ credentials: npmDestination.credentials, obtainCredential }, (credentials) => npmDestination.dryRun({
    target, version: "0.2.0", artifacts: nextBuilt.artifacts, credentials
  }));
  assert.equal(nextDry.previousVersion, "0.1.0");
  assert.deepEqual(nextDry.diff, { added: [], removed: [], changed: ["index.js", "package.json"] });
  const nextPublished = await publishTarget({ destination: npmDestination, target, version: "0.2.0", artifacts: nextBuilt.artifacts, obtainCredential });
  assert.equal(nextPublished.proof.channelVersion, "0.2.0");

  // "Rollback": move `latest` back to 0.1.0.
  await withStageCredentials({ credentials: npmDestination.credentials, obtainCredential }, (credentials) => npmDestination.moveChannel({
    target, packageName: "vibe64-canary-sdk", version: "0.1.0", credentials
  }));
  const packument = await (await fetch(new URL("vibe64-canary-sdk", registry.url))).json();
  assert.equal(packument["dist-tags"].latest, "0.1.0");
  assert.deepEqual(Object.keys(packument.versions).sort(), ["0.1.0", "0.2.0"]);

  // The CLI, outside the editor, builds the same tarball bytes from the same commit.
  const cliStore = await temporaryFolder(t, "vibe64-npm-cli-results-");
  const { stdout } = await run(process.execPath, [CLI, "build", "sdk", "--project", project.root, "--commit", project.commit, "--version", "sdk=0.1.0", "--result-store", cliStore, "--json"], {
    timeout: 300_000
  });
  const cli = JSON.parse(stdout);
  assert.equal(cli.commit, project.commit);
  assert.deepEqual(cli.files.map(({ path: file, sha256 }) => [file, sha256]), [["vibe64-canary-sdk-0.1.0.tgz", tarballChecksum]]);

  // No credential reached the result store.
  for (const directory of [store, cliStore]) {
    for (const file of await readdir(directory, { recursive: true })) {
      const absolute = path.join(directory, file);
      const content = await readFile(absolute).catch(() => null);
      if (content) assert.equal(content.includes(registry.token), false, `${file} holds a credential`);
    }
  }
});

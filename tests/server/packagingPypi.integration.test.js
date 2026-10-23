// A canary Python library released end to end against a throwaway pypiserver:
// sdist + wheel built once from the saved commit, `twine check`, upload, read back
// through the simple index's sha256, idempotent re-run, refused mismatched
// re-publish, and a prerelease published under its PEP 440 spelling.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { inspectVibe64Packaging } from "../../packages/vibe64-genesis/src/server/index.js";
import { pypiDestination } from "../../packages/vibe64-packaging/src/server/destinations/pypi/index.js";
import { createPublishPlan } from "../../packages/vibe64-packaging/src/server/plan.js";
import { buildPackage } from "../../packages/vibe64-packaging/src/server/release/buildPackage.js";
import { applyReleaseChange, prepareReleaseChange } from "../../packages/vibe64-packaging/src/server/release/prepareChange.js";
import { publishTarget, withStageCredentials } from "../../packages/vibe64-packaging/src/server/stages.js";
import { commitFiles, gitProject, startPypiServer, temporaryFolder } from "./packagingRegistryTestTools.js";

const STACK = `# Stack

## Components

- \`python\`

## Packaging

### Package \`client\`: Canary client

- Packer: \`python-dist\`
- Workdir: \`client\`
- Build \`Build distributions\`: \`python\` \`-m\` \`build\` \`--no-isolation\`
- Output: \`client/dist\`
- Version from: \`pyproject.toml\`
`;

const PYPROJECT = `[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "vibe64-canary-py"
version = "0.1.0"
description = "Vibe64 publishing canary"
readme = "README.md"
requires-python = ">=3.9"
license = "MIT"

[tool.setuptools]
packages = ["vibe64_canary"]
`;

test("a Python library is built once, checked, uploaded, read back and re-released safely", { timeout: 600_000 }, async (t) => {
  const index = await startPypiServer(t);
  const project = await gitProject(t, {
    "genesis/stack.md": STACK,
    "client/pyproject.toml": PYPROJECT,
    "client/README.md": "# Canary\n\nA canary package.\n",
    "client/vibe64_canary/__init__.py": "ANSWER = 42\n"
  });
  const store = await temporaryFolder(t, "vibe64-pypi-results-");
  const baseEnvironment = { ...process.env, PATH: `${index.tools.bin}${path.delimiter}${process.env.PATH}` };
  const obtainCredential = async (spec) => {
    assert.equal(spec.id, "pypi-token");
    return index.password;
  };
  const target = {
    id: "client-pypi",
    destination: "pypi",
    package: "client",
    settings: { repository: index.url, index: index.index, username: index.user, twine: [index.tools.python, "-m", "twine"] }
  };
  const credentialed = (operation) => withStageCredentials({ credentials: pypiDestination.credentials, obtainCredential }, operation);

  const packaging = await inspectVibe64Packaging({ projectRoot: project.root });
  assert.equal(packaging.status, "ready");
  const { planHash } = createPublishPlan({ savedCommit: project.commit, packaging, versions: { client: "0.1.0" }, targets: [target] });

  const built = await buildPackage({ projectRoot: project.root, commit: project.commit, packaging, packageId: "client", version: "0.1.0", planHash, resultStore: store, baseEnvironment });
  assert.equal(built.check.project, "vibe64-canary-py");
  assert.equal(built.check.version, "0.1.0");
  assert.deepEqual(built.check.files, ["vibe64_canary_py-0.1.0-py3-none-any.whl", "vibe64_canary_py-0.1.0.tar.gz"]);

  const verified = await credentialed((credentials) => pypiDestination.verifyCredential({ target, credentials }));
  assert.deepEqual([verified.ok, verified.verified], [true, false]);

  const dry = await pypiDestination.dryRun({ target, version: "0.1.0", artifacts: built.artifacts });
  assert.equal(dry.alreadyPublished, false);
  assert.match(dry.report, /PASSED/u);
  assert.equal((await pypiDestination.readBack({ target, version: "0.1.0", artifacts: built.artifacts })).published, false);

  const published = await publishTarget({ destination: pypiDestination, target, version: "0.1.0", artifacts: built.artifacts, obtainCredential });
  assert.equal(published.status, "proven");
  assert.equal(published.alreadyPublished, false);
  assert.deepEqual(published.proof.files.map(({ name, sha256 }) => [name, sha256]), built.artifacts.manifest.files
    .map((file) => [path.posix.basename(file.path), file.sha256])
    .sort(([left], [right]) => left.localeCompare(right)));

  const rerun = await publishTarget({ destination: pypiDestination, target, version: "0.1.0", artifacts: built.artifacts, obtainCredential });
  assert.equal(rerun.alreadyPublished, true);
  assert.equal(rerun.checksum, published.checksum);

  // Different code under the same version is refused, never re-uploaded.
  const changed = await commitFiles(project.root, { "client/vibe64_canary/__init__.py": "ANSWER = 43\n" }, "Change without a version bump");
  const mismatched = await buildPackage({ projectRoot: project.root, commit: changed.commit, packaging, packageId: "client", version: "0.1.0", resultStore: store, baseEnvironment });
  await assert.rejects(
    publishTarget({ destination: pypiDestination, target, version: "0.1.0", artifacts: mismatched.artifacts, obtainCredential }),
    (error) => error.code === "VIBE64_PUBLISH_VERSION_CONFLICT"
  );

  // A prerelease: semver 0.2.0-rc.1 is written and published as PEP 440 0.2.0rc1.
  const change = await prepareReleaseChange({ projectRoot: project.root, entry: packaging.packages[0], version: "0.2.0-rc.1", notes: "- The answer changed.", date: "2026-10-23" });
  assert.equal(change.sourceVersion, "0.2.0rc1");
  assert.deepEqual(change.files.map(({ path: file }) => file), ["client/pyproject.toml", "client/CHANGELOG.md"]);
  await applyReleaseChange({ projectRoot: project.root, change });
  assert.match(await readFile(path.join(project.root, "client/pyproject.toml"), "utf8"), /^version = "0\.2\.0rc1"$/mu);
  const next = await commitFiles(project.root, {}, "Release 0.2.0-rc.1");
  const nextBuilt = await buildPackage({ projectRoot: project.root, commit: next.commit, packaging, packageId: "client", version: "0.2.0-rc.1", resultStore: store, baseEnvironment });
  const nextPublished = await publishTarget({ destination: pypiDestination, target, version: "0.2.0-rc.1", artifacts: nextBuilt.artifacts, obtainCredential });
  assert.equal(nextPublished.proof.version, "0.2.0rc1");
  const nextDry = await pypiDestination.dryRun({ target, version: "0.2.0-rc.1", artifacts: nextBuilt.artifacts });
  assert.deepEqual(nextDry.publishedVersions, ["0.1.0", "0.2.0rc1"]);
  assert.equal(nextDry.alreadyPublished, true);

  // A wrong token fails the upload with redacted output and nothing published.
  const wrongBuilt = await commitFiles(project.root, { "client/pyproject.toml": PYPROJECT.replace("0.1.0", "0.3.0") }, "Release 0.3.0");
  const third = await buildPackage({ projectRoot: project.root, commit: wrongBuilt.commit, packaging, packageId: "client", version: "0.3.0", resultStore: store, baseEnvironment });
  const wrongToken = "wrong-token-value-123456";
  await assert.rejects(
    publishTarget({ destination: pypiDestination, target, version: "0.3.0", artifacts: third.artifacts, obtainCredential: async () => wrongToken }),
    (error) => error.code === "VIBE64_PUBLISH_UPLOAD_FAILED" && !JSON.stringify(error.details).includes(wrongToken)
  );
  assert.equal((await pypiDestination.readBack({ target, version: "0.3.0", artifacts: third.artifacts })).published, false);
});

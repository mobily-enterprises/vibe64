// Builds one declared package from one saved commit: export the commit into a
// throwaway folder, run the packer's credential-free Stage 1 recipe there, store
// the checksummed artifacts and check them. The editor and `vibe64-publish build`
// both use this, so the same commit gives the same bytes wherever it is built.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { VIBE64_PACKAGING_SOURCE_EXCLUSIONS } from "@local/vibe64-genesis/server/packaging";

import { canonicalJson, sha256 } from "../canonical.js";
import { publishError } from "../errors.js";
import { vibe64Packer } from "../packers/index.js";
import { runBuildStage, storedArtifacts } from "../stages.js";
import { exportSavedCommit } from "./exportCommit.js";

// Without a release plan (a build on its own), the result store is keyed by
// everything that decides the bytes: commit, Packaging, package, version and,
// for app packages, the build number and the pinned native template.
function buildOnlyKey({ commit, packagingHash, packageId, version, versionCode = null, template = null }) {
  return sha256(canonicalJson({
    contract: "vibe64.publish-build.v1",
    commit,
    packagingHash,
    package: packageId,
    version,
    ...(versionCode === null ? {} : { versionCode }),
    ...(template === null ? {} : { template })
  }));
}

async function buildPackage({
  projectRoot,
  commit,
  packaging,
  packageId,
  version = null,
  planHash = null,
  resultStore,
  workRoot = os.tmpdir(),
  baseEnvironment = process.env,
  cacheDirectory = "",
  versionCode = null,
  toolchains = {},
  contentArtifacts = null,
  projectSlug = "",
  signal
} = {}, dependencies = {}) {
  const entry = packaging?.packages?.find((candidate) => candidate.id === packageId);
  if (!entry) throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `Packaging declares no package ${packageId}.`);
  const packer = vibe64Packer(entry.packer);
  if (!packer.implemented) throw publishError("VIBE64_PUBLISH_NOT_IMPLEMENTED", `The ${entry.packer} packer cannot build yet.`);
  const template = typeof packer.templates === "function" ? packer.templates() : null;
  const key = planHash || buildOnlyKey({ commit, packagingHash: packaging.packagingHash, packageId, version, versionCode, template });
  const stored = await storedArtifacts({ resultStore, planHash: key, packageId });
  if (stored) {
    return { planHash: key, package: packageId, packer: entry.packer, artifacts: stored, check: await packer.checkArtifacts({ artifacts: stored, version }) };
  }
  // An app package's Content (a web-bundle) builds first, once, into the same store.
  const content = entry.content ? packaging.packages.find((candidate) => candidate.id === entry.content) : null;
  if (entry.content && !content) throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `Package ${entry.id} names Content ${entry.content}, which Packaging does not declare.`);
  const builtContent = content && !contentArtifacts
    ? (await buildPackage({
      projectRoot, commit, packaging, packageId: content.id, planHash, resultStore, workRoot, baseEnvironment, cacheDirectory, projectSlug, signal
    }, dependencies)).artifacts
    : contentArtifacts;
  const source = await mkdtemp(path.join(workRoot, "vibe64-release-source-"));
  try {
    const { commitTime } = await exportSavedCommit({
      projectRoot, commit, directory: path.join(source, "project"), exclude: VIBE64_PACKAGING_SOURCE_EXCLUSIONS
    });
    const sourceRoot = path.join(source, "project");
    const recipe = await packer.buildRecipe({
      sourceRoot,
      entry,
      version,
      commitTime,
      content,
      contentArtifacts: builtContent,
      versionCode,
      toolchains,
      cacheDirectory
    });
    const artifacts = await runBuildStage({
      planHash: key,
      packageId,
      steps: recipe.steps,
      outputs: recipe.outputs,
      environment: recipe.environment,
      resultStore,
      allowedRoots: recipe.allowedRoots,
      baseEnvironment,
      cacheDirectory,
      projectSlug,
      signal
    }, dependencies);
    const check = await packer.checkArtifacts({ artifacts, version });
    return { planHash: key, package: packageId, packer: entry.packer, artifacts, check };
  } finally {
    await rm(source, { recursive: true, force: true });
  }
}

export { buildOnlyKey, buildPackage };

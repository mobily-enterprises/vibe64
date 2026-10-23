// Builds one declared package from one saved commit: export the commit into a
// throwaway folder, run the packer's credential-free Stage 1 recipe there, store
// the checksummed artifacts and check them. The editor and `vibe64-publish build`
// both use this, so the same commit gives the same bytes wherever it is built.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalJson, sha256 } from "../canonical.js";
import { publishError } from "../errors.js";
import { vibe64Packer } from "../packers/index.js";
import { runBuildStage } from "../stages.js";
import { exportSavedCommit } from "./exportCommit.js";

// Without a release plan (a build on its own), the result store is keyed by
// everything that decides the bytes: commit, Packaging, package and version.
function buildOnlyKey({ commit, packagingHash, packageId, version }) {
  return sha256(canonicalJson({ contract: "vibe64.publish-build.v1", commit, packagingHash, package: packageId, version }));
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
  signal
} = {}, dependencies = {}) {
  const entry = packaging?.packages?.find((candidate) => candidate.id === packageId);
  if (!entry) throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `Packaging declares no package ${packageId}.`);
  const packer = vibe64Packer(entry.packer);
  if (!packer.implemented) throw publishError("VIBE64_PUBLISH_NOT_IMPLEMENTED", `The ${entry.packer} packer cannot build yet.`);
  const key = planHash || buildOnlyKey({ commit, packagingHash: packaging.packagingHash, packageId, version });
  const source = await mkdtemp(path.join(workRoot, "vibe64-release-source-"));
  try {
    const { commitTime } = await exportSavedCommit({ projectRoot, commit, directory: path.join(source, "project") });
    const sourceRoot = path.join(source, "project");
    const recipe = await packer.buildRecipe({ sourceRoot, entry, version, commitTime });
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
      signal
    }, dependencies);
    const check = await packer.checkArtifacts({ artifacts, version });
    return { planHash: key, package: packageId, packer: entry.packer, artifacts, check };
  } finally {
    await rm(source, { recursive: true, force: true });
  }
}

export { buildOnlyKey, buildPackage };

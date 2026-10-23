// The python-dist packer: the package's declared Prepare and Build argv (such as
// `python -m build` or `uv build`), collecting the declared Output folder, which
// must then hold exactly one sdist and at least one wheel of the planned version.
import { stat } from "node:fs/promises";
import path from "node:path";

import { publishError } from "../../errors.js";
import { readSourceVersion } from "../../release/prepareChange.js";
import { pep440FromSemver } from "../../release/version.js";
import { recipeSteps, sourceDateEnvironment, toolVersion } from "../registryRecipe.js";

// PEP 503 normalized project name, and the file-name form of it (PEP 625/427).
function normalizeProjectName(name) {
  return String(name).toLowerCase().replace(/[-_.]+/gu, "-");
}

function distributionFileVersion(fileName) {
  const sdist = /^(.+)-([^-]+)\.tar\.gz$/u.exec(fileName);
  if (sdist) return { kind: "sdist", project: normalizeProjectName(sdist[1]), version: sdist[2] };
  const wheel = /^([^-]+)-([^-]+)(?:-\d[^-]*)?-[^-]+-[^-]+-[^-]+\.whl$/u.exec(fileName);
  if (wheel) return { kind: "wheel", project: normalizeProjectName(wheel[1]), version: wheel[2] };
  return null;
}

// Checks the built file names: one sdist, one or more wheels, one project, one version.
function checkPythonDistributions(fileNames, { version = null } = {}) {
  const names = [...fileNames].sort();
  const files = names.map((name) => ({ name, ...distributionFileVersion(name) }));
  const unknown = files.filter((file) => !file.kind);
  if (unknown.length) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `The Output folder holds files that are not Python distributions: ${unknown.map(({ name }) => name).join(", ")}.`);
  }
  const sdists = files.filter((file) => file.kind === "sdist");
  if (sdists.length !== 1 || !files.some((file) => file.kind === "wheel")) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "The build must produce exactly one sdist and at least one wheel.");
  }
  const projects = new Set(files.map((file) => file.project));
  const versions = new Set(files.map((file) => file.version));
  if (projects.size !== 1 || versions.size !== 1) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "The Output folder mixes projects or versions; it must hold one release only.");
  }
  const [built] = versions;
  if (version && built !== pep440FromSemver(version)) {
    throw publishError("VIBE64_PUBLISH_VERSION_MISMATCH", `The build produced version ${built}, not ${pep440FromSemver(version)}.`);
  }
  return { project: [...projects][0], version: built, files: names };
}

// context: { sourceRoot, entry, version (semver, or null), commitTime }; see the npm packer.
async function buildRecipe({ sourceRoot, entry, version = null, commitTime = null } = {}) {
  if (typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot)) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "The python-dist packer needs the exported source folder.");
  }
  const packageRoot = path.join(sourceRoot, entry.workdir || ".");
  if (version && entry.versionFrom === "pyproject.toml") {
    const declared = await readSourceVersion({ projectRoot: sourceRoot, entry });
    if (declared !== pep440FromSemver(version)) {
      throw publishError(
        "VIBE64_PUBLISH_VERSION_MISMATCH",
        `pyproject.toml is version ${declared} in the saved commit, not ${pep440FromSemver(version)}. Save the prepared release first.`
      );
    }
  }
  const output = path.join(sourceRoot, entry.output);
  if (await stat(output).catch(() => null)) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `${entry.output} is committed in the source; remove it so the build makes it fresh.`);
  }
  return {
    version: version ? pep440FromSemver(version) : null,
    steps: recipeSteps(entry, packageRoot),
    outputs: [output],
    environment: sourceDateEnvironment(entry, commitTime),
    allowedRoots: [sourceRoot]
  };
}

const pythonDistPacker = Object.freeze({
  id: "python-dist",
  label: "Python distributions",
  produces: Object.freeze(["sdist", "wheel"]),
  implemented: true,
  buildRecipe,
  // After Stage 1: the stored artifacts are one release of one project.
  checkArtifacts: async ({ artifacts, version = null }) => checkPythonDistributions(
    artifacts.manifest.files.map((file) => path.posix.basename(file.path)),
    { version }
  ),
  toolVersions: async ({ baseEnvironment = process.env } = {}) => ({
    python: await toolVersion(["python3", "--version"], baseEnvironment)
  })
});

export { checkPythonDistributions, distributionFileVersion, normalizeProjectName, pythonDistPacker };

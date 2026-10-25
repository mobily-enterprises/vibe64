// The npm packer: the package's declared Prepare and Build argv, then `npm pack`.
// The result is one tarball; `npm pack` writes fixed file times and a fixed
// order, so the same saved commit always gives the same bytes.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { listNpmTarball, npmTarballManifest } from "../../destinations/npm/tarball.js";
import { publishError } from "../../errors.js";
import { recipeSteps, sourceDateEnvironment, toolVersion } from "../registryRecipe.js";

// npm's own tarball name: `@scope/name` 1.2.0 -> scope-name-1.2.0.tgz.
function npmTarballName(name, version) {
  return `${name.replace(/^@/u, "").replace(/\//gu, "-")}-${version}.tgz`;
}

async function readManifest(packageRoot) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  } catch {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "The npm package has no readable package.json.");
  }
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "package.json needs a name and a version.");
  }
  if (manifest.private === true) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `${manifest.name} is marked private in package.json, so npm refuses to publish it.`);
  }
  return manifest;
}

// context: { sourceRoot: the exported saved commit, entry: the Packaging package,
// version: the planned version (null accepts the source's own), commitTime: the
// saved commit's time in seconds }.
async function buildRecipe({ sourceRoot, entry, version = null, commitTime = null } = {}) {
  if (typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot)) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "The npm packer needs the exported source folder.");
  }
  const packageRoot = path.join(sourceRoot, entry.workdir || ".");
  const manifest = await readManifest(packageRoot);
  if (version && manifest.version !== version) {
    throw publishError(
      "VIBE64_PUBLISH_VERSION_MISMATCH",
      `${manifest.name} is version ${manifest.version} in the saved commit, not ${version}. Save the prepared release first.`
    );
  }
  const tarball = path.join(packageRoot, npmTarballName(manifest.name, manifest.version));
  if (await stat(tarball).catch(() => null)) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `${path.basename(tarball)} is committed in the source; remove it so the build makes it fresh.`);
  }
  return {
    packageName: manifest.name,
    version: manifest.version,
    steps: [
      ...recipeSteps(entry, packageRoot),
      { label: "Pack the npm tarball", argv: ["npm", "pack", "--loglevel", "warn"], cwd: packageRoot }
    ],
    outputs: [tarball],
    environment: sourceDateEnvironment(entry, commitTime),
    allowedRoots: [sourceRoot]
  };
}

const npmPacker = Object.freeze({
  id: "npm",
  label: "npm package",
  produces: Object.freeze(["npm tarball"]),
  buildRecipe,
  // After Stage 1: exactly one tarball whose package.json has the planned version.
  checkArtifacts: async ({ artifacts, version = null }) => {
    const files = artifacts.manifest.files.filter((file) => file.path.endsWith(".tgz"));
    if (files.length !== 1 || artifacts.manifest.files.length !== 1) {
      throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "An npm build must produce exactly one tarball.");
    }
    const manifest = npmTarballManifest(listNpmTarball(await readFile(path.join(artifacts.directory, "files", files[0].path))));
    if (version && manifest.version !== version) {
      throw publishError("VIBE64_PUBLISH_VERSION_MISMATCH", `The tarball is version ${manifest.version}, not ${version}.`);
    }
    return { packageName: manifest.name, version: manifest.version, files: [files[0].path] };
  },
  toolVersions: async ({ baseEnvironment = process.env } = {}) => ({
    node: process.versions.node,
    npm: await toolVersion(["npm", "--version"], baseEnvironment)
  })
});

export { npmPacker, npmTarballName };

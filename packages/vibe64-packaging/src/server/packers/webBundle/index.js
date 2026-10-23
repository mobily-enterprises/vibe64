// The web-bundle packer: the package's declared Prepare and Build argv with its
// build Environment, then its Output folder as a static client build. It is the
// Content of app packages (capacitor), built once per release and reused by each.
import path from "node:path";

import { publishError } from "../../errors.js";
import { recipeSteps, sourceDateEnvironment, toolVersion } from "../registryRecipe.js";

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// context: { sourceRoot: the exported saved commit, entry, commitTime }.
async function buildRecipe({ sourceRoot, entry, commitTime = null } = {}) {
  if (typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot)) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "The web-bundle packer needs the exported source folder.");
  }
  const output = path.join(sourceRoot, entry.output || "");
  if (!entry.output || !inside(sourceRoot, output)) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `Package ${entry.id} needs an Output folder inside the project.`);
  }
  return {
    steps: recipeSteps(entry, path.join(sourceRoot, entry.workdir || ".")),
    outputs: [output],
    environment: sourceDateEnvironment(entry, commitTime),
    allowedRoots: [sourceRoot]
  };
}

// The built folder: exactly one folder with an index.html at its top.
function webRoot(artifacts) {
  const files = artifacts.manifest.files.map((file) => file.path);
  const roots = [...new Set(files.map((file) => file.split("/")[0]))];
  if (roots.length !== 1 || !files.includes(`${roots[0]}/index.html`)) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "A web bundle must build one folder with an index.html at its top.");
  }
  return { name: roots[0], directory: path.join(artifacts.directory, "files", roots[0]) };
}

const webBundlePacker = Object.freeze({
  id: "web-bundle",
  label: "Static web bundle",
  produces: Object.freeze(["static client build"]),
  implemented: true,
  buildRecipe,
  checkArtifacts: async ({ artifacts }) => ({ root: webRoot(artifacts).name, files: artifacts.manifest.files.map((file) => file.path) }),
  toolVersions: async ({ baseEnvironment = process.env } = {}) => ({
    node: process.versions.node,
    npm: await toolVersion(["npm", "--version"], baseEnvironment)
  })
});

export { webBundlePacker, webRoot };

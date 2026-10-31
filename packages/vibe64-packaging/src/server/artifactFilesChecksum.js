import { artifactFiles, namedFilesChecksum } from "./destinations/registryCommon.js";

// The checksum of a release's artifact files by name, which a registry that
// stores several named files reports back.
function artifactFilesChecksum(artifacts) {
  return namedFilesChecksum(artifactFiles(artifacts));
}

export { artifactFilesChecksum };

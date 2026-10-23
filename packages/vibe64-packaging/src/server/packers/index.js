// Packers turn one declared package into unsigned artifacts. Each entry returns a
// Stage 1 recipe, `buildRecipe(context) -> { steps: [{ label, argv, cwd }], outputs: [path] }`,
// which runBuildStage executes without credentials.
import { publishError } from "../errors.js";
import { capacitorPacker } from "./capacitor/index.js";
import { npmPacker } from "./npm/index.js";
import { pythonDistPacker } from "./pythonDist/index.js";
import { webBundlePacker } from "./webBundle/index.js";

const VIBE64_PACKERS = Object.freeze(Object.fromEntries(
  [npmPacker, pythonDistPacker, webBundlePacker, capacitorPacker].map((packer) => [packer.id, packer])
));

function vibe64Packer(id) {
  const packer = VIBE64_PACKERS[id];
  if (!packer) throw publishError("VIBE64_PUBLISH_PACKER_UNKNOWN", `Unknown packer ${id}.`);
  return packer;
}

export { VIBE64_PACKERS, vibe64Packer };

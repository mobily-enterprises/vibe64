import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The recorder is preloaded into every Node.js process of the recorded target;
// the exec helper adds it with --import (see tracers/index.js). It needs no
// environment of its own beyond the three recording variables.
const NODE_PRELOAD_PATH = fileURLToPath(new URL("../../../runtime/node/preload.mjs", import.meta.url));

export default Object.freeze({
  runtime: "nodejs",
  label: "Node.js",
  prepare() {
    try {
      if (statSync(NODE_PRELOAD_PATH).isFile()) {
        return { available: true, environment: {}, prependEnvironment: {}, nodePreload: NODE_PRELOAD_PATH };
      }
    } catch {
      // Missing recorder files are reported below.
    }
    return { available: false, reason: "The Node.js recorder files are missing." };
  }
});

// Where each platform's build runs, per project: `<project runtime>/publishing/builders.json`.
// On this computer every build runs here; other builders arrive with their
// destinations.
import path from "node:path";

import { readJsonFile, writeJsonFile } from "./jsonFile.js";

const BUILDERS_CONTRACT = "vibe64.publishing-builders.v1";
const PLATFORMS = Object.freeze(["android", "packages"]);
const BUILDERS = Object.freeze(["this-computer"]);

function createBuilderMap({ runtimeRoot } = {}) {
  if (!path.isAbsolute(runtimeRoot || "")) throw new TypeError("The builder map needs the project's publishing folder.");
  const file = path.join(runtimeRoot, "builders.json");
  const defaults = () => Object.fromEntries(PLATFORMS.map((platform) => [platform, "this-computer"]));

  async function read() {
    const value = await readJsonFile(file, () => ({ contract: BUILDERS_CONTRACT, builders: defaults() }));
    return { ...defaults(), ...(value?.contract === BUILDERS_CONTRACT ? value.builders : {}) };
  }

  return Object.freeze({
    file,
    read,
    async set(platform, builder) {
      if (!PLATFORMS.includes(platform)) throw Object.assign(new Error(`Unknown platform ${platform}.`), { code: "vibe64_publishing_builder_invalid" });
      if (!BUILDERS.includes(builder)) throw Object.assign(new Error(`Builds for ${platform} run on this computer.`), { code: "vibe64_publishing_builder_invalid" });
      const builders = { ...await read(), [platform]: builder };
      await writeJsonFile(file, { contract: BUILDERS_CONTRACT, builders });
      return builders;
    }
  });
}

export { createBuilderMap };

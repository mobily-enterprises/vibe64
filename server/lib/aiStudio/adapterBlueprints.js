import { readFile } from "node:fs/promises";
import path from "node:path";

function createAdapterBlueprintReader(blueprintRoot) {
  const cache = new Map();

  return async function readAdapterBlueprint(section = "", value = "") {
    const cacheKey = `${section}/${value}`;
    if (!cache.has(cacheKey)) {
      cache.set(
        cacheKey,
        readFile(path.join(blueprintRoot, section, `${value}.txt`), "utf8")
      );
    }
    return cache.get(cacheKey);
  };
}

export {
  createAdapterBlueprintReader
};

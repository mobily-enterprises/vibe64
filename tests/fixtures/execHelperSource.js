import { readdir, readFile } from "node:fs/promises";

const EXEC_HELPER_URL = new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url);

// The privileged exec helper's whole source: its entry and every module beside
// it, in name order, so a check of one rule across the helper reads all of it.
async function execHelperSource() {
  const directory = new URL(".", EXEC_HELPER_URL);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".js")).sort();
  const sources = await Promise.all(names.map((name) => readFile(new URL(name, directory), "utf8")));
  return sources.join("\n");
}

export { execHelperSource };

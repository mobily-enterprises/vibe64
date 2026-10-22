import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

// Without managed browser runtimes, a project that does not declare Playwright
// (a Python, Ruby or Java application, say) uses the Playwright installed on
// this computer: the module behind the `playwright` command on PATH. The
// browser worker embeds this function, so it takes its dependencies explicitly.
function computerPlaywrightModulePath(searchPath = "", fs = { existsSync, realpathSync }, pathApi = path) {
  for (const directory of String(searchPath || "").split(pathApi.delimiter)) {
    if (!directory) continue;
    const command = pathApi.join(directory, "playwright");
    if (!fs.existsSync(command)) continue;
    let target = "";
    try {
      target = fs.realpathSync(command);
    } catch {
      continue;
    }
    const moduleRoot = pathApi.dirname(target);
    if (pathApi.basename(target) === "cli.js" && fs.existsSync(pathApi.join(moduleRoot, "package.json"))) {
      return moduleRoot;
    }
  }
  return "";
}

export { computerPlaywrightModulePath };

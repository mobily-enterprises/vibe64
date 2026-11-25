import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Without managed browser runtimes, a project that does not declare Playwright
 * (a Python, Ruby or Java application, say) uses the Playwright installed on
 * this computer: the module behind the `playwright` command on PATH. The
 * browser worker embeds this function (embeddedFunctions), so it uses nothing
 * but its arguments, its file system and path functions among them.
 * @param {string} searchPath
 * @param {{ existsSync: Function, realpathSync: Function }} fs
 * @param {typeof path} pathApi
 */
function playwrightModuleOnPath(searchPath, fs, pathApi) {
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

/** The Playwright module behind the `playwright` command on this PATH, or "" without one. */
function computerPlaywrightModulePath(searchPath = "") {
  return playwrightModuleOnPath(searchPath, { existsSync, realpathSync }, path);
}

export { computerPlaywrightModulePath, playwrightModuleOnPath };

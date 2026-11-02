import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function realCliPath(filePath, realpath) {
  const resolvedPath = path.resolve(String(filePath || ""));
  try {
    return realpath(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

/**
 * Whether this process was started by running entrypointPath itself,
 * directly or through a link to it.
 * @param {object} options
 * @param {string} options.entrypointPath
 * @param {string[]} [options.argv]
 * @param {(filePath: string) => string} [options.realpath]
 */
function isEntrypointExecution({ entrypointPath, argv = process.argv, realpath = realpathSync }) {
  const cliPath = argv[1];
  if (!cliPath) {
    return false;
  }
  return realCliPath(cliPath, realpath) === realCliPath(entrypointPath, realpath);
}

export { isEntrypointExecution };

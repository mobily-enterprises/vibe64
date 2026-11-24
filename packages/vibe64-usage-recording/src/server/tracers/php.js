import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

import { runtimePackBinPaths } from "@local/vibe64-execution/server";
import { PHP_USAGE_INI_NAME, phpUsageBuildCommand, phpUsageScanDirectory } from "../../../runtime/php/module.js";

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * On a host that supplies the runtimes (its runtime packs) a person cannot install PHP's development package, so the
 * module can be built only where the host's PHP pack has php-config.
 */
function hostPhpWithoutDevelopmentFiles() {
  const folders = runtimePackBinPaths("php");
  return folders.length > 0 && !folders.some((folder) => isFile(path.join(folder, "php-config")));
}

// The scan folder each PHP binary reads while PHP_INI_SCAN_DIR is unset, by the binary's path.
const ownScanFolders = new Map();

function phpOnPath(searchPath = "") {
  for (const directory of String(searchPath).split(path.delimiter)) {
    if (!directory) continue;
    try {
      accessSync(path.join(directory, "php"), constants.X_OK);
      return path.join(directory, "php");
    } catch {
      // Not in this directory.
    }
  }
  return "";
}

/**
 * What PHP_INI_SCAN_DIR stands for in a launch that sets none: the folder the
 * first php on the launch's PATH scans by itself, as `php --ini` names it with
 * the variable unset. That is PHP's compiled-in folder, or the one a wrapper
 * sets only while the variable is unset (Nix's php.withExtensions), which an
 * empty segment would not reach. Read once per binary; "" when php is not on
 * PATH or names none, so the trailing separator keeps the compiled-in folder.
 */
function unsetEnvironment(environment = {}) {
  const binary = phpOnPath(environment.PATH);
  if (binary && !ownScanFolders.has(binary)) {
    const unset = { ...environment };
    delete unset.PHP_INI_SCAN_DIR;
    const answer = spawnSync(binary, ["--ini"], { encoding: "utf8", env: unset, timeout: 10_000 });
    if (answer.status === 0) {
      const named = /^Scan for additional \.ini files in:[ \t]*(.*)$/mu.exec(answer.stdout)?.[1].trim() || "";
      // PHP 8.5 quotes the folder.
      const folder = /^"(.*)"$/u.exec(named)?.[1] ?? named;
      ownScanFolders.set(binary, folder === "(none)" ? "" : folder);
    }
  }
  return { PHP_INI_SCAN_DIR: ownScanFolders.get(binary) || "" };
}

/**
 * PHP records through a small extension (runtime/php/ext) built once per PHP
 * API version by runtime/php/build.mjs. A recorded process loads it from a
 * scan directory prepended to PHP_INI_SCAN_DIR; see tracers/index.js.
 */
function prepare() {
  const scanDirectory = phpUsageScanDirectory();
  if (scanDirectory.includes(path.delimiter)) {
    return {
      available: false,
      reason: `PHP recording cannot use a module folder whose path contains "${path.delimiter}": ${scanDirectory}`
    };
  }
  if (isFile(path.join(scanDirectory, PHP_USAGE_INI_NAME))) {
    // What follows the trailing separator is the launch's own value, or
    // unsetEnvironment's folder when it sets none: the extensions PHP is
    // installed with keep loading.
    return { available: true, environment: {}, prependEnvironment: { PHP_INI_SCAN_DIR: `${scanDirectory}${path.delimiter}` } };
  }
  if (hostPhpWithoutDevelopmentFiles()) {
    return {
      available: false,
      reason: "PHP usage recording isn't available on this workspace yet: its PHP comes without the development files " +
        "(phpize and php-config) the recording module is built with."
    };
  }
  return {
    available: false,
    reason: `PHP recording needs its module built for this computer's PHP. Run \`${phpUsageBuildCommand()}\`; it needs phpize and php-config from your PHP's development package (for example php8.3-dev), make and a C compiler.`
  };
}

export default Object.freeze({
  runtime: "php",
  label: "PHP",
  prepare,
  unsetEnvironment
});

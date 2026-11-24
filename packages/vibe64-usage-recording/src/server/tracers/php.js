import { accessSync, closeSync, constants, fstatSync, openSync, readSync, statSync } from "node:fs";
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

function isDirectory(folder) {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

// Nix's wrappers are small (its binary wrapper about 16 KB, its shell wrapper under 1 KB); PHP itself is megabytes and
// is never read.
const WRAPPER_MAX_BYTES = 1024 * 1024;
// The folder a Nix wrapper (php.withExtensions) gives PHP_INI_SCAN_DIR only while it is unset, exactly as its two
// wrapper makers write --set-default: makeBinaryWrapper's setenv("PHP_INI_SCAN_DIR", "<folder>", 0), and
// makeShellWrapper's whole line export PHP_INI_SCAN_DIR=${PHP_INI_SCAN_DIR-'<folder>'}, single-quoted by bash's @Q
// as every makeWrapper since --set-default (2017) writes it.
const WRAPPER_SCAN_FOLDER = Object.freeze([
  /setenv\("PHP_INI_SCAN_DIR", "([^"\0\n]+)", 0\)/u,
  /^export PHP_INI_SCAN_DIR=\$\{PHP_INI_SCAN_DIR-'([^'\0\n]+)'\}$/mu
]);

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
 * The scan folder a PHP wrapper declares, read from the wrapper, which never runs: only a regular file of at most
 * WRAPPER_MAX_BYTES is read, opened without blocking so a FIFO or device named php holds nothing up, and only an
 * absolute folder that exists, in one of the two forms, is answered. "" for anything else; nothing read goes further.
 */
function wrapperScanFolder(binary) {
  if (!isFile(binary)) return "";
  let descriptor = -1;
  try {
    descriptor = openSync(binary, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size === 0 || stats.size > WRAPPER_MAX_BYTES) return "";
    const bytes = Buffer.alloc(stats.size);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(descriptor, bytes, length, bytes.length - length, length);
      if (read === 0) break;
      length += read;
    }
    const text = bytes.toString("utf8", 0, length);
    const folder = WRAPPER_SCAN_FOLDER.map((pattern) => pattern.exec(text)?.[1]).find(Boolean) || "";
    return path.isAbsolute(folder) && !folder.includes(path.delimiter) && isDirectory(folder) ? folder : "";
  } catch {
    return "";
  } finally {
    if (descriptor >= 0) closeSync(descriptor);
  }
}

/**
 * What PHP_INI_SCAN_DIR stands for in a launch that sets none: the folder the
 * first php on the environment's PATH gives itself while the variable is unset,
 * which an empty segment would not reach. That is the folder a Nix
 * php.withExtensions wrapper declares, read from the wrapper without running
 * anything; for any other PHP "", so the trailing separator keeps its
 * compiled-in folder. The recording service passes the launch's own resolved
 * environment, so this is the php the launch runs.
 */
function unsetEnvironment(environment = {}) {
  const binary = phpOnPath(environment.PATH);
  return { PHP_INI_SCAN_DIR: binary ? wrapperScanFolder(binary) : "" };
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

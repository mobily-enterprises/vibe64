import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where the PHP usage recorder module is built and found. The build command
// (build.mjs) writes here; the PHP tracer only checks that the result exists.
//
// <cache>/modules/<php api>-<source hash>/vibe64_usage.so  one per PHP API version
// <cache>/scan/<source hash>/vibe64-usage.ini              loads the latest build
//
// A recorded process gets the scan directory prepended to PHP_INI_SCAN_DIR, so
// the module loads only there, never through a global PHP setting.
const PHP_RUNTIME_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PHP_EXTENSION_DIRECTORY = path.join(PHP_RUNTIME_DIRECTORY, "ext");
const PHP_EXTENSION_SOURCES = Object.freeze(["config.m4", "vibe64_usage.c"]);
const PHP_USAGE_BUILD_SCRIPT = path.join(PHP_RUNTIME_DIRECTORY, "build.mjs");
const PHP_USAGE_INI_NAME = "vibe64-usage.ini";
const PHP_USAGE_MODULE_NAME = "vibe64_usage.so";
// Overrides the cache location, for a machine that builds the module once for
// every user of its PHP.
const PHP_USAGE_MODULE_CACHE_VARIABLE = "VIBE64_USAGE_PHP_MODULE_CACHE";

let extensionSourceHash = "";

function phpExtensionSourceHash() {
  if (!extensionSourceHash) {
    const hash = createHash("sha256");
    for (const name of PHP_EXTENSION_SOURCES) {
      hash.update(`${name}\0`).update(readFileSync(path.join(PHP_EXTENSION_DIRECTORY, name))).update("\0");
    }
    extensionSourceHash = hash.digest("hex").slice(0, 16);
  }
  return extensionSourceHash;
}

function phpUsageModuleCache(env = process.env) {
  const configured = String(env[PHP_USAGE_MODULE_CACHE_VARIABLE] || "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  const cacheHome = String(env.XDG_CACHE_HOME || "").trim() || path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "vibe64", "usage-recording", "php");
}

function phpUsageScanDirectory(env = process.env) {
  return path.join(phpUsageModuleCache(env), "scan", phpExtensionSourceHash());
}

function phpUsageModulePath(phpApi, env = process.env) {
  return path.join(phpUsageModuleCache(env), "modules", `${phpApi}-${phpExtensionSourceHash()}`, PHP_USAGE_MODULE_NAME);
}

function phpUsageBuildCommand() {
  const script = /^[\w./-]+$/u.test(PHP_USAGE_BUILD_SCRIPT) ? PHP_USAGE_BUILD_SCRIPT : `'${PHP_USAGE_BUILD_SCRIPT.replaceAll("'", "'\\''")}'`;
  return `node ${script}`;
}

export {
  PHP_EXTENSION_DIRECTORY,
  PHP_EXTENSION_SOURCES,
  PHP_USAGE_INI_NAME,
  PHP_USAGE_MODULE_CACHE_VARIABLE,
  PHP_USAGE_MODULE_NAME,
  phpExtensionSourceHash,
  phpUsageBuildCommand,
  phpUsageModuleCache,
  phpUsageModulePath,
  phpUsageScanDirectory
};

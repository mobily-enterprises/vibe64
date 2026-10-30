import { statSync } from "node:fs";
import path from "node:path";

import { PHP_USAGE_INI_NAME, phpUsageBuildCommand, phpUsageScanDirectory } from "../../../runtime/php/module.js";

// PHP records through a small extension (runtime/php/ext) built once per PHP
// API version by runtime/php/build.mjs. A recorded process loads it from a
// scan directory prepended to PHP_INI_SCAN_DIR; see tracers/index.js.
function prepare() {
  const scanDirectory = phpUsageScanDirectory();
  if (scanDirectory.includes(path.delimiter)) {
    return { available: false, reason: `PHP recording cannot use a module folder whose path contains "${path.delimiter}": ${scanDirectory}` };
  }
  try {
    if (statSync(path.join(scanDirectory, PHP_USAGE_INI_NAME)).isFile()) {
      // The trailing separator keeps PHP's own scan directory, and with it the
      // extensions PHP is installed with, when nothing else is set.
      return { available: true, environment: {}, prependEnvironment: { PHP_INI_SCAN_DIR: `${scanDirectory}${path.delimiter}` } };
    }
  } catch {
    // Not built yet.
  }
  return {
    available: false,
    reason: `PHP recording needs its module built for this computer's PHP. Run \`${phpUsageBuildCommand()}\`; it needs phpize and php-config from your PHP's development package (for example php8.3-dev), make and a C compiler.`
  };
}

export default Object.freeze({
  runtime: "php",
  label: "PHP",
  prepare
});

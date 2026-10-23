// Recipe pieces shared by the registry packers (npm, python-dist).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { publishError } from "../errors.js";
import { BUILD_ENVIRONMENT_PASSTHROUGH } from "../stages.js";

const run = promisify(execFile);

// The package's declared Prepare then Build argv, run in its Workdir.
function recipeSteps(entry, packageRoot) {
  return [...entry.prepare, ...entry.build].map((step) => ({ label: step.label, argv: [...step.argv], cwd: packageRoot }));
}

// The declared build Environment, plus SOURCE_DATE_EPOCH (the saved commit's time)
// so tools that honour it write reproducible archives.
function sourceDateEnvironment(entry, commitTime) {
  const environment = entry.environment.map((item) => ({ ...item }));
  if (commitTime !== null && commitTime !== undefined && !environment.some((item) => item.name === "SOURCE_DATE_EPOCH")) {
    if (!Number.isInteger(commitTime) || commitTime < 0) throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "The commit time must be whole seconds.");
    environment.push({ name: "SOURCE_DATE_EPOCH", value: String(commitTime) });
  }
  return environment;
}

// A tool's version for the plan's toolchain record, or "missing".
async function toolVersion(argv, baseEnvironment = process.env) {
  const env = Object.fromEntries(BUILD_ENVIRONMENT_PASSTHROUGH
    .filter((name) => typeof baseEnvironment[name] === "string")
    .map((name) => [name, baseEnvironment[name]]));
  try {
    const { stdout, stderr } = await run(argv[0], argv.slice(1), { env, timeout: 30_000 });
    const match = /(\d+\.\d+(?:\.\d+)?(?:[0-9A-Za-z.+_-]*)?)/u.exec(`${stdout} ${stderr}`);
    return match ? match[1] : "unknown";
  } catch {
    return "missing";
  }
}

export { recipeSteps, sourceDateEnvironment, toolVersion };

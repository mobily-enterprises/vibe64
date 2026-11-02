// Recipe pieces shared by the registry packers (npm, python-dist).
import { publishError } from "../errors.js";

/**
 * The package's declared Prepare then Build argv, run in its Workdir.
 */
function recipeSteps(entry, packageRoot) {
  return [...entry.prepare, ...entry.build].map((step) => ({ label: step.label, argv: [...step.argv], cwd: packageRoot }));
}

/**
 * The declared build Environment, plus SOURCE_DATE_EPOCH (the saved commit's time)
 * so tools that honour it write reproducible archives.
 */
function sourceDateEnvironment(entry, commitTime) {
  const environment = entry.environment.map((item) => ({ ...item }));
  if (commitTime !== null && commitTime !== undefined && !environment.some((item) => item.name === "SOURCE_DATE_EPOCH")) {
    if (!Number.isInteger(commitTime) || commitTime < 0) {
      throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "The commit time must be whole seconds.");
    }
    environment.push({ name: "SOURCE_DATE_EPOCH", value: String(commitTime) });
  }
  return environment;
}

export { recipeSteps, sourceDateEnvironment };

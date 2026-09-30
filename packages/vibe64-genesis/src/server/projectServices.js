import {
  invalidStackOperation, isExplicitlyEmptyStackSection, processArguments,
  projectPath, runtimeArguments, stackOperationHash
} from "./stackOperation.js";

const VIBE64_PROJECT_SERVICES_SECTION = "Project services";
const VIBE64_PROJECT_SERVICES_CONTRACT = "vibe64.project-services.v1";
const CODE = "VIBE64_PROJECT_SERVICES_INVALID";
const LOCATION = "genesis/stack.md#Project services";

function parseVibe64ProjectServicesLines(lines) {
  if (!Array.isArray(lines)) invalidStackOperation(CODE, LOCATION, "Expected exact Project services section lines.");
  if (isExplicitlyEmptyStackSection(lines)) return [];
  const services = [];
  for (const [index, text] of lines.entries()) {
    const source = text.trim();
    if (!source) continue;
    const line = index + 1;
    const match = source.match(/^- Start `([a-z][a-z0-9-]{0,63})` with (.+?): (.+)$/u);
    if (!match) invalidStackOperation(CODE, LOCATION,
      "Use: - Start `service-id` with `runtime` [in `workdir`]: `command` `argument`...", line);
    if (services.some(({ id }) => id === match[1])) invalidStackOperation(CODE, LOCATION, "Duplicate project service id.", line);
    const workdir = match[2].match(/^(.*?) in `([^`\r\n]+)`$/u);
    services.push({
      id: match[1],
      runtimeRequirements: runtimeArguments(workdir ? workdir[1] : match[2], CODE, LOCATION, "Service runtimes", line),
      workdir: projectPath(workdir?.[2] || ".", CODE, LOCATION, "Service workdir", line),
      argv: processArguments(match[3], CODE, LOCATION, "Service command", line)
    });
  }
  if (!services.length) invalidStackOperation(CODE, LOCATION, "Declare a service or exactly `- Nothing.`.");
  return services;
}

function vibe64ProjectServicesInspection(section = {}) {
  const services = section.status === "ready" ? parseVibe64ProjectServicesLines(section.lines) : [];
  return {
    contract: VIBE64_PROJECT_SERVICES_CONTRACT,
    status: section.status === "blocked" ? "blocked" : services.length ? "ready" : "unconfigured",
    services,
    recipeHash: services.length ? stackOperationHash(services) : "",
    diagnostics: section.diagnostics || []
  };
}

export { VIBE64_PROJECT_SERVICES_SECTION, VIBE64_PROJECT_SERVICES_CONTRACT,
  parseVibe64ProjectServicesLines, vibe64ProjectServicesInspection };

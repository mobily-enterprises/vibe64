import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inspectGenesisEnvironment,
  inspectGenesisProject,
  inspectGenesisSkills,
  inspectGenesisStackComponents,
  inspectVibe64ArchitectureInspection,
  inspectVibe64ArchitectureLayout,
  inspectVibe64ConnectedDevelopment,
  inspectVibe64Deployment,
  inspectVibe64IntegrationSetup,
  inspectVibe64Outputs,
  inspectVibe64Packaging,
  inspectVibe64ProjectServices,
  inspectVibe64ResourceEstimates,
  inspectVibe64WorkspaceSetup
} from "@local/vibe64-genesis/server";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Every operation section of this repository's own Stack holds only its grammar's lines: a prose paragraph under
// one of them would refuse every chat message in this project.
test("Vibe64's own genesis/stack.md parses for Genesis and for every operation section Vibe64 reads", async () => {
  const stack = await readFile(path.join(projectRoot, "genesis/stack.md"), "utf8");
  assert.match(stack, /^## Verification$/mu);
  const options = { projectRoot };
  // The chat preparation path reads the whole Stack through Genesis's skills inspection.
  await inspectGenesisSkills(options);
  await inspectGenesisProject(options);
  await inspectGenesisEnvironment(options);
  await inspectGenesisStackComponents(options);
  for (const [section, inspect] of Object.entries({
    "Architecture inspection": inspectVibe64ArchitectureInspection,
    "Architecture layout": inspectVibe64ArchitectureLayout,
    "Connected development": inspectVibe64ConnectedDevelopment,
    Deployment: inspectVibe64Deployment,
    "Integration setup": inspectVibe64IntegrationSetup,
    Outputs: inspectVibe64Outputs,
    Packaging: inspectVibe64Packaging,
    "Project services": inspectVibe64ProjectServices,
    "Resource estimates": inspectVibe64ResourceEstimates,
    "Workspace setup": inspectVibe64WorkspaceSetup
  })) {
    const inspection = await inspect(options);
    assert.notEqual(inspection.status, "blocked", `${section}: ${JSON.stringify(inspection.diagnostics)}`);
    assert.deepEqual(inspection.diagnostics ?? [], [], section);
  }
});

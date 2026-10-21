import assert from "node:assert/strict";
import test from "node:test";

import { VIBE64_AGENT_SPECS, runAgentSpecCli } from "../../server/lib/agentSpecCli.js";
import { DEPLOYMENT_ENTRY_FORMS, parseVibe64DeploymentLines } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { ARCHITECTURE_INSPECTOR_FIELDS, parseVibe64ArchitectureInspectionLines } from "../../packages/vibe64-genesis/src/server/architectureInspection.js";
import { parseVibe64ArchitectureLayoutLines } from "../../packages/vibe64-genesis/src/server/architectureLayout.js";
import {
  CONNECTED_DEVELOPMENT_ENTRY_FORMS,
  vibe64ConnectedDevelopmentInspection
} from "../../packages/vibe64-genesis/src/server/connectedDevelopment.js";
import { parseVibe64IntegrationSetupLines } from "../../packages/vibe64-genesis/src/server/integrationSetup.js";
import { OUTPUTS_ENTRY_FORMS, parseVibe64OutputsLines } from "../../packages/vibe64-genesis/src/server/outputs.js";
import { parseVibe64ProjectServicesLines } from "../../packages/vibe64-genesis/src/server/projectServices.js";
import {
  VIBE64_RESOURCE_ESTIMATE_FIELDS,
  parseVibe64ResourceEstimatesLines
} from "../../packages/vibe64-genesis/src/server/resourceEstimates.js";
import { SPEC_BY_ERROR_CODE } from "../../packages/vibe64-genesis/src/server/stackOperation.js";
import { parseVibe64WorkspaceSetupLines } from "../../packages/vibe64-genesis/src/server/workspaceSetup.js";
import { PREVIEW_APPLICATION_IDENTITY_LIMIT } from "../../packages/vibe64-core/src/server/previewAuth.js";
import { normalizePreviewIdentityCommandResponse } from "../../packages/vibe64-terminals/src/server/previewIdentityCommand.js";

// Each Stack section spec's printed example must parse with its real parser.
const SECTION_PARSERS = {
  "workspace-setup": (lines) => parseVibe64WorkspaceSetupLines(lines),
  outputs: (lines) => parseVibe64OutputsLines(lines),
  deployment: (lines) => parseVibe64DeploymentLines(lines),
  "resource-estimates": (lines) => parseVibe64ResourceEstimatesLines(lines, {
    targets: [{ id: "app", mode: "interactive" }],
    hasWorkspaceSetup: true
  }),
  "connected-development": (lines) => {
    const inspection = vibe64ConnectedDevelopmentInspection({ status: "ready", lines });
    assert.equal(inspection.status, "ready");
    return inspection;
  },
  "project-services": (lines) => parseVibe64ProjectServicesLines(lines),
  "integration-setup": (lines) => parseVibe64IntegrationSetupLines(lines),
  "architecture-inspection": (lines) => parseVibe64ArchitectureInspectionLines(lines),
  "architecture-layout": (lines) => parseVibe64ArchitectureLayoutLines(lines)
};

async function cli(args) {
  const out = [];
  const err = [];
  const code = await runAgentSpecCli(args, { write: (text) => out.push(text), writeError: (text) => err.push(text) });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

function fencedBlocks(text, language) {
  return [...text.matchAll(new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\\n\`\`\``, "gu"))].map((match) => match[1]);
}

test("spec lists every contract, prints one by name and rejects unknown names", async () => {
  const names = VIBE64_AGENT_SPECS.map(({ name }) => name);
  assert.equal(new Set(names).size, names.length);
  for (const args of [[], ["--help"], ["-h"]]) {
    const listed = await cli(args);
    assert.equal(listed.code, 0);
    for (const name of names) assert.match(listed.stdout, new RegExp(`^  ${name} +\\S`, "mu"));
  }
  for (const name of names) {
    const printed = await cli([name]);
    assert.equal(printed.code, 0, name);
    assert.ok(printed.stdout.trim().startsWith("#"), name);
  }
  for (const args of [["unknown"], ["outputs", "extra"]]) {
    const unknown = await cli(args);
    assert.equal(unknown.code, 2);
    assert.equal(unknown.stdout, "");
    assert.match(unknown.stderr, /Unknown Vibe64 spec/u);
    assert.match(unknown.stderr, / {2}workspace-setup +Workspace setup/u);
  }
  for (const name of ["integration-setup-command", "integration-payments-laravel", "training-content"]) {
    assert.ok((await cli([name])).stdout.length > 1000, name);
  }
});

test("every Stack section spec example parses with its real parser", async () => {
  const sectionSpecs = VIBE64_AGENT_SPECS.filter(({ section }) => section);
  assert.deepEqual(sectionSpecs.map(({ name }) => name).sort(), Object.keys(SECTION_PARSERS).sort());
  for (const spec of sectionSpecs) {
    const [example] = fencedBlocks((await cli([spec.name])).stdout, "markdown");
    const [heading, ...lines] = example.split("\n");
    assert.equal(heading, `## ${spec.section}`);
    assert.ok(SECTION_PARSERS[spec.name](lines), spec.name);
  }
});

test("printed entry forms are the parsers' own tables, and unknown entries list them", async () => {
  const outputs = (await cli(["outputs"])).stdout;
  for (const form of Object.values(OUTPUTS_ENTRY_FORMS).flat()) assert.ok(outputs.includes(form), form);
  assert.throws(
    () => parseVibe64OutputsLines(["### Target `app`: App", "- Mode: `interactive`", "#### Preview identity", "- Owner: `x`"]),
    (error) => OUTPUTS_ENTRY_FORMS.previewIdentity.every((form) => error.message.includes(form))
  );
  const deployment = (await cli(["deployment"])).stdout;
  for (const form of DEPLOYMENT_ENTRY_FORMS) assert.ok(deployment.includes(form), form);
  assert.throws(
    () => parseVibe64DeploymentLines(["- Restart `x`: `y`"]),
    (error) => DEPLOYMENT_ENTRY_FORMS.every((form) => error.message.includes(form))
  );
  const connected = (await cli(["connected-development"])).stdout;
  for (const form of CONNECTED_DEVELOPMENT_ENTRY_FORMS) assert.ok(connected.includes(form), form);
  const estimates = (await cli(["resource-estimates"])).stdout;
  for (const field of VIBE64_RESOURCE_ESTIMATE_FIELDS.keys()) assert.ok(estimates.includes(`- ${field}: `), field);
  const inspection = (await cli(["architecture-inspection"])).stdout;
  for (const field of Object.keys(ARCHITECTURE_INSPECTOR_FIELDS)) assert.ok(inspection.includes(`- ${field}: `), field);
  const identities = (await cli(["preview-identities"])).stdout;
  assert.match(identities, new RegExp(`At most ${PREVIEW_APPLICATION_IDENTITY_LIMIT} entries`, "u"));
  assert.match(identities, /vibe64-helper preview identities save < identities\.json/u);
  assert.match(identities, /Never create application accounts or change roles/u);
});

test("the Preview identity protocol examples satisfy the real response validation", async () => {
  const [request, ...responses] = fencedBlocks((await cli(["preview-identity-command"])).stdout, "json").map((block) => JSON.parse(block));
  assert.equal(responses.length, 2);
  assert.equal(request.subject.kind, "selector");
  const [accepted, rejected] = responses.map((response) => normalizePreviewIdentityCommandResponse(response, {
    operation: request.operation,
    requestId: request.requestId
  }));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.identity.email, "admin@example.com");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.statusCode, 404);
});

test("every Vibe64 section error points to its listed spec, including wrapped errors", () => {
  const names = new Set(VIBE64_AGENT_SPECS.map(({ name }) => name));
  for (const name of Object.values(SPEC_BY_ERROR_CODE)) assert.ok(names.has(name), name);
  const invalid = {
    "workspace-setup": () => parseVibe64WorkspaceSetupLines(["- Run `x`"]),
    outputs: () => parseVibe64OutputsLines(["- Mode: `interactive`"]),
    deployment: () => parseVibe64DeploymentLines(["- Unknown."]),
    "resource-estimates": () => parseVibe64ResourceEstimatesLines(["- Typical MiB: `1`"]),
    "connected-development": () => vibe64ConnectedDevelopmentInspection({
      status: "ready",
      lines: ["- Sources file: `sources.json`", "- Verify `Check` with `node js`: `npm` `test`"]
    }),
    "project-services": () => parseVibe64ProjectServicesLines(["- Run `x`"]),
    "integration-setup": () => parseVibe64IntegrationSetupLines(["- Run `x`"]),
    "architecture-inspection": () => parseVibe64ArchitectureInspectionLines(["- Runtime: `nodejs`"]),
    "architecture-layout": () => parseVibe64ArchitectureLayoutLines(["- Kind: `layer`"])
  };
  for (const [name, parse] of Object.entries(invalid)) {
    assert.throws(parse, (error) => error.message.endsWith(` Exact grammar: vibe64-helper spec ${name}.`)
      && error.message.split("Exact grammar").length === 2, name);
  }
});

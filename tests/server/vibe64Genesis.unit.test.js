import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { codexRuntimeContext } from "@local/studio-terminal-core/server/codexRuntimeContext";
import {
  GENESIS_DERIVED_ARTIFACT_PATHS,
  addGenesisStack,
  assertGenesisPromptTask,
  composeVibe64SessionContext,
  genesisCommandShimDirectory,
  genesisPackageBinDirectory,
  genesisPromptRequest,
  genesisPromptTask,
  initializeGenesisProject,
  inspectGenesisCollaboration,
  inspectGenesisDerivedArtifacts,
  inspectGenesisEngineering,
  inspectGenesisEnvironment,
  inspectGenesisProjectFormat,
  inspectVibe64Outputs,
  inspectVibe64WorkspaceSetup,
  inspectVibe64Deployment,
  parseVibe64DeploymentLines,
  parseVibe64OutputsLines,
  parseVibe64WorkspaceSetupLines,
  renderGenesisPrompt,
  setGenesisCollaboration,
  setGenesisEngineeringProfile,
  vibe64Driver,
  withGenesisCommandShim
} from "../../packages/vibe64-genesis/src/server/index.js";
import {
  vibe64DriverInputFromRegistry
} from "../../packages/vibe64-genesis/src/server/promptContext.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function initializeGit(projectRoot) {
  await execFileAsync("git", ["init", "--initial-branch=main"], {
    cwd: projectRoot
  });
}

test("Genesis inspection never falls back to the server working directory", async () => {
  await assert.rejects(
    () => inspectGenesisEnvironment({}),
    /explicit absolute projectRoot/u
  );
  await assert.rejects(
    () => inspectGenesisEnvironment({ projectRoot: "relative-project" }),
    /explicit absolute projectRoot/u
  );
  await assert.rejects(
    () => inspectGenesisProjectFormat({}),
    /explicit absolute projectRoot/u
  );
});

test("Genesis project-format inspection identifies a migratable unversioned project", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await rm(path.join(projectRoot, "genesis", "version"));

    const projectFormat = await inspectGenesisProjectFormat({ projectRoot });

    assert.equal(projectFormat.status, "unversioned");
    assert.equal(projectFormat.action, "migrate");
    assert.equal(projectFormat.projectVersion, null);
    assert.equal(projectFormat.supportedVersion, 3);
  });
});

test("the Genesis boundary reads a shared session checkout without granting unrelated compiler calls trust", {
  skip: process.platform === "win32"
}, async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await addGenesisStack({ projectRoot, pieces: ["jskit-mysql"] });
    const { stdout } = await execFileAsync("which", ["git"]);
    const realGit = stdout.trim();
    const bin = path.join(projectRoot, "test-bin");
    await mkdir(bin);
    const wrapper = path.join(bin, "git");
    await writeFile(wrapper, `#!/bin/sh\nexport GIT_TEST_ASSUME_DIFFERENT_OWNER=1\nexec '${realGit.replaceAll("'", "'\\''")}' "$@"\n`);
    await chmod(wrapper, 0o755);
    const boundary = new URL("../../packages/vibe64-genesis/src/server/index.js", import.meta.url).href;
    await execFileAsync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { inspectEnvironment } from "genesis-compiler";
      import { inspectGenesisEnvironment, inspectGenesisProjectFormat, inspectVibe64Outputs } from ${JSON.stringify(boundary)};
      const projectRoot = ${JSON.stringify(projectRoot)};
      await assert.rejects(inspectEnvironment({ projectRoot }), { code: "GIT_REPOSITORY_UNTRUSTED" });
      const [environment, format, outputs] = await Promise.all([
        inspectGenesisEnvironment({ projectRoot }),
        inspectGenesisProjectFormat({ projectRoot }),
        inspectVibe64Outputs({ projectRoot })
      ]);
      assert.equal(environment.resources[0].resource.kind, "mysql");
      assert.equal(format.status, "current");
      assert.ok(outputs.contract);
      await assert.rejects(inspectEnvironment({ projectRoot }), { code: "GIT_REPOSITORY_UNTRUSTED" });
    `], { env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
  });
});

test("the Genesis integration maps Vibe actions to explicit Genesis tasks and requests", () => {
  assert.equal(genesisPromptTask({ genesisTask: "program" }), "program");
  assert.equal(genesisPromptTask({ genesisTask: "adopt" }), "adopt");
  assert.equal(genesisPromptTask({ genesisTask: "deslop", promptId: "anything" }), "deslop");
  assert.equal(genesisPromptTask({ promptId: "obsolete-prompt-id" }), "work");
  assert.equal(genesisPromptTask({ promptId: "unknown" }), "work");
  assert.equal(assertGenesisPromptTask("review", { required: true }), "review");
  assert.throws(
    () => genesisPromptTask({ genesisTask: "deslopp" }),
    /Unknown Genesis prompt task: deslopp/u
  );
  assert.throws(
    () => assertGenesisPromptTask("", { required: true }),
    /require an explicit task/u
  );
  assert.equal(genesisPromptRequest({ conversationRequest: "  Build it.  " }), "Build it.");
  assert.equal(genesisPromptRequest({}, { label: "Inspect this" }), "Inspect this");
});

test("the Vibe64 driver contributes stable session rules and no turn context", () => {
  const session = vibe64Driver({
    conversationKind: "main",
    scope: "session",
    session: {
      managedDatabaseRefresh: true,
      managedEnvironment: true,
      managedGit: true,
      managedPreview: true
    }
  });

  assert.match(session, /no more than three concise/u);
  assert.match(session, /`\[1\] Question`/u);
  assert.match(session, /`Possible answers:`/u);
  assert.match(session, /vibe64-preview status/u);
  assert.match(session, /vibe64-env status/u);
  assert.match(session, /vibe64-database refresh/u);
  assert.match(session, /data-overview\.json/u);
  assert.match(session, /vibe64-database overview --json/u);
  assert.match(session, /Preserve authored groupings, classify new tables/u);
  assert.doesNotMatch(session, /tone|response length|policy revision|actor id|do not reveal/iu);
  assert.throws(
    () => vibe64Driver({
      scope: "turn"
    }),
    /session and ephemeral scopes only/u
  );
});

test("Genesis initialization creates its complete technology-neutral project", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);

    const result = await initializeGenesisProject({ projectRoot });

    assert.equal(result.status, "updated");
    assert.equal(await readFile(path.join(projectRoot, "genesis", "version"), "utf8"), "3\n");
    assert.match(await readFile(path.join(projectRoot, "genesis", "blueprint.md"), "utf8"), /# Blueprint/u);
    assert.match(await readFile(path.join(projectRoot, "genesis", "collaboration.md"), "utf8"), /# Collaboration approach/u);
    assert.match(await readFile(path.join(projectRoot, "genesis", "engineering.md"), "utf8"), /focused\.v1/u);
    assert.match(await readFile(path.join(projectRoot, "genesis", "stack.md"), "utf8"), /# Stack/u);
    const hooks = JSON.parse(await readFile(path.join(projectRoot, ".codex", "hooks.json"), "utf8"));
    assert.deepEqual(Object.keys(hooks.hooks), ["SessionStart", "UserPromptSubmit"]);
    assert.match(
      await readFile(
        path.join(projectRoot, ".opencode", "plugins", "genesis-project-guidance.js"),
        "utf8"
      ),
      /session\.compacted/u
    );
    assert.ok(JSON.parse(await readFile(path.join(projectRoot, ".genesis", "machine-city.json"), "utf8")));
    assert.ok(JSON.parse(await readFile(path.join(projectRoot, ".genesis", "program-city.json"), "utf8")));
  });
});

test("the Genesis boundary composes source-owned collaboration once with Vibe64 session context", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    const initial = await inspectGenesisCollaboration({ projectRoot });
    await setGenesisCollaboration({
      experience: "expert",
      explanationStyle: "conclusions",
      projectRoot,
      requirements: "- Use Australian English.",
      responseLength: "very_short",
      tone: "direct"
    });
    const composed = await composeVibe64SessionContext({
      conversationKind: "temporary-readonly",
      projectRoot,
      session: {
        managedDatabaseRefresh: true,
        managedEnvironment: true,
        managedGit: true,
        managedPreview: true
      }
    });

    assert.equal(initial.contract, "genesis.collaboration.v1");
    assert.equal(composed.contract, "genesis.session-context.v1");
    assert.match(composed.output, /Be direct, calm, and matter-of-fact\./u);
    assert.match(composed.output, /Assume the user is an expert/u);
    assert.match(composed.output, /Use very short sentences/u);
    assert.match(composed.output, /including progress updates and final responses/u);
    assert.match(composed.output, /Use Australian English\./u);
    assert.match(composed.output, /temporary conversation separate from the main conversation/u);
    assert.doesNotMatch(composed.output, /vibe64-env set|vibe64-database refresh/u);
  });
});

test("Vibe64 uses configured beginner detail for main and temporary task progress", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await setGenesisCollaboration({
      experience: "beginner",
      explanationStyle: "teaching",
      projectRoot,
      responseLength: "detailed"
    });
    for (const conversationKind of ["main", "temporary-task"]) {
      const composed = await composeVibe64SessionContext({
        conversationKind,
        projectRoot,
        session: {
          managedDatabaseRefresh: false,
          managedEnvironment: false,
          managedGit: false,
          managedPreview: false
        }
      });
      assert.match(composed.output, /Assume the user is new to software development/u);
      assert.match(composed.output, /Give thorough, structured explanations/u);
      assert.match(composed.output, /teaching-oriented way/u);
      assert.match(composed.output, /including progress updates and final responses/u);
      assert.doesNotMatch(composed.output, /Keep interim progress updates brief/u);
    }
  });
});

test("the host resolver maps one provider session to the normalized Vibe64 driver input", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    const registryPath = path.join(projectRoot, "context-registry.json");
    const promptContext = {
      conversationKind: "main",
      scope: "session",
      session: {
        managedDatabaseRefresh: true,
        managedEnvironment: true,
        managedGit: true,
        managedPreview: true
      }
    };
    await writeFile(registryPath, `${JSON.stringify({
      sessions: [{
        promptContext,
        upstreamSessionId: "provider-session-1",
        workdir: projectRoot
      }]
    })}\n`, "utf8");

    assert.deepEqual(await vibe64DriverInputFromRegistry({
      data: { registryPath },
      providerSessionId: "provider-session-1",
      scope: "session"
    }), promptContext);
    assert.equal(await vibe64DriverInputFromRegistry({
      data: { registryPath },
      providerSessionId: "provider-session-1",
      scope: "turn"
    }), null);
    assert.equal(await vibe64DriverInputFromRegistry({
      data: { registryPath },
      providerSessionId: "missing-provider-session",
      scope: "turn"
    }), null);
  });
});

test("the exact Genesis boundary inspects and selects source-owned engineering profiles", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await writeFile(
      path.join(projectRoot, "genesis", "engineering.md"),
      "# Engineering approach\n\n## Profile\n\n- `focused.v1`\n\n## Project requirements\n\n- Preserve offline support.\n",
      "utf8"
    );

    const initial = await inspectGenesisEngineering({ projectRoot });
    const selected = await setGenesisEngineeringProfile({
      profile: "durable.v1",
      projectRoot
    });
    const updated = await inspectGenesisEngineering({ projectRoot });

    assert.equal(initial.contract, "genesis.engineering.v1");
    assert.equal(initial.profile.id, "focused.v1");
    assert.deepEqual(initial.profiles.map((profile) => profile.id), [
      "focused.v1",
      "durable.v1",
      "high-assurance.v1"
    ]);
    assert.equal(selected.contract, "genesis.engineering.v1");
    assert.equal(selected.profile.id, "durable.v1");
    assert.equal(updated.profile.id, "durable.v1");
    assert.match(updated.requirements, /Preserve offline support/u);
  });
});

test("Vibe64 interprets setup from the pinned Stack package and owns the opaque Outputs contract", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await addGenesisStack({
      pieces: ["jskit"],
      projectRoot
    });
    assert.match(
      await readFile(path.join(projectRoot, "genesis", "stack.md"), "utf8"),
      /## Stack packages\n- `genesis-stack`/u
    );

    const waitingSetup = await inspectVibe64WorkspaceSetup({
      environment: {},
      projectRoot
    });
    assert.equal(waitingSetup.status, "unconfigured");
    assert.equal(waitingSetup.diagnostics[0].code, "VIBE64_WORKSPACE_SETUP_WAITING");

    await writeFile(path.join(projectRoot, "package.json"), "{}\n", "utf8");
    const stackPath = path.join(projectRoot, "genesis", "stack.md");
    const stack = await readFile(stackPath, "utf8");
    const outputsStart = stack.indexOf("## Outputs\n");
    const outputsEnd = stack.indexOf("\n## ", outputsStart + 1);
    assert.notEqual(outputsStart, -1);
    assert.notEqual(outputsEnd, -1);
    await writeFile(
      stackPath,
      `${stack.slice(0, outputsStart)}## Outputs\n\n### Target \`app\`: Run app\n\n- Default.\n- Mode: \`interactive\`\n- Runtimes: \`nodejs\`\n- Run \`Develop\`: \`npm\` \`run\` \`develop\`\n\n#### Presentation\n\n- Kind: \`web\`\n- Ready when: \`GET\` \`/api/health\` returns \`200\`\n${stack.slice(outputsEnd)}`,
      "utf8"
    );
    const setup = await inspectVibe64WorkspaceSetup({
      environment: {},
      projectRoot
    });
    const outputs = await inspectVibe64Outputs({
      environment: {},
      projectRoot
    });

    assert.equal(setup.status, "ready");
    assert.equal(setup.contract, "vibe64.workspace-setup.v1");
    assert.deepEqual(setup.steps.map((step) => step.argv), [["npm", "install"]]);
    assert.equal(outputs.status, "ready");
    assert.equal(outputs.contract, "vibe64.outputs.v1");
    assert.equal(outputs.targets[0].id, "app");
    assert.deepEqual(outputs.targets[0].runtimeRequirements, ["nodejs"]);
    assert.deepEqual(outputs.targets[0].steps.map((step) => step.argv), [
      ["npm", "run", "develop"]
    ]);
  });
});

test("Vibe64 owns deployment interpretation while Genesis exposes its opaque Stack section", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });

    const environment = await inspectGenesisEnvironment({ projectRoot });
    await writeFile(
      path.join(projectRoot, "genesis", "stack.md"),
      [
        "# Stack",
        "",
        "## Components",
        "",
        "## Deployment",
        "",
        "- Runtimes: `nodejs`",
        "- Ready when: `GET` `/health` returns `204`",
        "- Serve `Start`: `node` `server.js`",
        ""
      ].join("\n"),
      "utf8"
    );
    const deployment = await inspectVibe64Deployment({ projectRoot });

    assert.equal(environment.contract, "genesis.environment.v2");
    assert.equal(deployment.contract, "vibe64.application-deployment.v1");
    assert.equal(deployment.status, "ready");
    assert.equal(deployment.readiness.path, "/health");
    assert.deepEqual(deployment.steps.at(-1).argv, ["node", "server.js"]);
  });
});

test("Vibe64 rejects unsafe Deployment content that Genesis deliberately leaves opaque", () => {
  const invalid = [
    ["- Runtimes: `nodejs`", "- Serve `Start`: `npm` `start`"],
    ["- Workdir: `../escape`", "- Ready when: `GET` `/` returns `200`", "- Serve `Start`: `npm` `start`"],
    ["- Runtimes: `nodejs`", "- Ready when: `GET` `/` returns `200`", "- Serve `Start`: `npm start`"],
    ["- Recreate on restore: `../node_modules`", "- Ready when: `GET` `/` returns `200`", "- Prepare `Install`: `npm` `ci`", "- Serve `Start`: `npm` `start`"],
    ["- Recreate on restore: `node_modules`", "- Ready when: `GET` `/` returns `200`", "- Build `Build`: `npm` `run` `build`", "- Serve `Start`: `npm` `start`"],
    ["- Ready when: `GET` `/` returns `200`", "- Serve `Start`: `npm` `start`", "- Build `After start`: `npm` `run` `build`"],
    ["```json vibe64.application-deployment.v1", "{\"version\":1}", "```"]
  ];
  for (const lines of invalid) {
    assert.throws(
      () => parseVibe64DeploymentLines(lines),
      (error) => error?.code === "VIBE64_DEPLOYMENT_INVALID"
    );
  }
});

test("Vibe64 setup and Outputs parse only their canonical Markdown grammar", () => {
  assert.deepEqual(parseVibe64WorkspaceSetupLines([
    "- Prepare `Install` with `nodejs`: `npm` `install`"
  ]), [{
    label: "Install",
    argv: ["npm", "install"],
    runtimeRequirements: ["nodejs"],
    workdir: "."
  }]);

  const outputs = parseVibe64OutputsLines([
    "### Target `app`: Run app",
    "",
    "- Default.",
    "- Mode: `interactive`",
    "- Runtimes: `nodejs`",
    "- Run `Develop`: `npm` `run` `develop`",
    "",
    "#### Presentation",
    "",
    "- Kind: `web`",
    "- Ready when: `GET` `/health` returns `200`",
    "",
    "#### Preview identity",
    "",
    "- Command: `tools/preview-identity`",
    "- Protocol: `vibe64.preview-identity.command.v1`",
    "- Identity types: `email`",
    "- Runtimes: `nodejs`"
  ]);
  assert.equal(outputs.targets[0].steps[0].role, "run");
  assert.equal(outputs.targets[0].presentation.kind, "web");
  assert.equal(outputs.targets[0].previewIdentity.protocol, "vibe64.preview-identity.command.v1");

  assert.throws(
    () => parseVibe64WorkspaceSetupLines([
      "```json vibe64.workspace-setup.v1",
      "{\"version\":1}",
      "```"
    ]),
    (error) => error?.code === "VIBE64_WORKSPACE_SETUP_INVALID"
  );
  assert.throws(
    () => parseVibe64OutputsLines([
      "```json vibe64.outputs.v1",
      "{\"version\":1}",
      "```"
    ]),
    (error) => error?.code === "VIBE64_OUTPUTS_INVALID"
  );
});

test("Vibe64 executes the materialized JSKIT Deployment declaration exactly", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await addGenesisStack({ pieces: ["jskit"], projectRoot });

    const deployment = await inspectVibe64Deployment({ projectRoot });

    assert.equal(deployment.contract, "vibe64.application-deployment.v1");
    assert.equal(deployment.source, "project");
    assert.deepEqual(deployment.artifact, { disposablePaths: ["node_modules"] });
    assert.deepEqual(deployment.steps.map(({ role, argv }) => ({ role, argv })), [
      { role: "prepare", argv: ["npm", "ci"] },
      { role: "build", argv: ["npm", "run", "build"] },
      { role: "serve", argv: ["npm", "start"] }
    ]);
    assert.deepEqual(deployment.readiness, {
      kind: "http",
      method: "GET",
      path: "/api/health",
      status: 200
    });
  });
});

test("the exact Genesis boundary exposes the portable derived-artifact contract", () => {
  const result = inspectGenesisDerivedArtifacts();

  assert.equal(result.contract, "genesis.derived-artifacts.v1");
  assert.deepEqual(GENESIS_DERIVED_ARTIFACT_PATHS, [
    ".genesis/machine-city.json",
    ".genesis/program-city.json"
  ]);
  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.recreator),
    ["index-codebase", "index-codebase"]
  );
});

test("a blank initialized project stays in Genesis onboarding before ordinary work", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });

    const rendered = await renderGenesisPrompt({
      action: {
        promptId: "conversation"
      },
      input: {
        conversationRequest: "Build a book catalogue."
      },
      projectRoot
    });

    assert.equal(rendered.context.genesis, true);
    assert.equal(rendered.context.requestedTask, "work");
    assert.equal(rendered.context.task, "start");
    assert.match(rendered.prompt, /Build a book catalogue\./u);
    assert.match(rendered.prompt, /"projectKind": "new"/u);
    assert.match(rendered.prompt, /"availableStackPieces": \[/u);
    assert.match(rendered.prompt, /"id": "jskit"/u);
    assert.match(rendered.prompt, /"id": "jskit-mysql"/u);
    assert.doesNotMatch(rendered.prompt, /"id": "vue"/u);
    assert.doesNotMatch(rendered.prompt, /"id": "jskit-postgresql"/u);
    assert.doesNotMatch(rendered.prompt, /"id": "postgresql"/u);
    assert.match(
      rendered.prompt,
      /being built, who or what will use or invoke it, and the first observable\s+useful outcome/u
    );
    assert.match(rendered.prompt, /A Stack choice is not product intent/u);
    assert.match(rendered.prompt, /offer only relevant technology choices/u);
    assert.match(rendered.prompt, /Never silently select one/u);
    assert.match(rendered.prompt, /On confirmation, run\s+the Genesis `stack add <piece\.\.\.>` operation/u);
    assert.doesNotMatch(rendered.prompt, /VIBE64 NEW-PROJECT OPENING/u);
    assert.doesNotMatch(rendered.prompt, /explicit Vibe64 host default/u);
    assert.doesNotMatch(rendered.prompt, /COLLABORATION APPROACH|ENGINEERING APPROACH/u);
  });
});

test("Vibe64 uses the current bounded opening and component-scoped Stack guidance", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await writeFile(
      path.join(projectRoot, "genesis", "blueprint.md"),
      "# Blueprint\n\nPeople manage an existing application.\n",
      "utf8"
    );
    await addGenesisStack({ pieces: ["jskit", "vue"], projectRoot });
    await writeFile(path.join(projectRoot, "app.js"), "export const app = true;\n", "utf8");

    const opening = await renderGenesisPrompt({
      action: {
        genesisTask: "start"
      },
      input: {
        conversationRequest: "Continue the existing work."
      },
      projectRoot
    });

    assert.equal(opening.context.genesis, true);
    assert.equal(opening.context.task, "start");
    assert.match(opening.prompt, /"projectKind": "existing"/u);
    assert.match(opening.prompt, /"moduleCount": 0/u);
    assert.doesNotMatch(opening.prompt, /"availableStackPieces"/u);
    assert.match(opening.prompt, /run the Genesis `context <relevant-path\.\.\.>`\s+operation/u);
    assert.match(opening.prompt, /### `jskit`/u);
    assert.match(opening.prompt, /### `vue`/u);
    assert.match(opening.prompt, /https:\/\/vuejs\.org\//u);

    const rendered = await renderGenesisPrompt({
      input: {
        conversationRequest: "Continue the existing work."
      },
      projectRoot
    });

    assert.equal(rendered.context.genesis, true);
    assert.equal(rendered.context.task, "work");
    assert.match(rendered.prompt, /Continue the existing work\./u);
    assert.match(rendered.prompt, /SELECTED STACK GUIDANCE/u);

    const commit = "a".repeat(40);
    const deslop = await renderGenesisPrompt({
      action: {
        genesisTask: "deslop"
      },
      input: {
        request: `Deslop commit ${commit}.`
      },
      projectRoot
    });

    assert.equal(deslop.context.task, "deslop");
    assert.match(deslop.prompt, new RegExp(`Deslop commit ${commit}\\.`, "u"));
    assert.match(deslop.prompt, /explicit commit.*takes precedence/su);
    assert.match(deslop.prompt, /dirty worktree\s+is allowed/u);
    assert.doesNotMatch(deslop.prompt, /Require a clean worktree/u);
    assert.match(deslop.prompt, /SELECTED STACK CLEANUP GUIDANCE/u);
    assert.match(deslop.prompt, /For every affected JSKIT screen/u);

    const ownChanges = await renderGenesisPrompt({
      action: { genesisTask: "deslop" },
      input: { request: "Deslop" },
      projectRoot
    });
    assert.match(ownChanges.prompt, /select your own changes for the current task across preceding turns/u);
    assert.match(ownChanges.prompt, /committed or uncommitted/u);
  });
});

test("Genesis owns the opening conversation for an existing uninitialized project", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await writeFile(path.join(projectRoot, "app.js"), "export const answer = 42;\n", "utf8");

    const rendered = await renderGenesisPrompt({
      input: {
        conversationRequest: "Change the answer."
      },
      projectRoot
    });

    assert.equal(rendered.context.genesis, true);
    assert.equal(rendered.context.requestedTask, "work");
    assert.equal(rendered.context.task, "start");
    assert.match(rendered.prompt, /"projectKind": "existing-uninitialized"/u);
    assert.match(
      rendered.prompt,
      /Recommend preparing the project for guided editing/u
    );
    assert.match(rendered.prompt, /Do not require the person to know Genesis terminology/u);
    assert.match(rendered.prompt, /Otherwise, run it when they approve/u);
    await assert.rejects(
      () => readFile(path.join(projectRoot, "genesis", "blueprint.md"), "utf8"),
      { code: "ENOENT" }
    );
  });
});

test("Codex execution shims receive the installed Genesis executable exactly once", () => {
  const bin = genesisCommandShimDirectory();
  const first = withGenesisCommandShim(["/managed/git", genesisPackageBinDirectory(), bin]);
  const second = withGenesisCommandShim(first);

  assert.deepEqual(first, ["/managed/git", bin]);
  assert.equal(second.filter((entry) => entry === bin).length, 1);
});

test("Codex thread commands run Vibe64's Genesis without a project dependency", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await writeFile(path.join(projectRoot, "app.js"), "export const answer = 42;\n", "utf8");
    const codexRuntime = codexRuntimeContext({
      shimDirs: withGenesisCommandShim(),
      terminalEnv: {
        GENESIS_RESOURCE: "available"
      }
    });

    assert.equal(codexRuntime.ok, true);
    assert.equal(Object.hasOwn(codexRuntime.terminalEnv, "PATH"), false);
    const discovery = await execFileAsync("bash", ["-lc", "command -v genesis"], {
      cwd: projectRoot,
      env: codexRuntime.terminalProcessEnv
    });
    assert.equal(discovery.stdout.trim(), path.join(genesisCommandShimDirectory(), "genesis"));

    const indexed = await execFileAsync("genesis", ["index", "app.js"], {
      cwd: projectRoot,
      env: codexRuntime.terminalProcessEnv
    });
    assert.match(indexed.stdout, /index: ready/u);
  });
});

test("the managed Genesis command exposes Vibe64's curated Stack catalog", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });

    const result = await execFileAsync(path.join(genesisCommandShimDirectory(), "genesis"), [
      "stack",
      "add",
      "jskit"
    ], {
      cwd: projectRoot
    });

    assert.match(result.stdout, /stack: updated/u);
    const stack = await readFile(path.join(projectRoot, "genesis", "stack.md"), "utf8");
    assert.match(stack, /- `genesis-stack`/u);
    assert.match(stack, /- `jskit`/u);
    assert.match(stack, /- `nodejs`/u);
  });
});

test("the managed Genesis command migrates a legacy Stack into Vibe64 contracts", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await Promise.all([
      rm(path.join(projectRoot, "genesis", "version")),
      writeFile(
        path.join(projectRoot, "genesis", "stack.md"),
        "# Stack\n\n## Stack packages\n\n- `genesis-stack`\n\n## Components\n\n- `nodejs`\n- `jskit`\n",
        "utf8"
      )
    ]);

    await execFileAsync(path.join(genesisCommandShimDirectory(), "genesis"), [
      "migrate"
    ], {
      cwd: projectRoot
    });

    assert.equal(await readFile(path.join(projectRoot, "genesis", "version"), "utf8"), "3\n");
    assert.match(
      await readFile(path.join(projectRoot, "genesis", "collaboration.md"), "utf8"),
      /# Collaboration approach/u
    );
    const stack = await readFile(path.join(projectRoot, "genesis", "stack.md"), "utf8");
    assert.match(stack, /## Workspace setup/u);
    assert.match(stack, /## Outputs/u);
    assert.match(stack, /## Verification/u);
  });
});

test("the temporary onboarding gate preserves the installed PostgreSQL Stack piece", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });

    const result = await execFileAsync(path.join(genesisCommandShimDirectory(), "genesis"), [
      "stack",
      "add",
      "jskit-postgresql"
    ], {
      cwd: projectRoot
    });

    assert.match(result.stdout, /stack: updated/u);
    const stack = await readFile(path.join(projectRoot, "genesis", "stack.md"), "utf8");
    assert.match(stack, /- `jskit-postgresql`/u);
    assert.match(stack, /- `postgresql`/u);
  });
});

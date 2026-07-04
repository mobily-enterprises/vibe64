import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  createVibe64AdapterRegistry
} from "@local/vibe64-adapters/server/adapters/registry";
import {
  GENERIC_NODE_WEB_VIBE64_COMMANDS,
  GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG,
  createGenericNodeWebLaunchDescriptor,
  createGenericNodeWebTargetAdapter,
  listGenericNodeWebLaunchTargets
} from "@local/vibe64-adapters/server/adapters/node-web/index";
import {
  createGenericNodeWebSetupDoctorPlugin
} from "@local/vibe64-adapters/server/adapters/node-web/setupDoctorPlugin";
import {
  startupArgsPreviewOption
} from "@local/vibe64-adapters/server/launchPreviewOptions";
import { withTemporaryRoot, sourceMetadata } from "./vibe64TestHelpers.js";

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function createGenericNodeWebProject(root, packageJson = {}) {
  const {
    dependencies = {},
    devDependencies = {},
    scripts = {},
    ...packageOverrides
  } = packageJson;
  await Promise.all([
    writeProjectFile(root, "package.json", JSON.stringify({
      name: "example-node-web-app",
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        vite: "^6.0.0",
        ...dependencies
      },
      devDependencies: {
        vitest: "^4.0.0",
        ...devDependencies
      },
      scripts: {
        build: "vite build",
        dev: "vite --host 0.0.0.0",
        test: "vitest run",
        ...scripts
      },
      ...packageOverrides
    }, null, 2)),
    writeProjectFile(root, "src/main.jsx", "import React from 'react';\n"),
    writeProjectFile(root, "src/components/App.jsx", "export function App() { return null; }\n"),
    writeProjectFile(root, "vite.config.js", "export default {};\n")
  ]);
}

function commandIds() {
  return GENERIC_NODE_WEB_VIBE64_COMMANDS
    .map((command) => command.id)
    .sort((left, right) => left.localeCompare(right));
}

test("generic Node web adapter is registered as an implemented project type", async () => {
  const registry = createVibe64AdapterRegistry();
  const projectTypes = registry.availableProjectTypes();
  const nodeWebProjectType = projectTypes.find((type) => type.id === "node-web");

  assert.equal(nodeWebProjectType.disabledReason, "");
  assert.equal(nodeWebProjectType.enabled, true);
  assert.equal(nodeWebProjectType.id, "node-web");
  assert.equal(nodeWebProjectType.label, "Generic Node web app");
  assert.match(nodeWebProjectType.description, /package-managed JavaScript and TypeScript/u);
  assert.match(nodeWebProjectType.outcome, /React, Vue, Svelte, Lit/u);
  assert.equal(nodeWebProjectType.projectUrl, "https://nodejs.org");
  assert.ok(nodeWebProjectType.techStack.includes("Node.js"));
  assert.equal((await registry.createAdapter("node-web")).id, "node-web");
});

test("generic Node web adapter exposes detected facts, commands, and configurable client library", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGenericNodeWebProject(targetRoot);
    const adapter = createGenericNodeWebTargetAdapter();

    const facts = await adapter.inspect({
      targetRoot
    });
    const promptContext = await adapter.getPromptContext({
      targetRoot
    });

    assert.match(facts.summary, /Generic Node web app selected/u);
    assert.equal(Object.hasOwn(facts, "promptContext"), false);
    assert.equal(promptContext.adapter, "node-web");
    assert.equal(promptContext.package_name, "example-node-web-app");
    assert.equal(promptContext.package_manager, "npm");
    assert.equal(promptContext.router_mode, "unknown");
    assert.equal(promptContext.client_library, "react");
    assert.equal(promptContext.client_library_label, "React");
    assert.equal(promptContext.client_library_source, "auto-detected");
    assert.equal(promptContext.detected_client_libraries, "React");
    assert.equal(promptContext.framework_hints, "Vite");
    assert.match(promptContext.source_locations, /src/u);
    assert.match(promptContext.entrypoint_files, /src\/main\.jsx/u);
    assert.match(promptContext.config_files, /vite\.config\.js/u);
    assert.equal(promptContext.automated_check_script, "test");
    assert.equal(promptContext["valid_node-web_markers"], "true");
    assert.equal(promptContext.valid_node_web_markers, "true");
    assert.deepEqual(facts.commands.map((command) => command.id), commandIds());
    assert.equal(facts.capabilities.create_source, true);
    assert.equal(facts.capabilities.install_dependencies, true);
    assert.equal(facts.capabilities.run_automated_checks, true);
    assert.equal(facts.capabilities.update_code_index, true);

    const configuredPromptContext = await adapter.getPromptContext({
      config: {
        values: {
          [GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG]: "vue"
        }
      },
      targetRoot
    });

    assert.equal(configuredPromptContext.client_library, "vue");
    assert.equal(configuredPromptContext.client_library_label, "Vue");
    assert.equal(configuredPromptContext.client_library_source, "configured");
    assert.equal((await adapter.getDefaultConfig())[GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG], "auto");
  });
});

test("generic Node web adapter detects framework hints from config files without dependencies", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await Promise.all([
      writeProjectFile(targetRoot, "package.json", JSON.stringify({
        name: "marker-only-app",
        scripts: {
          build: "astro build"
        }
      }, null, 2)),
      writeProjectFile(targetRoot, "astro.config.ts", "export default {};\n"),
      writeProjectFile(targetRoot, "tailwind.config.mjs", "export default {};\n"),
      writeProjectFile(targetRoot, "eslint.config.mjs", "export default [];\n"),
      writeProjectFile(targetRoot, "src/routes/+page.svelte", "<main>Hello</main>\n"),
      writeProjectFile(targetRoot, "tests/example.test.js", "test('example', () => {});\n")
    ]);
    const adapter = createGenericNodeWebTargetAdapter();

    const promptContext = await adapter.getPromptContext({
      targetRoot
    });

    assert.equal(promptContext.framework_hints, "Astro");
    assert.equal(promptContext.router_mode, "routes");
    assert.match(promptContext.source_locations, /src\/routes/u);
    assert.match(promptContext.config_files, /astro\.config\.ts/u);
    assert.match(promptContext.config_files, /tailwind\.config\.mjs/u);
    assert.match(promptContext.config_files, /eslint\.config\.mjs/u);
    assert.match(promptContext.test_locations, /tests/u);
  });
});

test("generic Node web adapter disables automated checks when no verification script exists", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGenericNodeWebProject(targetRoot, {
      scripts: {
        build: "",
        test: ""
      }
    });
    const adapter = createGenericNodeWebTargetAdapter();
    const facts = await adapter.inspect({
      targetRoot
    });
    const promptContext = await adapter.getPromptContext({
      targetRoot
    });
    const automatedChecksCommand = facts.commands.find((command) => command.id === "run_automated_checks");

    assert.equal(promptContext.automated_check_script, "");
    assert.equal(facts.capabilities.run_automated_checks, false);
    assert.equal(automatedChecksCommand.available, false);
    assert.match(automatedChecksCommand.disabledReason, /No vibe64:verify/u);
  });
});

test("generic Node web prompt actions use the prompt pack", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGenericNodeWebProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createGenericNodeWebTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: sourceMetadata(targetRoot, "node_web_prompt"),
      sessionId: "node_web_prompt"
    });

    const afterPrompt = await runtime.runAction("node_web_prompt", "make_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "node-web");
    assert.match(afterPrompt.actionResult.prompt, /Create the implementation plan for this generic Node web app/u);
    assert.match(afterPrompt.actionResult.prompt, /Vibe64 session briefing[\s\S]*"client_library_label": "React"/u);
    assert.match(afterPrompt.actionResult.prompt, /Vibe64 session briefing[\s\S]*"framework_hints": "Vite"/u);
    assert.match(afterPrompt.actionResult.prompt, /Client library: See the Vibe64 session briefing/u);
    assert.match(afterPrompt.actionResult.prompt, /Framework hints: See the Vibe64 session briefing/u);
    assert.match(afterPrompt.actionResult.prompt, /example-node-web-app/u);
  });
});

test("generic Node web current-app scripts describe package script commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGenericNodeWebProject(targetRoot);
    const adapter = createGenericNodeWebTargetAdapter();

    const scripts = await adapter.listCurrentAppTargetScripts({
      targetRoot
    });
    const scriptNames = scripts.scripts.map((script) => script.name);
    assert.equal(scripts.ok, true);
    assert.ok(scriptNames.includes("build"));
    assert.ok(scriptNames.includes("dev"));
    assert.ok(scriptNames.includes("test"));

    const spec = await adapter.createCurrentAppTargetScriptTerminalSpec({
      input: {
        scriptId: "adapter:dev"
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "docker");
    assert.equal(spec.commandPreview, "npm run dev");
    assert.equal(spec.metadata.command, "npm run dev");
    assert.equal(spec.metadata.packageManager, "npm");
  });
});

test("generic Node web current-app inspection tolerates malformed workspace package metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGenericNodeWebProject(targetRoot, {
      workspaces: [
        "apps/web",
        "packages/*"
      ]
    });
    await writeProjectFile(targetRoot, "packages/bad/package.json", "{ not json\n");
    await mkdir(path.join(targetRoot, "packages/not-a-package"), {
      recursive: true
    });
    await writeProjectFile(targetRoot, "apps/web/package.json", JSON.stringify({
      name: "web-app"
    }, null, 2));
    const adapter = createGenericNodeWebTargetAdapter();

    const app = await adapter.inspectCurrentApp({
      includeGit: false,
      targetRoot
    });

    assert.equal(app.ok, true);
    assert.equal(app.localPackages.appPackageName, "example-node-web-app");
    assert.deepEqual(app.localPackages.packages.map((packageEntry) => ({
      name: packageEntry.name,
      relativePath: packageEntry.relativePath
    })), [
      {
        name: "web-app",
        relativePath: "apps/web"
      },
      {
        name: "",
        relativePath: "packages/bad"
      }
    ]);
  });
});

test("generic Node web launch descriptor uses build and start package scripts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGenericNodeWebProject(targetRoot, {
      scripts: {
        start: "vite preview --host 0.0.0.0"
      }
    });

    const descriptor = await createGenericNodeWebLaunchDescriptor({
      launchInput: {
        values: {
          startupArgs: [
            "--profile",
            "preview"
          ]
        }
      },
      launchTargetId: "built",
      port: 4199,
      worktreePath: targetRoot
    });

    assert.deepEqual(descriptor.commands.map((command) => command.command), [
      "npm run build",
      "npm run start -- --host 0.0.0.0 --port 4199 --profile preview"
    ]);
    assert.equal(descriptor.metadata.commandSource, "package-script");
    assert.equal(descriptor.metadata.packageManager, "npm");
    assert.equal(descriptor.metadata.serverScript, "start");

    const descriptorWithoutPort = await createGenericNodeWebLaunchDescriptor({
      launchTargetId: "dev",
      worktreePath: targetRoot
    });
    assert.deepEqual(descriptorWithoutPort.commands.map((command) => command.command), [
      "npm run dev"
    ]);

    const launchTargets = await listGenericNodeWebLaunchTargets({
      session: {
        metadata: {
          source_path: targetRoot
        },
        targetRoot
      }
    });
    assert.deepEqual(launchTargets.find((target) => target.id === "built").previewOptions, [
      startupArgsPreviewOption()
    ]);
  });
});

test("generic Node web setup plugin requires package.json but never offers a seed repair", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const plugin = createGenericNodeWebSetupDoctorPlugin({
      runCommand: async () => ({
        ok: true,
        output: "10.0.0"
      }),
      targetRoot
    });
    const packageCheck = plugin.checks({
      targetRoot
    }).find((check) => check.id === "node-web-package-json");

    const missingResult = await packageCheck.run({
      targetRoot
    });
    assert.equal(missingResult.status, "fail");
    assert.equal(missingResult.repair, null);
    assert.match(missingResult.explanation, /source of truth/u);

    await createGenericNodeWebProject(targetRoot);
    const clientCheck = plugin.checks({
      targetRoot
    }).find((check) => check.id === "node-web-client-library");
    const clientResult = await clientCheck.run({
      targetRoot
    });
    assert.equal(clientResult.status, "pass");
    assert.match(clientResult.observed, /detected: React/u);
  });
});

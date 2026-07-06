import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  VINEXT_VIBE64_COMMANDS,
  createVinextLaunchDescriptor,
  createVinextLaunchTargetTerminalSpec,
  createVinextTargetAdapter,
  listVinextLaunchTargets
} from "@local/vibe64-adapters/server/adapters/vinext/index";
import {
  createVinextSetupDoctorPlugin
} from "@local/vibe64-adapters/server/adapters/vinext/setupDoctorPlugin";
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

function escapedPattern(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertNodeRuntimeCommand(command = "", innerCommand = "") {
  assert.match(command, /^nix --extra-experimental-features 'nix-command flakes' shell /u);
  assert.match(command, /#nodejs_22/u);
  assert.match(command, new RegExp(escapedPattern(innerCommand), "u"));
}

async function createVinextProject(root, packageJson = {}) {
  await Promise.all([
    writeProjectFile(root, "package.json", JSON.stringify({
      name: "example-vinext-app",
      dependencies: {
        "@vitejs/plugin-react": "^5.0.0",
        next: "^16.0.0",
        vinext: "^0.1.0",
        vite: "^8.0.0"
      },
      scripts: {
        "build:vinext": "vinext build",
        "dev:vinext": "vinext dev --port 3001",
        "start:vinext": "vinext start",
        ...packageJson.scripts
      },
      ...packageJson
    }, null, 2)),
    writeProjectFile(root, "app/page.jsx", "export default function Page() { return <main>Hello</main>; }\n")
  ]);
}

function commandIds() {
  return VINEXT_VIBE64_COMMANDS
    .map((command) => command.id)
    .sort((left, right) => left.localeCompare(right));
}

test("vinext adapter declares Node runtime requirements from source package manager", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createVinextProject(targetRoot);
    const adapter = createVinextTargetAdapter();

    assert.deepEqual((await adapter.getRuntimeRequirements({
      targetRoot
    })).map((requirement) => requirement.id), ["nodejs-22"]);

    await writeProjectFile(targetRoot, "bun.lock", "");
    assert.deepEqual((await adapter.getRuntimeRequirements({
      targetRoot
    })).map((requirement) => requirement.id), ["nodejs-22", "bun"]);
  });
});

test("vinext adapter exposes project facts, commands, and prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createVinextProject(targetRoot);
    const adapter = createVinextTargetAdapter();

    const facts = await adapter.inspect({
      targetRoot
    });
    const promptContext = await adapter.getPromptContext({
      targetRoot
    });

    assert.equal(facts.summary, "Vinext project type selected.");
    assert.equal(Object.hasOwn(facts, "promptContext"), false);
    assert.equal(promptContext.adapter, "vinext");
    assert.equal(promptContext.package_name, "example-vinext-app");
    assert.equal(promptContext.router_mode, "app");
    assert.equal(promptContext.package_manager, "npm");
    assert.equal(promptContext.vinext_dependency, "true");
    assert.equal(promptContext.valid_vinext_markers, "true");
    assert.deepEqual(facts.commands.map((command) => command.id), commandIds());
    assert.equal(facts.capabilities.create_source, true);
    assert.equal(facts.capabilities.update_code_index, true);
    assert.equal(facts.capabilities.run_automated_checks, true);
  });
});

test("vinext prompt actions use the Vinext prompt pack", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createVinextProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createVinextTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: sourceMetadata(targetRoot, "vinext_prompt"),
      sessionId: "vinext_prompt"
    });

    const afterPrompt = await runtime.runAction("vinext_prompt", "make_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "vinext");
    assert.match(afterPrompt.actionResult.prompt, /Create the implementation plan for this Vinext project/u);
    assert.match(afterPrompt.actionResult.prompt, /example-vinext-app/u);
  });
});

test("vinext current-app scripts describe commands while Studio owns terminal execution", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createVinextProject(targetRoot);
    const adapter = createVinextTargetAdapter();

    const scripts = await adapter.listCurrentAppTargetScripts({
      targetRoot
    });
    const scriptNames = scripts.scripts.map((script) => script.name);
    assert.equal(scripts.ok, true);
    assert.ok(scriptNames.includes("build:vinext"));
    assert.ok(scriptNames.includes("vinext:check"));

    const spec = await adapter.createCurrentAppTargetScriptTerminalSpec({
      input: {
        scriptId: "adapter:build:vinext"
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "bash");
    assert.equal(spec.commandPreview, "npm run build:vinext");
    assertNodeRuntimeCommand(spec.metadata.command, "npm run build:vinext");
    assert.equal(spec.metadata.commandPreview, "npm run build:vinext");
    assert.equal(spec.metadata.packageManager, "npm");
  });
});

test("vinext launch target describes Vinext commands and uses the shared launch terminal", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createVinextProject(targetRoot);

    const descriptor = await createVinextLaunchDescriptor({
      launchInput: {
        values: {
          startupArgs: [
            "--profile",
            "preview"
          ]
        }
      },
      mode: "production",
      port: 4199,
      worktreePath: targetRoot
    });

    assertNodeRuntimeCommand(descriptor.commands[0].command, "npx --no-install vinext build");
    assertNodeRuntimeCommand(descriptor.commands[1].command, "npx --no-install vinext start --hostname 0.0.0.0 --port 4199 --profile preview");
    assert.equal(descriptor.metadata.mode, "production");

    const launchTargets = await listVinextLaunchTargets({
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

    const spec = await createVinextLaunchTargetTerminalSpec({
      launchTargetId: "built",
      session: {
        metadata: {
          source_path: targetRoot
        },
        sessionId: "vinext_review",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "bash");
    assert.equal(spec.metadata.adapterId, "vinext");
    assert.equal(spec.metadata.launchTargetId, "built");
    assert.equal(spec.metadata.mode, "production");
    assert.match(spec.metadata.targetUrl, /^http:\/\/127\.0\.0\.1:\d+\//u);
  });
});

test("vinext setup plugin offers vinext init for Next.js migration candidates", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createVinextProject(targetRoot, {
      dependencies: {
        next: "^16.0.0"
      },
      scripts: {
        build: "next build",
        dev: "next dev",
        start: "next start"
      }
    });
    const plugin = createVinextSetupDoctorPlugin({
      targetRoot
    });
    const checks = plugin.checks({
      targetRoot
    });
    const migration = checks.find((check) => check.id === "vinext-migration");
    const result = await migration.run({
      targetRoot
    });

    assert.equal(result.status, "fail");
    assert.equal(result.repair.actionId, "terminal-vinext-init");
    assert.match(result.observed, /Next\.js project detected/u);
  });
});

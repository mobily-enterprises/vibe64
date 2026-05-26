import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  AiStudioSessionRuntime
} from "@local/ai-studio-runtime/server";
import {
  VINEXT_AI_STUDIO_COMMANDS,
  createVinextLaunchDescriptor,
  createVinextLaunchTargetTerminalSpec,
  createVinextTargetAdapter
} from "@local/ai-studio-adapters/server/adapters/vinext/index";
import {
  createVinextSetupDoctorPlugin
} from "@local/ai-studio-adapters/server/adapters/vinext/setupDoctorPlugin";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
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
  return VINEXT_AI_STUDIO_COMMANDS
    .map((command) => command.id)
    .sort((left, right) => left.localeCompare(right));
}

test("vinext adapter exposes project facts, commands, and prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createVinextProject(targetRoot);
    const adapter = createVinextTargetAdapter();

    const facts = await adapter.inspect({
      targetRoot
    });

    assert.equal(facts.summary, "Vinext project type selected.");
    assert.equal(facts.promptContext.adapter, "vinext");
    assert.equal(facts.promptContext.package_name, "example-vinext-app");
    assert.equal(facts.promptContext.router_mode, "app");
    assert.equal(facts.promptContext.package_manager, "npm");
    assert.equal(facts.promptContext.vinext_dependency, "true");
    assert.equal(facts.promptContext.valid_vinext_markers, "true");
    assert.deepEqual(facts.commands.map((command) => command.id), commandIds());
    assert.equal(facts.capabilities.create_worktree, true);
    assert.equal(facts.capabilities.update_code_index, true);
    assert.equal(facts.capabilities.run_automated_checks, true);
  });
});

test("vinext prompt actions use the Vinext prompt pack", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createVinextProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: createVinextTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_made",
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
    assert.equal(spec.command, "docker");
    assert.equal(spec.commandPreview, "npm run build:vinext");
    assert.equal(spec.metadata.command, "npm run build:vinext");
    assert.equal(spec.metadata.packageManager, "npm");
  });
});

test("vinext launch target describes Vinext commands and uses the shared launch terminal", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createVinextProject(targetRoot);

    const descriptor = await createVinextLaunchDescriptor({
      mode: "production",
      port: 4199,
      worktreePath: targetRoot
    });

    assert.deepEqual(descriptor.commands.map((command) => command.command), [
      "npx --no-install vinext build",
      "npx --no-install vinext start --hostname 0.0.0.0 --port 4199"
    ]);
    assert.equal(descriptor.metadata.mode, "production");

    const spec = await createVinextLaunchTargetTerminalSpec({
      launchTargetId: "built",
      session: {
        metadata: {
          worktree_path: targetRoot
        },
        sessionId: "vinext_review",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "docker");
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

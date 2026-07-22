import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  AGENT_PLAYWRIGHT_COMMAND_NAME,
  createAgentPreviewCommandService,
  prepareAgentPreviewCommand
} from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";

const execFileAsync = promisify(execFile);

async function writeExecutable(filePath, source) {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, source, "utf8");
  await chmod(filePath, 0o755);
}

async function createRuntime(runtimeRoot, version, {
  current = false
} = {}) {
  const runtimePath = current
    ? path.join(runtimeRoot, "playwright")
    : path.join(runtimeRoot, "playwright-versions", version);
  await mkdir(path.join(runtimePath, "browsers"), {
    recursive: true
  });
  await writeExecutable(path.join(runtimePath, "bin", "playwright"), "#!/bin/sh\nexit 0\n");
  await writeFile(path.join(runtimePath, "runtime.env"), `playwright_version=${version}\n`, "utf8");
  return runtimePath;
}

async function createProject(projectRoot, version) {
  const packageRoot = path.join(projectRoot, "node_modules", "@playwright", "test");
  await mkdir(packageRoot, {
    recursive: true
  });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    devDependencies: {
      "@playwright/test": version
    },
    scripts: {
      e2e: "playwright test"
    }
  }), "utf8");
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
    version
  }), "utf8");
  await writeFile(path.join(packageRoot, "cli.js"), [
    "const { existsSync, readFileSync } = require(\"node:fs\");",
    "const storageStatePath = process.env.JSKIT_PLAYWRIGHT_STORAGE_STATE || \"\";",
    "process.stdout.write(JSON.stringify({",
    "  args: process.argv.slice(2),",
    "  baseUrl: process.env.PLAYWRIGHT_BASE_URL,",
    "  browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,",
    "  managed: process.env.VIBE64_MANAGED_PLAYWRIGHT_TEST,",
    "  skipDownload: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD,",
    "  storageState: storageStatePath && existsSync(storageStatePath)",
    "    ? JSON.parse(readFileSync(storageStatePath, \"utf8\"))",
    "    : null,",
    "  storageStateExists: Boolean(storageStatePath && existsSync(storageStatePath)),",
    "  storageStatePath",
    "}));"
  ].join("\n") + "\n", "utf8");
}

async function writeAuthenticatedPreviewWrapper(wrapperPath, previewUrl) {
  const storageState = {
    cookies: [{
      domain: "127.0.0.1",
      expires: -1,
      httpOnly: true,
      name: "app_session",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: "managed-viewer"
    }],
    origins: []
  };
  await writeExecutable(wrapperPath, [
    "#!/usr/bin/env node",
    "const { writeFileSync } = require(\"node:fs\");",
    `const previewUrl = ${JSON.stringify(previewUrl)};`,
    `const storageState = ${JSON.stringify(storageState)};`,
    "const args = process.argv.slice(2);",
    "if (args[0] === \"ensure\") {",
    "  process.stdout.write(JSON.stringify({",
    "    endpoints: { agent: { url: previewUrl } },",
    "    identityTypes: [\"email\"],",
    "    ready: true",
    "  }));",
    "  process.exit(0);",
    "}",
    "if (args[0] === \"browser\" && args[1] === \"storage-state\" && args[2] === \"you\") {",
    "  const outputIndex = args.indexOf(\"--output\");",
    "  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : \"\";",
    "  if (!outputPath) process.exit(64);",
    "  writeFileSync(outputPath, JSON.stringify(storageState) + \"\\n\", { flag: \"wx\", mode: 0o600 });",
    "  process.stdout.write(JSON.stringify({ outputPath }));",
    "  process.exit(0);",
    "}",
    "process.exit(64);"
  ].join("\n") + "\n");
  return storageState;
}

async function prepareFixture(root, projectVersion, runtimeVersion = projectVersion, {
  previewFailure = "",
  previewUrl = "http://127.0.0.1:4104/home"
} = {}) {
  const runtimeRoot = path.join(root, "runtime-packs");
  const projectRoot = path.join(root, "project");
  await createProject(projectRoot, projectVersion);
  await createRuntime(runtimeRoot, runtimeVersion);
  await createRuntime(runtimeRoot, runtimeVersion, {
    current: true
  });
  await writeExecutable(
    path.join(runtimeRoot, "node26", "bin", "node"),
    `#!/bin/sh\nexec ${process.execPath} "$@"\n`
  );
  await writeExecutable(
    path.join(runtimeRoot, "node26", "bin", "npm"),
    [
      "#!/usr/bin/env node",
      "const { existsSync, readFileSync } = require(\"node:fs\");",
      "const storageStatePath = process.env.JSKIT_PLAYWRIGHT_STORAGE_STATE || \"\";",
      "process.stdout.write(JSON.stringify({",
      "  args: process.argv.slice(2),",
      "  baseUrl: process.env.PLAYWRIGHT_BASE_URL,",
      "  browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,",
      "  managed: process.env.VIBE64_MANAGED_PLAYWRIGHT_TEST,",
      "  skipDownload: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD,",
      "  storageState: storageStatePath && existsSync(storageStatePath)",
      "    ? JSON.parse(readFileSync(storageStatePath, \"utf8\"))",
      "    : null,",
      "  storageStateExists: Boolean(storageStatePath && existsSync(storageStatePath)),",
      "  storageStatePath",
      "}));"
    ].join("\n") + "\n"
  );
  const commandService = createAgentPreviewCommandService({
    launchTarget: {
      async ensurePreview() {
        return previewFailure
          ? {
              error: previewFailure,
              ok: false
            }
          : {
              id: "managed-preview-terminal"
            };
      },
      async launchStatus() {
        return {
          activeTerminal: {
            id: "managed-preview-terminal",
            running: true,
            status: "running"
          },
          lastLaunchTarget: {
            agentHref: previewUrl,
            id: "dev"
          },
          previewTarget: {
            available: true,
            href: previewUrl
          }
        };
      }
    },
    readSessionUiState: () => null
  });
  const prepared = await prepareAgentPreviewCommand({
    commandService,
    env: {
      VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
    },
    sessionId: `playwright-${projectVersion}`,
    wrapperHostDir: path.join(root, "commands")
  });
  return {
    commandService,
    prepared,
    projectRoot,
    runtimeRoot
  };
}

test("managed Playwright test command uses the exact versioned browser runtime without downloads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-command-"));
  let fixture;
  try {
    fixture = await prepareFixture(root, "1.61.1");
    assert.equal(path.basename(fixture.prepared.hostPlaywrightWrapperPath), AGENT_PLAYWRIGHT_COMMAND_NAME);
    const status = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["status"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: "/tmp/project-override"
        }
      }
    )).stdout);
    assert.equal(status.version, "1.61.1");
    assert.equal(
      status.browsersPath,
      path.join(fixture.runtimeRoot, "playwright-versions", "1.61.1", "browsers")
    );

    const executed = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["test", "--grep", "checkout"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env,
          PLAYWRIGHT_BROWSERS_PATH: "/tmp/project-override",
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "0",
          JSKIT_PLAYWRIGHT_STORAGE_STATE: "/tmp/stale-managed-state.json"
        }
      }
    )).stdout);
    assert.deepEqual(executed.args, ["test", "--grep", "checkout"]);
    assert.equal(executed.baseUrl, "http://127.0.0.1:4104");
    assert.equal(
      executed.browsersPath,
      path.join(fixture.runtimeRoot, "playwright-versions", "1.61.1", "browsers")
    );
    assert.equal(executed.managed, "1");
    assert.equal(executed.skipDownload, "1");
    assert.equal(executed.storageStatePath, "");

    const npmRun = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["npm-run", "e2e", "--", "--grep", "settings"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env
        }
      }
    )).stdout);
    assert.deepEqual(npmRun.args, ["run", "e2e", "--", "--grep", "settings"]);
    assert.equal(npmRun.baseUrl, "http://127.0.0.1:4104");

    await writeExecutable(
      fixture.prepared.hostWrapperPath,
      "This is deliberately not executable JavaScript because an explicit PLAYWRIGHT_BASE_URL must bypass it.\n"
    );
    const explicit = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["test", "--grep", "override"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          PLAYWRIGHT_BASE_URL: "http://127.0.0.1:6200/custom",
          JSKIT_PLAYWRIGHT_STORAGE_STATE: "/tmp/explicit-state.json"
        }
      }
    )).stdout);
    assert.equal(explicit.baseUrl, "http://127.0.0.1:6200/custom");
    assert.equal(explicit.storageStatePath, "/tmp/explicit-state.json");
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.61.1");
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("managed Playwright supplies and removes authenticated browser state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-auth-"));
  let fixture;
  try {
    fixture = await prepareFixture(root, "1.61.1");
    const expectedState = await writeAuthenticatedPreviewWrapper(
      fixture.prepared.hostWrapperPath,
      "http://127.0.0.1:4104/home"
    );

    const executed = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["test", "--grep", "authenticated"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env
        }
      }
    )).stdout);
    assert.equal(executed.storageStateExists, true);
    assert.deepEqual(executed.storageState, expectedState);
    await assert.rejects(access(executed.storageStatePath), {
      code: "ENOENT"
    });

    const npmRun = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["npm-run", "e2e"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env
        }
      }
    )).stdout);
    assert.equal(npmRun.storageStateExists, true);
    assert.deepEqual(npmRun.storageState, expectedState);
    assert.notEqual(npmRun.storageStatePath, executed.storageStatePath);
    await assert.rejects(access(npmRun.storageStatePath), {
      code: "ENOENT"
    });
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.61.1");
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("managed Playwright test command reports a managed-preview blocker before starting tests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-preview-blocker-"));
  let fixture;
  try {
    fixture = await prepareFixture(root, "1.61.1", "1.61.1", {
      previewFailure: "managed preview did not become ready"
    });
    await assert.rejects(
      execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, ["test"], {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          ...fixture.prepared.env
        }
      }),
      /could not prepare the managed preview.+Project tests were not started.+managed preview did not become ready/isu
    );
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.61.1");
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("managed Playwright test command refuses mismatched runtimes and browser installation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-playwright-mismatch-"));
  let fixture;
  try {
    fixture = await prepareFixture(root, "1.62.0", "1.61.1");
    await assert.rejects(
      execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, ["test"], {
        cwd: fixture.projectRoot
      }),
      /requires Playwright 1\.62\.0.*does not provide its matching managed browser runtime/isu
    );

    await createRuntime(fixture.runtimeRoot, "1.62.0");
    await assert.rejects(
      execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, ["install", "chromium"], {
        cwd: fixture.projectRoot
      }),
      /Browser installation is never permitted/iu
    );
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.62.0");
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

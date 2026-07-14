import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    "process.stdout.write(JSON.stringify({",
    "  args: process.argv.slice(2),",
    "  browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,",
    "  managed: process.env.VIBE64_MANAGED_PLAYWRIGHT_TEST,",
    "  skipDownload: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
    "}));"
  ].join("\n") + "\n", "utf8");
}

async function prepareFixture(root, projectVersion, runtimeVersion = projectVersion) {
  const runtimeRoot = path.join(root, "runtime-packs");
  const projectRoot = path.join(root, "project");
  await createProject(projectRoot, projectVersion);
  await createRuntime(runtimeRoot, runtimeVersion);
  await createRuntime(runtimeRoot, runtimeVersion, {
    current: true
  });
  await writeExecutable(
    path.join(runtimeRoot, "node22", "bin", "node"),
    `#!/bin/sh\nexec ${process.execPath} "$@"\n`
  );
  await writeExecutable(
    path.join(runtimeRoot, "node22", "bin", "npm"),
    "#!/bin/sh\nexit 0\n"
  );
  const commandService = createAgentPreviewCommandService();
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
    fixture = await prepareFixture(root, "1.50.1");
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
    assert.equal(status.version, "1.50.1");
    assert.equal(
      status.browsersPath,
      path.join(fixture.runtimeRoot, "playwright-versions", "1.50.1", "browsers")
    );

    const executed = JSON.parse((await execFileAsync(
      fixture.prepared.hostPlaywrightWrapperPath,
      ["test", "--grep", "checkout"],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: "/tmp/project-override",
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "0"
        }
      }
    )).stdout);
    assert.deepEqual(executed.args, ["test", "--grep", "checkout"]);
    assert.equal(
      executed.browsersPath,
      path.join(fixture.runtimeRoot, "playwright-versions", "1.50.1", "browsers")
    );
    assert.equal(executed.managed, "1");
    assert.equal(executed.skipDownload, "1");
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.50.1");
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
    fixture = await prepareFixture(root, "1.60.0", "1.50.1");
    await assert.rejects(
      execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, ["test"], {
        cwd: fixture.projectRoot
      }),
      /requires Playwright 1\.60\.0.*does not provide its matching managed browser runtime/isu
    );

    await createRuntime(fixture.runtimeRoot, "1.60.0");
    await assert.rejects(
      execFileAsync(fixture.prepared.hostPlaywrightWrapperPath, ["install", "chromium"], {
        cwd: fixture.projectRoot
      }),
      /Browser installation is never permitted/iu
    );
  } finally {
    await fixture?.commandService.closeAllForSession("playwright-1.60.0");
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

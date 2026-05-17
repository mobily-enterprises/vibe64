import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createService,
  resolveCurrentAppRoot
} from "../../packages/current-app/src/server/service.js";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(tmpdir(), "ai-studio-current-app-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

function readySetupServices() {
  return {
    adapterSetupService: {
      async getStatus() {
        return {
          ready: true
        };
      }
    },
    projectSetupService: {
      async getStatus() {
        return {
          ready: true
        };
      }
    },
    studioSetupService: {
      async getStatus() {
        return {
          ready: true
        };
      }
    }
  };
}

function fakeProjectService({
  adapter = {},
  configReady = true,
  projectTypeReady = true,
  targetRoot
} = {}) {
  return {
    targetRoot,
    async createRuntime() {
      return {
        adapter,
        projectConfig: {
          ready: configReady,
          values: {
            example_config: "yes"
          }
        }
      };
    },
    async projectConfigEnvironment() {
      return {
        AI_STUDIO_CONFIG_DIR: path.join(targetRoot, ".ai-studio", "config")
      };
    },
    async readProjectConfig() {
      return {
        config: {
          ready: configReady,
          values: {
            example_config: "yes"
          }
        }
      };
    },
    async readProjectType() {
      return {
        projectType: {
          adapter: projectTypeReady
            ? {
                id: "fake",
                label: "Fake"
              }
            : null,
          projectType: projectTypeReady ? "fake" : "",
          ready: projectTypeReady
        }
      };
    }
  };
}

function fakeAdapter() {
  return {
    async createCurrentAppTargetScriptTerminalSpec(_context = {}) {
      return {
        args: ["-lc", "printf adapter"],
        command: "bash",
        commandPreview: "adapter script",
        ok: true
      };
    },
    async inspectCurrentApp({ targetRoot = "" } = {}) {
      return {
        adapter: "fake",
        appPath: "/",
        config: {},
        directories: [],
        git: {
          enabled: false
        },
        localPackages: {
          appPackageName: "",
          packages: []
        },
        markers: [],
        ok: true,
        ready: true,
        root: targetRoot
      };
    },
    async listCurrentAppTargetScripts() {
      return {
        ok: true,
        scripts: [
          {
            command: "npm run build",
            label: "Build",
            name: "build",
            starredByDefault: true
          },
          {
            command: "npm run verify",
            label: "Verify",
            name: "verify"
          }
        ]
      };
    }
  };
}

test("current-app resolves the launch target root from AI Studio environment", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const previousTargetRoot = process.env.AI_STUDIO_TARGET_ROOT;
    process.env.AI_STUDIO_TARGET_ROOT = targetRoot;

    try {
      assert.equal(resolveCurrentAppRoot(), targetRoot);
      assert.equal(resolveCurrentAppRoot(path.join(targetRoot, "explicit")), path.join(targetRoot, "explicit"));
    } finally {
      if (previousTargetRoot == null) {
        delete process.env.AI_STUDIO_TARGET_ROOT;
      } else {
        process.env.AI_STUDIO_TARGET_ROOT = previousTargetRoot;
      }
    }
  });
});

test("current-app reports project type, config, and setup gates before adapter inspection", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const beforeProjectType = await createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        projectTypeReady: false,
        targetRoot
      }),
      setupServices: readySetupServices()
    }).inspectCurrentApp();
    assert.equal(beforeProjectType.ready, false);
    assert.equal(beforeProjectType.adapterReady, false);
    assert.equal(beforeProjectType.root, targetRoot);
    assert.equal(beforeProjectType.projectType.ready, false);

    const beforeConfig = await createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        configReady: false,
        targetRoot
      }),
      setupServices: readySetupServices()
    }).inspectCurrentApp();
    assert.equal(beforeConfig.ready, false);
    assert.equal(beforeConfig.projectConfig.ready, false);

    const beforeSetup = await createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        targetRoot
      }),
      setupServices: {
        ...readySetupServices(),
        projectSetupService: {
          async getStatus() {
            return {
              blockedReason: "Project setup is blocked.",
              ready: false
            };
          }
        }
      }
    }).inspectCurrentApp();
    assert.equal(beforeSetup.ready, false);
    assert.equal(beforeSetup.setup.ready, false);
    assert.equal(beforeSetup.setup.message, "Project setup is blocked.");
  });
});

test("current-app merges adapter scripts with project scripts and stores starred target script ids", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, ".ai-studio", "scripts"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".ai-studio", "scripts", "local-check"), "echo ok\n", "utf8");
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        adapter: fakeAdapter(),
        targetRoot
      }),
      setupServices: readySetupServices()
    });

    const listed = await service.listTargetScripts();
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.scripts.map((script) => script.id), [
      "adapter:build",
      "adapter:verify",
      "project:local-check"
    ]);
    assert.deepEqual(listed.starredScriptIds, ["adapter:build"]);

    const saved = await service.saveStarredTargetScripts({
      scriptIds: ["project:local-check", "adapter:verify"]
    });
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.starredScriptIds, ["adapter:verify", "project:local-check"]);
    assert.equal(
      await readFile(path.join(targetRoot, ".ai-studio", "config", "starred_scripts"), "utf8"),
      "adapter:verify,project:local-check\n"
    );

    const invalid = await service.saveStarredTargetScripts({
      scriptIds: ["missing"]
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.errors[0].code, "invalid_target_script");

    const reset = await service.resetStarredTargetScripts();
    assert.equal(reset.ok, true);
    assert.deepEqual(reset.starredScriptIds, ["adapter:build"]);
    await assert.rejects(access(path.join(targetRoot, ".ai-studio", "config", "starred_scripts")), {
      code: "ENOENT"
    });
  });
});

test("current-app rejects target script terminal starts before spawning unknown commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      appRoot: targetRoot,
      projectService: fakeProjectService({
        adapter: fakeAdapter(),
        targetRoot
      }),
      setupServices: readySetupServices()
    });

    const missingInput = await service.startTargetScriptTerminal({});
    assert.equal(missingInput.ok, false);
    assert.equal(missingInput.errors[0].code, "missing_target_script");

    const unknown = await service.startTargetScriptTerminal({
      scriptId: "adapter:missing"
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.errors[0].code, "invalid_target_script");
  });
});

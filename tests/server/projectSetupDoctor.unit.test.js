import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CREATE_GIT_CHECKPOINT_ACTION_ID,
  MIRROR_REMOTE_BRANCH_ACTION_ID,
  mirrorRemoteBranchScript,
  normalizeRemoteBranchShaWithGhResult
} from "@local/setup-doctor-core/server/setupDoctorGit";
import {
  APP_CREDENTIAL_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_CREDENTIAL_SCOPE
} from "@local/vibe64-execution/server";
import {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession
} from "@local/vibe64-execution/server/terminalSessions";
import {
  terminalOwnerFromGithubToolHome,
  terminalOwnerMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  createRepositoryReadyStatusCache
} from "@local/setup-doctor-core/server/doctorStatusCache";
import {
  githubCliFailureDetails
} from "@local/setup-doctor-core/server/githubCliAuth";
import {
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
} from "@local/vibe64-core/server/projectRepository";
import {
  checkRemoteSync,
  createService,
  ghRepoCreateScript,
  gitCheckpointScript,
  githubBranchRefApiPath,
  inspectProjectSetup,
  projectSetupTerminalOwnerMetadata,
  readProjectRemoteDefaultBranchSha
} from "../../packages/project-setup-doctor/src/server/service.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const LOCAL_GITHUB_CACHE_SCOPE = `github:${userInfo().username}`;
const USER_GITHUB_CACHE_SCOPE = "github:ada";
const PROJECT_SETUP_TERMINAL_NAMESPACE = "project-setup-doctor";
process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-daemon";

function assertShellScriptSurvivesWhitespaceCollapse(script) {
  const flattened = script.replace(/\s+/gu, " ");
  const result = spawnSync("bash", ["-n", "-c", flattened], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || flattened);
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function waitForProjectSetupTerminalExit(sessionId, {
  timeoutMs = 5000
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = readTerminalSession(sessionId, {
      namespace: PROJECT_SETUP_TERMINAL_NAMESPACE
    });
    if (session?.status === "exited" || session?.ok === false) {
      return session;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  return readTerminalSession(sessionId, {
    namespace: PROJECT_SETUP_TERMINAL_NAMESPACE
  });
}

async function withLinkedWorktree(callback) {
  return withTemporaryRoot(async (repoRoot) => {
    return withTemporaryRoot(async (worktreeRoot) => {
      runGit(repoRoot, ["init", "-b", "main"]);
      runGit(repoRoot, ["config", "user.name", "Studio Test"]);
      runGit(repoRoot, ["config", "user.email", "studio-test@example.com"]);
      await writeFile(path.join(repoRoot, "README.md"), "# Test\n", "utf8");
      runGit(repoRoot, ["add", "README.md"]);
      runGit(repoRoot, ["commit", "-m", "Initial commit"]);
      runGit(repoRoot, ["worktree", "add", "-b", "studio-test", worktreeRoot]);
      return callback(worktreeRoot);
    });
  });
}

async function createGitRepository(root) {
  runGit(root, ["init", "-b", "main"]);
}

async function createCommittedGitRepository(root) {
  await createGitRepository(root);
  runGit(root, ["config", "user.name", "Studio Test"]);
  runGit(root, ["config", "user.email", "studio-test@example.com"]);
  await writeFile(path.join(root, "README.md"), "# Test\n", "utf8");
  runGit(root, ["add", "README.md"]);
  runGit(root, ["commit", "-m", "Initial commit"]);
}

async function createEmptyBareGitCache(projectRoot) {
  const gitCacheRepository = path.join(projectRoot, "git-cache", "repository.git");
  await mkdir(path.dirname(gitCacheRepository), {
    recursive: true
  });
  runGit(projectRoot, ["init", "--bare", gitCacheRepository]);
  return gitCacheRepository;
}

async function createManagedBootstrapProject(projectRoot, {
  defaultBranch = "",
  repositorySource = "github-created",
  slug = "bootstrap-app"
} = {}) {
  const projectRecordPath = path.join(projectRoot, "project.json");
  const githubRepository = {
    defaultBranch,
    fullName: `example/${slug}`,
    source: repositorySource,
    url: `https://github.com/example/${slug}`
  };
  await writeFile(projectRecordPath, JSON.stringify({
    githubRepository
  }), "utf8");
  return {
    githubRepository,
    projectRecordPath,
    projectLocalRoot: projectRoot,
    projectRoot,
    projectRuntimeRoot: projectRoot,
    selected: true,
    slug
  };
}

function projectSetupCacheConfigKey({
  adapterId = "",
  projectType = "",
  values = {}
} = {}) {
  return JSON.stringify({
    adapterId,
    projectType,
    values
  });
}

function createProjectSetupTestEnv(cacheRoot, overrides = {}) {
  return {
    ...process.env,
    VIBE64_DOCTOR_STATUS_ROOT: cacheRoot,
    ...overrides
  };
}

function projectSetupReadyStatusCache({
  cacheRoot,
  scope = LOCAL_GITHUB_CACHE_SCOPE,
  targetRoot
}) {
  return createRepositoryReadyStatusCache({
    doctorId: "project-setup",
    scope,
    stateRoot: cacheRoot,
    studioRoot: targetRoot,
    targetRoot
  });
}

test("Project Setup hard-stops when a non-git directory already has files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeFile(path.join(targetRoot, "notes.txt"), "existing work\n", "utf8");

    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.ready, false);
    assert.equal(status.currentStageId, "directory");
    assert.equal(status.hardStop, true);
    assert.equal(status.stages[0].status, "hard-stop");
    assert.match(status.stages[0].observed, /notes\.txt/u);
    assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.status, "pending");
  });
});

test("Project Setup blocks an empty directory at Git initialization", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.ready, false);
    assert.equal(status.hardStop, false);
    assert.equal(status.stages[0].status, "pass");
    assert.equal(status.currentStageId, "git-ready");
    assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.status, "blocked");
    assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.repair?.actionId, "terminal-git-init");
  });
});

test("Project Setup admits source-owned Vibe64 manifest before Git initialization", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeFile(path.join(targetRoot, "vibe64.project.json"), `${JSON.stringify({
      schema: "vibe64.project",
      schemaVersion: 1,
      projectType: "jskit",
      config: {}
    }, null, 2)}\n`, "utf8");

    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.ready, false);
    assert.equal(status.hardStop, false);
    assert.equal(status.currentStageId, "git-ready");
    assert.equal(status.stages[0].status, "pass");
    assert.match(status.stages[0].observed, /vibe64\.project\.json/u);
    assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.status, "blocked");
  });
});

test("Project Setup admits only approved source-owned .vibe64 children before Git initialization", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, ".vibe64", "prompts"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".vibe64", "prompts", "review.md"), "Review carefully.\n", "utf8");

    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.ready, false);
    assert.equal(status.hardStop, false);
    assert.equal(status.currentStageId, "git-ready");
    assert.equal(status.stages[0].status, "pass");
    assert.match(status.stages[0].observed, /\.vibe64\/prompts/u);
    assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.status, "blocked");
  });
});

test("Project Setup rejects runtime-local .vibe64 children before Git initialization", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, ".vibe64", "tmp"), {
      recursive: true
    });

    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.ready, false);
    assert.equal(status.currentStageId, "directory");
    assert.equal(status.hardStop, true);
    assert.equal(status.stages[0].status, "hard-stop");
    assert.match(status.stages[0].observed, /\.vibe64\/tmp/u);
  });
});

test("Project Setup requires approved .vibe64 source contract entries to be directories", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, ".vibe64"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".vibe64", "prompts"), "not a directory\n", "utf8");

    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.ready, false);
    assert.equal(status.currentStageId, "directory");
    assert.equal(status.hardStop, true);
    assert.equal(status.stages[0].status, "hard-stop");
    assert.match(status.stages[0].observed, /\.vibe64\/prompts/u);
  });
});

test("Project Setup admits linked Git worktrees before Git safety checks", async () => {
  await withLinkedWorktree(async (worktreeRoot) => {
    const status = await inspectProjectSetup({
      targetRoot: worktreeRoot
    });

    assert.equal(status.stages.find((stage) => stage.id === "directory")?.status, "pass");
    assert.match(status.stages.find((stage) => stage.id === "directory")?.observed || "", /linked Git metadata/u);
    assert.notEqual(status.currentStageId, "directory");
  });
});

test("Project Setup checkpoints source manifests without creating a repository gitignore", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCommittedGitRepository(targetRoot);

    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.stages.find((stage) => stage.id === "git-checkpoint")?.status, "pass");
    assert.equal(status.ready, true);
    await assert.rejects(readFile(path.join(targetRoot, ".gitignore"), "utf8"), {
      code: "ENOENT"
    });
  });
});

test("Project Setup local checkpoint uses Vibe64 fallback Git identity", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      studioRoot: targetRoot,
      targetRoot
    });
    await createGitRepository(targetRoot);
    await writeFile(path.join(targetRoot, "README.md"), "# Fallback identity\n", "utf8");

    const status = await inspectProjectSetup({
      targetRoot,
      vibe64User: {
        username: "merc"
      }
    });
    const identity = status.stages.find((stage) => stage.id === "git-identity");
    assert.equal(identity?.status, "pass");
    assert.match(identity?.observed || "", /merc via Vibe64/u);
    assert.match(identity?.observed || "", /Vibe64 fallback/u);

    const terminal = await service.startTerminal({
      actionId: CREATE_GIT_CHECKPOINT_ACTION_ID,
      inputs: {
        commitMessage: "Fallback identity checkpoint"
      },
      vibe64User: {
        username: "merc"
      }
    });

    try {
      assert.equal(terminal.ok, true, terminal.error);
      const exited = await waitForProjectSetupTerminalExit(terminal.id);
      assert.equal(exited.exitCode, 0, exited.output);
      assert.equal(
        runGit(targetRoot, ["log", "-1", "--format=%an <%ae>|%cn <%ce>"]),
        "merc via Vibe64 <merc@unit-daemon.users.vibe64.invalid>|Vibe64 <vibe64@unit-daemon.users.vibe64.invalid>"
      );
    } finally {
      if (terminal.id) {
        await closeTerminalSession(terminal.id, {
          namespace: PROJECT_SETUP_TERMINAL_NAMESPACE
        });
      }
    }
  });
});

test("Project Setup automatic repair proceeds directly to remote setup", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCommittedGitRepository(targetRoot);
    const attempts = [];

    const status = await inspectProjectSetup({
      autoRepair: true,
      startAutomaticRepair: async ({
        repair,
        targetRoot: repairTargetRoot
      }) => {
        attempts.push(repair.actionId);
        assert.equal(repairTargetRoot, targetRoot);
        return {
          error: "gh unavailable",
          exitCode: 1,
          ok: false,
          output: "gh unavailable",
          status: "exited"
        };
      },
      workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
      targetRoot
    });

    assert.deepEqual(attempts, [
      "terminal-gh-create-repo"
    ]);
    assert.equal(status.currentStageId, "remote-ready");
    assert.equal(status.stages.find((stage) => stage.id === "remote-ready")?.status, "blocked");
    assert.match(status.stages.find((stage) => stage.id === "remote-ready")?.observed || "", /Automatic repair failed/u);
    assert.match(status.stages.find((stage) => stage.id === "remote-ready")?.observed || "", /gh unavailable/u);
  });
});

test("Project Setup status reads are passive so setup gates do not auto-repair", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCommittedGitRepository(targetRoot);

    const status = await createService({
      studioRoot: targetRoot,
      targetRoot
    }).getStatus({
      refresh: true,
      workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
    });

    assert.equal(status.currentStageId, "remote-ready");
    assert.equal(status.stages.find((stage) => stage.id === "remote-ready")?.status, "blocked");
    await assert.rejects(readFile(path.join(targetRoot, ".gitignore"), "utf8"), {
      code: "ENOENT"
    });
  });
});

test("Project Setup rechecks the target instead of trusting stale ready cache", async () => {
  await withTemporaryRoot(async (cacheRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      const testEnv = createProjectSetupTestEnv(cacheRoot);
      await projectSetupReadyStatusCache({
        cacheRoot,
        targetRoot
      }).remember({
        currentStageId: "",
        ok: true,
        ready: true,
        summary: {
          originUrl: "git@github.com:example/test.git",
          projectSetupCacheConfigKey: projectSetupCacheConfigKey(),
          remoteDefaultBranch: "main"
        },
        stages: [],
        targetRoot
      });

      const status = await createService({
        env: testEnv,
        studioRoot: targetRoot,
        targetRoot
      }).getStatus();

      assert.equal(status.ready, false);
      assert.equal(status.currentStageId, "git-ready");
    });
  });
});

test("Project Setup reuses a validated ready cache until refresh is requested", async () => {
  await withTemporaryRoot(async (cacheRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      const testEnv = createProjectSetupTestEnv(cacheRoot);
      await createGitRepository(targetRoot);
      runGit(targetRoot, ["config", "user.name", "Studio Test"]);
      runGit(targetRoot, ["config", "user.email", "studio-test@example.com"]);
      await writeFile(path.join(targetRoot, "README.md"), "# Cached ready\n", "utf8");
      runGit(targetRoot, ["add", "README.md"]);
      runGit(targetRoot, ["commit", "-m", "Initial commit"]);
      runGit(targetRoot, ["remote", "add", "origin", "git@github.com:example/test.git"]);

      await projectSetupReadyStatusCache({
        cacheRoot,
        targetRoot
      }).remember({
        currentStageId: "",
        hardStop: false,
        ok: true,
        ready: true,
        summary: {
          originUrl: "git@github.com:example/test.git",
          projectSetupCacheConfigKey: projectSetupCacheConfigKey(),
          remoteDefaultBranch: "main"
        },
        stages: [
          {
            id: "ready",
            label: "Ready",
            status: "pass"
          }
        ],
        targetRoot
      });

      const service = createService({
        env: testEnv,
        studioRoot: targetRoot,
        targetRoot
      });
      const cached = await service.getStatus({
        workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
      });
      assert.equal(cached.ready, true);
      assert.equal(cached.currentStageId, "");

      const refreshed = await service.getStatus({
        refresh: true,
        workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
      });
      assert.equal(refreshed.ready, false);
      assert.equal(refreshed.currentStageId, "git-checkpoint");

      const afterRefresh = await service.getStatus({
        workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
      });
      assert.equal(afterRefresh.ready, false);
      assert.equal(afterRefresh.currentStageId, "git-checkpoint");
    });
  });
});

test("Project Setup cached status reads never run diagnostics on cache miss", async () => {
  await withTemporaryRoot(async (cacheRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      let createRuntimeCalls = 0;
      let readProjectConfigCalls = 0;
      const status = await createService({
        env: createProjectSetupTestEnv(cacheRoot),
        projectService: {
          async createRuntime() {
            createRuntimeCalls += 1;
            throw new Error("Runtime should not load for cached status misses.");
          },
          async readProjectConfig() {
            readProjectConfigCalls += 1;
            throw new Error("Project config should not load when there is no cache record.");
          }
        },
        studioRoot: targetRoot,
        targetRoot
      }).getCachedStatus();

      assert.equal(status, null);
      assert.equal(createRuntimeCalls, 0);
      assert.equal(readProjectConfigCalls, 0);
    });
  });
});

test("Project Setup stream is tree-free for managed project homes with multiple active sources", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await withTemporaryRoot(async (sourceRepo) => {
      await createCommittedGitRepository(sourceRepo);
      const gitCacheRepository = path.join(projectRoot, "git-cache", "repository.git");
      await mkdir(path.dirname(gitCacheRepository), {
        recursive: true
      });
      const clone = spawnSync("git", ["clone", "--bare", sourceRepo, gitCacheRepository], {
        encoding: "utf8"
      });
      assert.equal(clone.status, 0, clone.stderr || clone.stdout);
      const activeSessionsRoot = path.join(projectRoot, "sessions", "active");
      await mkdir(path.join(activeSessionsRoot, "session-a", "source"), {
        recursive: true
      });
      await mkdir(path.join(activeSessionsRoot, "session-b", "source"), {
        recursive: true
      });
      const projectRecordPath = path.join(projectRoot, "project.json");
      await writeFile(projectRecordPath, JSON.stringify({
        githubRepository: {
          defaultBranch: "main",
          fullName: "example/catalog-app",
          url: "https://github.com/example/catalog-app"
        }
      }), "utf8");
      let createRuntimeCalls = 0;
      let projectConfigEnvironmentCalls = 0;
      const project = {
        githubRepository: {
          defaultBranch: "main",
          fullName: "example/catalog-app",
          url: "https://github.com/example/catalog-app"
        },
        projectRecordPath,
        projectLocalRoot: projectRoot,
        projectRoot,
        projectRuntimeRoot: projectRoot,
        selected: true,
        slug: "catalog-app"
      };
      const service = createService({
        projectService: {
          currentProjectRuntimeRoot() {
            return projectRoot;
          },
          currentProjectSourceRoot() {
            return "";
          },
          currentTargetRoot() {
            return projectRoot;
          },
          async createRuntime() {
            createRuntimeCalls += 1;
            throw new Error("Project Setup must not load a session runtime for project-home setup.");
          },
          async listProjects() {
            return {
              currentProject: project,
              hasSelection: true,
              ok: true,
              projects: [project],
              targetRoot: projectRoot
            };
          },
          async projectConfigEnvironment() {
            projectConfigEnvironmentCalls += 1;
            throw new Error("Project Setup must not read session config environment for project-home setup.");
          },
          async readCommittedProjectConfig() {
            return {
              config: {
                message: "Optional deploy values are handled elsewhere.",
                projectType: "jskit",
                ready: false,
                status: "incomplete"
              },
              ok: true
            };
          },
          async readCommittedProjectType() {
            return {
              ok: true,
              projectType: {
                commit: runGit(sourceRepo, ["rev-parse", "HEAD"]),
                projectType: "jskit",
                ready: true,
                ref: "refs/heads/main",
                sourceType: "git-cache",
                status: "ready"
              }
            };
          },
          selectedProject: project
        }
      });

      const status = await service.streamStatus({
        emit() {},
        vibe64User: {
          email: "ada@example.com"
        }
      });

      assert.equal(status.ready, true);
      assert.equal(createRuntimeCalls, 0);
      assert.equal(projectConfigEnvironmentCalls, 0);
      assert.deepEqual(status.stages.map((stage) => stage.id), [
        "project-record",
        "project-repository",
        "git-cache",
        "project-metadata",
        "committed-config",
        "ready"
      ]);
    });
  });
});

test("Project Setup reads catalog Git cache from the project record git cache root", async () => {
  await withTemporaryRoot(async (runtimeRoot) => {
    await withTemporaryRoot(async (sourceRoot) => {
      await withTemporaryRoot(async (sourceRepo) => {
        await createCommittedGitRepository(sourceRepo);
        const gitCacheRoot = path.join(sourceRoot, "git-cache");
        const gitCacheRepository = path.join(gitCacheRoot, "repository.git");
        await mkdir(gitCacheRoot, {
          recursive: true
        });
        const clone = spawnSync("git", ["clone", "--bare", sourceRepo, gitCacheRepository], {
          encoding: "utf8"
        });
        assert.equal(clone.status, 0, clone.stderr || clone.stdout);
        const projectRecordPath = path.join(runtimeRoot, "project.json");
        await writeFile(projectRecordPath, JSON.stringify({
          githubRepository: {
            defaultBranch: "main",
            fullName: "example/catalog-app",
            url: "https://github.com/example/catalog-app"
          }
        }), "utf8");
        const project = {
          gitCacheRoot,
          githubRepository: {
            defaultBranch: "main",
            fullName: "example/catalog-app",
            url: "https://github.com/example/catalog-app"
          },
          projectRecordPath,
          projectLocalRoot: runtimeRoot,
          projectRoot: sourceRoot,
          projectRuntimeRoot: runtimeRoot,
          selected: true,
          slug: "catalog-app"
        };
        const service = createService({
          projectService: {
            currentProjectRuntimeRoot() {
              return runtimeRoot;
            },
            currentProjectSourceRoot() {
              return "";
            },
            currentTargetRoot() {
              return sourceRoot;
            },
            async listProjects() {
              return {
                currentProject: project,
                hasSelection: true,
                ok: true,
                projects: [project],
                targetRoot: sourceRoot
              };
            },
            async readCommittedProjectConfig() {
              return {
                config: {
                  projectType: "jskit",
                  ready: true,
                  status: "ready"
                },
                ok: true
              };
            },
            async readCommittedProjectType() {
              return {
                ok: true,
                projectType: {
                  commit: runGit(sourceRepo, ["rev-parse", "HEAD"]),
                  projectType: "jskit",
                  ready: true,
                  ref: "refs/heads/main",
                  sourceType: "git-cache",
                  status: "ready"
                }
              };
            },
            selectedProject: project
          }
        });

        const status = await service.streamStatus({
          emit() {}
        });

        const gitCacheStage = status.stages.find((stage) => stage.id === "git-cache");
        assert.equal(gitCacheStage?.status, "pass");
        assert.match(gitCacheStage?.observed || "", /^refs\/heads\/main: /u);
        assert.doesNotMatch(gitCacheStage?.observed || "", /Missing Git cache/u);
      });
    });
  });
});

test("Project Setup reports seed required instead of blocked for an empty Vibe64-created repo", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await createEmptyBareGitCache(projectRoot);
    const project = await createManagedBootstrapProject(projectRoot, {
      slug: "seed-required-app"
    });
    let readCommittedProjectTypeCalls = 0;
    const service = createService({
      projectService: {
        currentProjectRuntimeRoot() {
          return projectRoot;
        },
        currentProjectSourceRoot() {
          return "";
        },
        currentTargetRoot() {
          return projectRoot;
        },
        async listProjects() {
          return {
            currentProject: project,
            hasSelection: true,
            ok: true,
            projects: [project],
            targetRoot: projectRoot
          };
        },
        async readCommittedProjectType() {
          readCommittedProjectTypeCalls += 1;
          throw new Error("Committed config must not be read before a seed baseline exists.");
        },
        selectedProject: project
      }
    });

    const status = await service.streamStatus({
      emit() {}
    });

    assert.equal(status.ready, false);
    assert.equal(status.currentStageId, "committed-config");
    assert.equal(status.readiness?.state, "waiting");
    assert.equal(status.readiness?.reason, "seed_required");
    assert.equal(status.readiness?.label, "Seed required");
    assert.equal(readCommittedProjectTypeCalls, 0);
    assert.deepEqual(status.stages.map((stage) => [stage.id, stage.status]), [
      ["project-record", "pass"],
      ["project-repository", "pass"],
      ["git-cache", "pass"],
      ["project-metadata", "pass"],
      ["committed-config", "pending"],
      ["ready", "pending"]
    ]);
    assert.doesNotMatch(JSON.stringify(status), /Needed a single revision/u);
    assert.match(status.stages.find((stage) => stage.id === "git-cache")?.observed || "", /no committed baseline/u);
  });
});

test("Project Setup reports seed in progress for an empty Vibe64-created repo with an active seed session", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await createEmptyBareGitCache(projectRoot);
    const project = await createManagedBootstrapProject(projectRoot, {
      slug: "seed-active-app"
    });
    const seedSessionId = "2026-07-03_02-03-49";
    const seedSessionRoot = path.join(projectRoot, "sessions", "active", seedSessionId);
    await mkdir(path.join(seedSessionRoot, "metadata"), {
      recursive: true
    });
    await writeFile(path.join(seedSessionRoot, "metadata", "workflow_definition"), "seed_application\n", "utf8");
    await writeFile(path.join(seedSessionRoot, "status"), "active\n", "utf8");
    await writeFile(path.join(seedSessionRoot, "current_step"), "seed_application_defined\n", "utf8");
    let readCommittedProjectTypeCalls = 0;
    const service = createService({
      projectService: {
        currentProjectRuntimeRoot() {
          return projectRoot;
        },
        currentProjectSourceRoot() {
          return "";
        },
        currentTargetRoot() {
          return projectRoot;
        },
        async listProjects() {
          return {
            currentProject: project,
            hasSelection: true,
            ok: true,
            projects: [project],
            targetRoot: projectRoot
          };
        },
        async readCommittedProjectType() {
          readCommittedProjectTypeCalls += 1;
          throw new Error("Committed config must not be read before a seed baseline exists.");
        },
        selectedProject: project
      }
    });

    const status = await service.streamStatus({
      emit() {}
    });

    assert.equal(status.ready, false);
    assert.equal(status.currentStageId, "committed-config");
    assert.equal(status.readiness?.state, "waiting");
    assert.equal(status.readiness?.reason, "seed_in_progress");
    assert.equal(status.readiness?.label, "Seed in progress");
    assert.equal(status.readiness?.seedSessionId, seedSessionId);
    assert.equal(status.readiness?.seedSessionStep, "seed_application_defined");
    assert.equal(readCommittedProjectTypeCalls, 0);
    assert.doesNotMatch(JSON.stringify(status), /Needed a single revision/u);
  });
});

test("Project Setup can scope ready cache to a per-user GitHub account", async () => {
  await withTemporaryRoot(async (cacheRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      await withTemporaryRoot(async (homeRoot) => {
        const userHome = path.join(homeRoot, "ada");
        await mkdir(userHome, {
          recursive: true
        });
        const testEnv = createProjectSetupTestEnv(cacheRoot);
        await createGitRepository(targetRoot);
        runGit(targetRoot, ["config", "user.name", "Studio Test"]);
        runGit(targetRoot, ["config", "user.email", "studio-test@example.com"]);
        await writeFile(path.join(targetRoot, "README.md"), "# Cached ready\n", "utf8");
        runGit(targetRoot, ["add", "README.md"]);
        runGit(targetRoot, ["commit", "-m", "Initial commit"]);
        runGit(targetRoot, ["remote", "add", "origin", "git@github.com:example/test.git"]);

        await projectSetupReadyStatusCache({
          cacheRoot,
          scope: USER_GITHUB_CACHE_SCOPE,
          targetRoot
        }).remember({
          currentStageId: "",
          hardStop: false,
          ok: true,
          ready: true,
          summary: {
            originUrl: "git@github.com:example/test.git",
            projectSetupCacheConfigKey: projectSetupCacheConfigKey(),
            remoteDefaultBranch: "main"
          },
          stages: [
            {
              id: "ready",
              label: "Ready",
              status: "pass"
            }
          ],
          targetRoot
        });

        const userScopedStatus = await createService({
          env: testEnv,
          githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
          studioRoot: targetRoot,
          targetRoot
        }).getStatus({
          vibe64User: {
            home: userHome,
            username: "ada"
          },
          workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
        });

        assert.equal(userScopedStatus.ready, true);
        assert.equal(userScopedStatus.currentStageId, "");

        const localScopedStatus = await createService({
          env: testEnv,
          studioRoot: targetRoot,
          targetRoot
        }).getStatus({
          vibe64User: {
            home: userHome,
            username: "ada"
          },
          workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
        });

        assert.equal(localScopedStatus.ready, false);
        assert.equal(localScopedStatus.currentStageId, "git-checkpoint");
      });
    });
  });
});

test("Project Setup terminal lifecycle allows access after setup action authorization", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await withTemporaryRoot(async (homeRoot) => {
      const userHome = path.join(homeRoot, "ada");
      await mkdir(userHome, {
        recursive: true
      });
      const service = createService({
        env: process.env,
        githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
        studioRoot: targetRoot,
        targetRoot
      });
      const metadata = terminalOwnerMetadata(terminalOwnerFromGithubToolHome({
        accountMode: GITHUB_ACCOUNT_MODE_USER,
        credentialScope: USER_CREDENTIAL_SCOPE,
        ownerUserKey: "ada",
        toolHomeSource: userHome
      }));
      const terminal = startTerminalSession({
        args: ["-lc", "sleep 30"],
        command: "bash",
        commandPreview: "sleep 30",
        cwd: targetRoot,
        metadata,
        namespace: PROJECT_SETUP_TERMINAL_NAMESPACE
      });

      try {
        const ownerInput = {
          vibe64User: {
            home: userHome,
            username: "ada"
          }
        };
        const otherInput = {
          vibe64User: {
            home: path.join(homeRoot, "bob"),
            username: "bob"
          }
        };

        assert.equal(service.readTerminal(terminal.id, ownerInput).ok, true);

        const otherRead = service.readTerminal(terminal.id, otherInput);
        assert.equal(otherRead.ok, true);

        const otherWrite = service.writeTerminal(terminal.id, "\r", otherInput);
        assert.equal(otherWrite.ok, true);

        const otherClose = await service.closeTerminal(terminal.id, otherInput);
        assert.equal(otherClose.ok, true);
      } finally {
        await closeTerminalSession(terminal.id, {
          namespace: PROJECT_SETUP_TERMINAL_NAMESPACE
        });
      }
    });
  });
});

test("Project Setup terminal owner metadata records online actor GitHub homes", () => {
  const metadata = projectSetupTerminalOwnerMetadata({
    actionId: "terminal-gh-create-repo",
    githubProvider: {
      accountMode: GITHUB_ACCOUNT_MODE_USER,
      credentialScope: USER_CREDENTIAL_SCOPE,
      githubToolHomeSource: "/home/ada",
      ok: true,
      toolHomeSource: "/home/ada",
      userKey: "ada"
    }
  });

  assert.equal(metadata.projectSetupActionId, "terminal-gh-create-repo");
  assert.equal(metadata.terminalKind, PROJECT_SETUP_TERMINAL_NAMESPACE);
  assert.equal(metadata.terminalOwner.ownerScope, "user");
  assert.equal(metadata.terminalOwner.ownerUserKey, "ada");
  assert.equal(metadata.terminalOwner.githubCredentialScope, USER_CREDENTIAL_SCOPE);
  assert.equal(metadata.terminalOwner.githubToolHomeSource, "/home/ada");
});

test("Project Setup terminal lifecycle allows local-mode ownership without a user", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await withTemporaryRoot(async (homeRoot) => {
      const localHome = path.join(homeRoot, "local-owner");
      await mkdir(localHome, {
        recursive: true
      });
      const service = createService({
        env: process.env,
        studioRoot: targetRoot,
        targetRoot
      });
      const metadata = terminalOwnerMetadata(terminalOwnerFromGithubToolHome({
        accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
        credentialScope: APP_CREDENTIAL_SCOPE,
        ownerUserKey: "local",
        toolHomeSource: localHome
      }));
      const terminal = startTerminalSession({
        args: ["-lc", "sleep 30"],
        command: "bash",
        commandPreview: "sleep 30",
        cwd: targetRoot,
        metadata,
        namespace: PROJECT_SETUP_TERMINAL_NAMESPACE
      });

      try {
        assert.equal(service.readTerminal(terminal.id).ok, true);
        assert.equal(service.writeTerminal(terminal.id, "\r").ok, true);
      } finally {
        await closeTerminalSession(terminal.id, {
          namespace: PROJECT_SETUP_TERMINAL_NAMESPACE
        });
      }
    });
  });
});

test("Project Setup starts local git-init repair without GitHub provider", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      env: process.env,
      studioRoot: targetRoot,
      targetRoot
    });
    const terminal = await service.startTerminal({
      actionId: "terminal-git-init"
    });

    try {
      assert.equal(terminal.ok, true, terminal.error || "");
      assert.ok(terminal.id);
    } finally {
      if (terminal?.id) {
        await closeTerminalSession(terminal.id, {
          namespace: PROJECT_SETUP_TERMINAL_NAMESPACE
        });
      }
    }
  });
});

test("Project Setup ready cache reuse does not require unrelated host services or setup plugins", async () => {
  await withTemporaryRoot(async (cacheRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      const testEnv = createProjectSetupTestEnv(cacheRoot, {
        UNUSED_HOST_SOCKET: "unix:///tmp/vibe64-should-not-be-used.sock"
      });
      await createGitRepository(targetRoot);
      runGit(targetRoot, ["config", "user.name", "Studio Test"]);
      runGit(targetRoot, ["config", "user.email", "studio-test@example.com"]);
      await writeFile(path.join(targetRoot, "README.md"), "# Cached ready\n", "utf8");
      runGit(targetRoot, ["add", "README.md"]);
      runGit(targetRoot, ["commit", "-m", "Initial commit"]);
      runGit(targetRoot, ["remote", "add", "origin", "git@github.com:example/test.git"]);

      await projectSetupReadyStatusCache({
        cacheRoot,
        targetRoot
      }).remember({
        currentStageId: "",
        hardStop: false,
        ok: true,
        ready: true,
        summary: {
          originUrl: "git@github.com:example/test.git",
          projectSetupCacheConfigKey: projectSetupCacheConfigKey({
            adapterId: "jskit",
            projectType: "jskit"
          }),
          remoteDefaultBranch: "main"
        },
        stages: [
          {
            id: "ready",
            label: "Ready",
            status: "pass"
          }
        ],
        targetRoot
      });

      let createRuntimeCalls = 0;
      let readProjectConfigCalls = 0;
      const service = createService({
        env: testEnv,
        projectService: {
          async createRuntime() {
            createRuntimeCalls += 1;
            throw new Error("Runtime should not load for cached readiness.");
          },
          async readProjectConfig() {
            readProjectConfigCalls += 1;
            return {
              config: {
                adapter: {
                  id: "jskit"
                },
                projectType: "jskit",
                values: {}
              }
            };
          }
        },
        studioRoot: targetRoot,
        targetRoot
      });
      const cachedOnlyStatus = await service.getCachedStatus({
        workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
      });
      const status = await service.getStatus({
        workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
      });

      assert.equal(cachedOnlyStatus.ready, true);
      assert.equal(status.ready, true);
      assert.equal(readProjectConfigCalls, 2);
      assert.equal(createRuntimeCalls, 0);
    });
  });
});
test("Project Setup continues to remote setup after source manifest checkpointing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCommittedGitRepository(targetRoot);
    runGit(targetRoot, ["remote", "add", "origin", "git@github.com:example/test.git"]);

    const status = await inspectProjectSetup({
      targetRoot,
      workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
    });
    const remoteReady = status.stages.find((stage) => stage.id === "remote-ready");

    assert.equal(status.currentStageId, "remote-ready");
    assert.equal(remoteReady?.status, "blocked");
    assert.match(remoteReady?.observed || "", /Authenticate GitHub|GitHub/u);
    assert.match(remoteReady?.expected || "", /GitHub identity/u);
  });
});

test("Project Setup treats a named remote default branch without a ref as empty", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    await mkdir(targetRoot);
    await createGitRepository(targetRoot);

    const status = await checkRemoteSync(targetRoot, {
      remoteDefaultBranch: "main"
    }, {
      readRemoteBranchSha: async (checkedRoot, branch) => {
        assert.equal(checkedRoot, targetRoot);
        assert.equal(branch, "main");
        return {
          ok: true,
          output: "",
          sha: "",
          stdout: ""
        };
      }
    });

    assert.equal(status.status, "pass");
    assert.match(status.observed, /refs\/heads\/main has no commits/u);
  });
});

test("Project Setup reads GitHub remote branch refs through the GitHub provider", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);
    const calls = [];
    const result = await readProjectRemoteDefaultBranchSha(targetRoot, "main", {
      githubProvider: {
        ok: true,
        toolHomeSource: "/tmp/vibe64-gh-home"
      },
      originUrl: "https://github.com/mercmobily/private-app.git"
    }, {
      readGitBranchSha: () => {
        assert.fail("GitHub remotes must not use plain git ls-remote.");
      },
      readGithubBranchSha: async (root, repoSlug, branch, options) => {
        calls.push({
          branch,
          options,
          repoSlug,
          root
        });
        return {
          ok: true,
          sha: "abc123",
          stdout: "abc123"
        };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.sha, "abc123");
    assert.deepEqual(calls, [
      {
        branch: "main",
        options: {
          githubToolHomeSource: "/tmp/vibe64-gh-home",
          toolHomeSource: "/tmp/vibe64-gh-home",
          userKey: ""
        },
        repoSlug: "mercmobily/private-app",
        root: targetRoot
      }
    ]);
  });
});

test("Project Setup keeps GitHub push readiness blocked when GitHub credentials are missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCommittedGitRepository(targetRoot);
    runGit(targetRoot, ["remote", "add", "origin", "git@github.com:example/private-app.git"]);

    const status = await checkRemoteSync(targetRoot, {
      githubProvider: {
        ok: false,
        output: "GitHub CLI is not authenticated.",
        toolHomeSource: ""
      },
      remoteDefaultBranch: "main",
      originUrl: "git@github.com:example/private-app.git"
    }, {
      readGitBranchSha: () => {
        assert.fail("GitHub remotes must not fall back to unauthenticated git ls-remote.");
      },
      readGithubBranchSha: () => {
        assert.fail("GitHub branch lookup should not run without a ready GitHub provider.");
      }
    });

    assert.equal(status.status, "blocked");
    assert.match(status.expected, /GitHub/u);
    assert.match(status.observed, /Authenticate GitHub/u);
  });
});

test("Project Setup GitHub CLI failure details do not expose tokens", () => {
  const failure = githubCliFailureDetails({
    stderr: [
      "Authorization: Bearer ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      "GITHUB_TOKEN=github_pat_1234567890abcdefghijklmnopqrstuvwxyz",
      "GH_TOKEN=gho_1234567890abcdefghijklmnopqrstuvwxyz"
    ].join("\n")
  });
  const serialized = JSON.stringify(failure);

  assert.doesNotMatch(serialized, /ghp_1234567890/u);
  assert.doesNotMatch(serialized, /github_pat_1234567890/u);
  assert.doesNotMatch(serialized, /gho_1234567890/u);
  assert.match(serialized, /\[REDACTED\]/u);
});

test("Project Setup keeps plain git remote branch reads for non-GitHub remotes", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);
    const calls = [];
    const result = await readProjectRemoteDefaultBranchSha(targetRoot, "main", {
      originUrl: "../remote.git"
    }, {
      readGitBranchSha: async (root, branch) => {
        calls.push({
          branch,
          root
        });
        return {
          ok: true,
          sha: "",
          stdout: ""
        };
      },
      readGithubBranchSha: () => {
        assert.fail("Non-GitHub remotes should use plain git.");
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.sha, "");
    assert.deepEqual(calls, [
      {
        branch: "main",
        root: targetRoot
      }
    ]);
  });
});

test("Project Setup offers remote mirroring when a bootstrap-only target links an existing remote", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    await mkdir(targetRoot);
    await createGitRepository(targetRoot);
    await writeFile(path.join(targetRoot, ".gitignore"), "node_modules/\n", "utf8");
    const remoteSha = "a".repeat(40);

    const status = await checkRemoteSync(targetRoot, {
      nonGitEntries: [".gitignore", ".vibe64/prompts"],
      remoteDefaultBranch: "main"
    }, {
      readRemoteBranchSha: async (checkedRoot, branch) => {
        assert.equal(checkedRoot, targetRoot);
        assert.equal(branch, "main");
        return {
          ok: true,
          output: remoteSha,
          sha: remoteSha,
          stdout: remoteSha
        };
      }
    });

    assert.equal(status.status, "blocked");
    assert.equal(status.repair?.actionId, MIRROR_REMOTE_BRANCH_ACTION_ID);
    assert.equal(status.repair?.autoRun, true);
    assert.deepEqual(status.repair?.input, {
      branch: "main"
    });
  });
});

test("Project Setup hard-stops when remote has commits and local app files exist without commits", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    await mkdir(targetRoot);
    await createGitRepository(targetRoot);
    await writeFile(path.join(targetRoot, "package.json"), "{}\n", "utf8");
    const remoteSha = "b".repeat(40);

    const status = await checkRemoteSync(targetRoot, {
      nonGitEntries: ["package.json"],
      remoteDefaultBranch: "main"
    }, {
      readRemoteBranchSha: async (checkedRoot, branch) => {
        assert.equal(checkedRoot, targetRoot);
        assert.equal(branch, "main");
        return {
          ok: true,
          output: remoteSha,
          sha: remoteSha,
          stdout: remoteSha
        };
      }
    });

    assert.equal(status.status, "hard-stop");
    assert.match(status.observed, /local has no commits/u);
    assert.match(status.observed, /package\.json/u);
  });
});

test("Project Setup remote mirror repair script is valid shell", () => {
  assert.match(mirrorRemoteBranchScript(), /VIBE64_REMOTE_BRANCH is required/u);
  assert.doesNotMatch(mirrorRemoteBranchScript(), /gh auth token/u);
  assert.doesNotMatch(mirrorRemoteBranchScript(), /vibe64_enable_github_git_auth/u);
  assert.doesNotMatch(mirrorRemoteBranchScript(), /GIT_ASKPASS/u);
  assert.doesNotMatch(mirrorRemoteBranchScript(), /credential\.helper=/u);
  assert.match(mirrorRemoteBranchScript(), /timeout 120s git -c safe\.directory="\$PWD" fetch/u);
  assert.match(mirrorRemoteBranchScript(), /Refusing to mirror remote over existing local files/u);
  assert.match(mirrorRemoteBranchScript(), /vibe64\.project\.json/u);
  assert.match(mirrorRemoteBranchScript(), /vibe64\.runtime-lock\.json/u);
  assert.match(mirrorRemoteBranchScript(), /\.vibe64\/\*/u);
  assert.match(mirrorRemoteBranchScript(), /project-knowledge\|prompts\|scripts/u);
  assert.match(mirrorRemoteBranchScript(), /git -c safe\.directory="\$PWD" reset --hard "\$remote_ref"/u);
  assertShellScriptSurvivesWhitespaceCollapse(mirrorRemoteBranchScript());
});

test("Project Setup GitHub repo repair links existing repos and only pushes when commits exist", () => {
  const script = ghRepoCreateScript("exampleapp");

  assert.match(script, /gh repo view "\$repo_slug" --json url/u);
  assert.match(script, /git_safe remote add origin "\$repo_url"/u);
  assert.match(script, /Linked existing GitHub repository/u);
  assert.match(script, /if git_safe rev-parse --verify HEAD/u);
  assert.match(script, /git_safe push -u origin HEAD/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("Project Setup checkpoint repair commits and pushes the baseline", () => {
  const script = gitCheckpointScript();

  assert.doesNotMatch(script, /gh auth token/u);
  assert.doesNotMatch(script, /vibe64_enable_github_git_auth/u);
  assert.doesNotMatch(script, /GIT_ASKPASS/u);
  assert.doesNotMatch(script, /credential\.helper=/u);
  assert.match(script, /git -c safe\.directory="\$PWD" commit -m "\$VIBE64_COMMIT_MESSAGE"/u);
  assert.match(script, /remote_ref="refs\/heads\/\$branch"/u);
  assert.match(script, /merge-base --is-ancestor "\$tracking_ref" HEAD/u);
  assert.match(script, /Matching Vibe64 seed placeholder found/u);
  assert.match(script, /merge --allow-unrelated-histories --strategy=ours/u);
  assert.match(script, /origin\/%s contains history that is not in this local checkout/u);
  assert.match(script, /git -c safe\.directory="\$PWD" push -u origin "HEAD:\$remote_ref"/u);
  assert.doesNotMatch(script, /Working tree is already clean/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("Project Setup checkpoint refuses to push over unrelated remote history", async () => {
  await withTemporaryRoot(async (root) => {
    const localRoot = path.join(root, "local");
    const remoteSourceRoot = path.join(root, "remote-source");
    const remoteRoot = path.join(root, "origin.git");
    await Promise.all([
      mkdir(localRoot),
      mkdir(remoteSourceRoot)
    ]);
    await createCommittedGitRepository(localRoot);
    await createGitRepository(remoteSourceRoot);
    runGit(remoteSourceRoot, ["config", "user.name", "Studio Test"]);
    runGit(remoteSourceRoot, ["config", "user.email", "studio-test@example.com"]);
    await writeFile(path.join(remoteSourceRoot, "README.md"), "# Remote placeholder\n", "utf8");
    runGit(remoteSourceRoot, ["add", "README.md"]);
    runGit(remoteSourceRoot, ["commit", "-m", "Remote placeholder"]);
    runGit(root, ["init", "--bare", remoteRoot]);
    runGit(remoteSourceRoot, ["remote", "add", "origin", remoteRoot]);
    runGit(remoteSourceRoot, ["push", "origin", "main"]);
    runGit(localRoot, ["remote", "add", "origin", remoteRoot]);
    const remoteHeadBefore = runGit(root, ["--git-dir", remoteRoot, "rev-parse", "refs/heads/main"]);

    const result = spawnSync("bash", ["-lc", gitCheckpointScript()], {
      cwd: localRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        VIBE64_CHECKPOINT_ALLOW_CREATE: "0",
        VIBE64_COMMIT_MESSAGE: "Initial project setup"
      }
    });

    assert.equal(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /contains history that is not in this local checkout/u);
    assert.match(`${result.stdout}\n${result.stderr}`, /Nothing was pushed/u);
    assert.equal(
      runGit(root, ["--git-dir", remoteRoot, "rev-parse", "refs/heads/main"]),
      remoteHeadBefore
    );
  });
});

test("Project Setup checkpoint preserves and publishes over the matching seed placeholder", async () => {
  await withTemporaryRoot(async (root) => {
    const localRoot = path.join(root, "local");
    const remoteSourceRoot = path.join(root, "remote-source");
    const remoteRoot = path.join(root, "origin.git");
    const seedMetadata = `${JSON.stringify({
      id: "jskit-accounts",
      repository: "vibe64-dev/jskit-seed-accounts",
      schema: "vibe64.seed",
      schemaVersion: 1
    }, null, 2)}\n`;
    const projectMetadata = `${JSON.stringify({
      projectType: "jskit",
      schema: "vibe64.project",
      schemaVersion: 1
    }, null, 2)}\n`;
    await Promise.all([
      mkdir(localRoot),
      mkdir(remoteSourceRoot)
    ]);
    for (const repositoryRoot of [localRoot, remoteSourceRoot]) {
      await createGitRepository(repositoryRoot);
      runGit(repositoryRoot, ["config", "user.name", "Studio Test"]);
      runGit(repositoryRoot, ["config", "user.email", "studio-test@example.com"]);
      await writeFile(path.join(repositoryRoot, "vibe64.seed.json"), seedMetadata, "utf8");
      await writeFile(path.join(repositoryRoot, "vibe64.project.json"), projectMetadata, "utf8");
    }
    await writeFile(path.join(remoteSourceRoot, "README.md"), "# Placeholder\n", "utf8");
    runGit(remoteSourceRoot, ["add", "."]);
    runGit(remoteSourceRoot, ["commit", "-m", "Add seed placeholder metadata"]);
    const placeholderCommit = runGit(remoteSourceRoot, ["rev-parse", "HEAD"]);
    await writeFile(path.join(localRoot, "README.md"), "# Complete seed\n", "utf8");
    await writeFile(path.join(localRoot, "app.js"), "export const ready = true;\n", "utf8");
    runGit(localRoot, ["add", "."]);
    runGit(localRoot, ["commit", "-m", "Build complete seed"]);
    const completedSeedCommit = runGit(localRoot, ["rev-parse", "HEAD"]);
    runGit(root, ["init", "--bare", remoteRoot]);
    runGit(remoteSourceRoot, ["remote", "add", "origin", remoteRoot]);
    runGit(remoteSourceRoot, ["push", "origin", "main"]);
    runGit(localRoot, ["remote", "add", "origin", remoteRoot]);

    const result = spawnSync("bash", ["-lc", gitCheckpointScript()], {
      cwd: localRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        VIBE64_CHECKPOINT_ALLOW_CREATE: "0",
        VIBE64_COMMIT_MESSAGE: "Initial project setup"
      }
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /Matching Vibe64 seed placeholder found/u);
    const publishedCommit = runGit(localRoot, ["rev-parse", "HEAD"]);
    assert.equal(runGit(root, ["--git-dir", remoteRoot, "rev-parse", "refs/heads/main"]), publishedCommit);
    assert.equal(
      runGit(localRoot, ["show", "-s", "--format=%P", publishedCommit]),
      `${completedSeedCommit} ${placeholderCommit}`
    );
    assert.equal(runGit(localRoot, ["show", `${publishedCommit}:app.js`]), "export const ready = true;");
  });
});

test("Project Setup builds GitHub branch ref API paths", () => {
  assert.equal(
    githubBranchRefApiPath("mercmobily/exampleapp", "main"),
    "repos/mercmobily/exampleapp/git/ref/heads/main"
  );
  assert.equal(
    githubBranchRefApiPath("mercmobily/exampleapp", "feature/setup baseline"),
    "repos/mercmobily/exampleapp/git/ref/heads/feature/setup%20baseline"
  );
});

test("Project Setup treats an empty GitHub repository as a missing remote checkpoint branch", () => {
  const result = normalizeRemoteBranchShaWithGhResult({
    exitCode: 1,
    ok: false,
    output: [
      "gh: Git Repository is empty. (HTTP 409)",
      "{\"message\":\"Git Repository is empty.\",\"status\":\"409\"}"
    ].join("\n"),
    stderr: "gh: Git Repository is empty. (HTTP 409)",
    stdout: ""
  }, {
    branch: "main",
    repoSlug: "mercmobily/exampleapp"
  });

  assert.equal(result.ok, true);
  assert.equal(result.sha, "");
  assert.equal(result.output, "GitHub repository mercmobily/exampleapp does not have refs/heads/main yet.");
});

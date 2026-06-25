import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  ADD_VIBE64_GITIGNORE_RULES_ACTION_ID,
  VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS,
  MIRROR_REMOTE_BRANCH_ACTION_ID,
  mirrorRemoteBranchScript,
  normalizeRemoteBranchShaWithGhResult
} from "@local/setup-doctor-core/server/setupDoctorGit";
import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  VIBE64_PROVIDER_HOMES_ROOT_ENV
} from "@local/studio-terminal-core/server/providerHomes";
import {
  closeTerminalSession,
  startTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  TERMINAL_OWNER_MISMATCH_CODE,
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

const LOCAL_GITHUB_CACHE_SCOPE = "github:local";
const USER_GITHUB_CACHE_SCOPE = "github:ada@example.com";
const PROJECT_SETUP_TERMINAL_NAMESPACE = "project-setup-doctor";
process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-tenant";

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

test("Project Setup treats project-local .vibe64 as unexpected checkout content", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, ".vibe64", "config"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".vibe64", "project_type"), "jskit\n", "utf8");

    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.ready, false);
    assert.equal(status.hardStop, true);
    assert.equal(status.currentStageId, "directory");
    assert.equal(status.stages[0].status, "hard-stop");
    assert.match(status.stages[0].observed, /\.vibe64/u);
    assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.status, "pending");
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

test("Project Setup blocks checkpointing without project-local Vibe64 ignore rules", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCommittedGitRepository(targetRoot);

    const status = await inspectProjectSetup({
      targetRoot
    });

    const ignoreStage = status.stages.find((stage) => stage.id === "vibe64-gitignore");
    assert.equal(status.currentStageId, "vibe64-gitignore");
    assert.equal(ignoreStage?.status, "blocked");
    assert.equal(ignoreStage?.repair?.actionId, ADD_VIBE64_GITIGNORE_RULES_ACTION_ID);
    assert.match(ignoreStage?.observed || "", /\.vibe64-local\//u);
    assert.equal(status.stages.find((stage) => stage.id === "remote-ready")?.status, "pending");
  });
});

test("Project Setup retries automatic repairs when the same check reports a new blocker", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCommittedGitRepository(targetRoot);
    const attempts = [];
    let ignoreRuleRepairAttempts = 0;

    const status = await inspectProjectSetup({
      autoRepair: true,
      startAutomaticRepair: async ({
        repair
      }) => {
        attempts.push(repair.actionId);
        if (repair.actionId === ADD_VIBE64_GITIGNORE_RULES_ACTION_ID) {
          ignoreRuleRepairAttempts += 1;
          await writeFile(
            path.join(targetRoot, ".gitignore"),
            `${VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.slice(0, ignoreRuleRepairAttempts).join("\n")}\n`,
            "utf8"
          );
          return {
            exitCode: 0,
            ok: true,
            output: "updated .gitignore",
            status: "exited"
          };
        }
        return {
          error: "gh unavailable",
          exitCode: 1,
          ok: false,
          output: "gh unavailable",
          status: "exited"
        };
      },
      targetRoot
    });

    assert.deepEqual(attempts, [
      ADD_VIBE64_GITIGNORE_RULES_ACTION_ID,
      "terminal-gh-create-repo"
    ]);
    assert.equal(status.stages.find((stage) => stage.id === "vibe64-gitignore")?.status, "pass");
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
      refresh: true
    });

    assert.equal(status.currentStageId, "vibe64-gitignore");
    assert.equal(status.stages.find((stage) => stage.id === "vibe64-gitignore")?.status, "blocked");
    assert.equal(status.stages.find((stage) => stage.id === "remote-ready")?.status, "pending");
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
      await writeFile(
        path.join(targetRoot, ".gitignore"),
        `${VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.join("\n")}\n`,
        "utf8"
      );
      runGit(targetRoot, ["add", "README.md"]);
      runGit(targetRoot, ["add", ".gitignore"]);
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
      const cached = await service.getStatus();
      assert.equal(cached.ready, true);
      assert.equal(cached.currentStageId, "");

      const refreshed = await service.getStatus({
        refresh: true
      });
      assert.equal(refreshed.ready, false);
      assert.equal(refreshed.currentStageId, "remote-ready");

      const afterRefresh = await service.getStatus();
      assert.equal(afterRefresh.ready, false);
      assert.equal(afterRefresh.currentStageId, "remote-ready");
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

test("Project Setup can scope ready cache to a per-user GitHub account", async () => {
  await withTemporaryRoot(async (cacheRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      await withTemporaryRoot(async (providerHomesRoot) => {
        const testEnv = createProjectSetupTestEnv(cacheRoot);
        await createGitRepository(targetRoot);
        runGit(targetRoot, ["config", "user.name", "Studio Test"]);
        runGit(targetRoot, ["config", "user.email", "studio-test@example.com"]);
        await writeFile(path.join(targetRoot, "README.md"), "# Cached ready\n", "utf8");
        await writeFile(
          path.join(targetRoot, ".gitignore"),
          `${VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.join("\n")}\n`,
          "utf8"
        );
        runGit(targetRoot, ["add", "README.md"]);
        runGit(targetRoot, ["add", ".gitignore"]);
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
          providerHomesRoot,
          studioRoot: targetRoot,
          targetRoot
        }).getStatus({
          vibe64User: {
            email: "Ada@Example.com"
          }
        });

        assert.equal(userScopedStatus.ready, true);
        assert.equal(userScopedStatus.currentStageId, "");

        const localScopedStatus = await createService({
          env: testEnv,
          providerHomesRoot,
          studioRoot: targetRoot,
          targetRoot
        }).getStatus({
          vibe64User: {
            email: "Ada@Example.com"
          }
        });

        assert.equal(localScopedStatus.ready, false);
        assert.equal(localScopedStatus.currentStageId, "remote-ready");
      });
    });
  });
});

test("Project Setup terminal lifecycle enforces the recorded GitHub owner", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await withTemporaryRoot(async (providerHomesRoot) => {
      const userHome = path.join(providerHomesRoot, "github", "ada@example.com");
      const env = {
        ...process.env,
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      };
      const service = createService({
        env,
        githubAccountMode: GITHUB_ACCOUNT_MODE_USER,
        providerHomesRoot,
        studioRoot: targetRoot,
        targetRoot
      });
      const metadata = terminalOwnerMetadata(terminalOwnerFromGithubToolHome({
        accountMode: GITHUB_ACCOUNT_MODE_USER,
        ownerEmail: "ada@example.com",
        ownerUserKey: "ada@example.com",
        providerScope: "user",
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
            email: "ada@example.com"
          }
        };
        const otherInput = {
          vibe64User: {
            email: "bob@example.com"
          }
        };

        assert.equal(service.readTerminal(terminal.id, ownerInput).ok, true);

        const wrongRead = service.readTerminal(terminal.id, otherInput);
        assert.equal(wrongRead.ok, false);
        assert.equal(wrongRead.code, TERMINAL_OWNER_MISMATCH_CODE);

        const wrongWrite = service.writeTerminal(terminal.id, "\r", otherInput);
        assert.equal(wrongWrite.ok, false);
        assert.equal(wrongWrite.code, TERMINAL_OWNER_MISMATCH_CODE);

        const wrongClose = await service.closeTerminal(terminal.id, otherInput);
        assert.equal(wrongClose.ok, false);
        assert.equal(wrongClose.code, TERMINAL_OWNER_MISMATCH_CODE);
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
      email: "ada@example.com",
      ok: true,
      providerScope: "user",
      toolHomeSource: "/srv/vibe64/provider-homes/github/ada@example.com",
      userKey: "ada@example.com"
    }
  });

  assert.equal(metadata.projectSetupActionId, "terminal-gh-create-repo");
  assert.equal(metadata.terminalKind, PROJECT_SETUP_TERMINAL_NAMESPACE);
  assert.equal(metadata.terminalOwner.ownerScope, "user");
  assert.equal(metadata.terminalOwner.ownerUserKey, "ada@example.com");
  assert.equal(metadata.terminalOwner.ownerEmail, "ada@example.com");
  assert.equal(metadata.terminalOwner.githubProviderScope, "user");
  assert.equal(metadata.terminalOwner.githubToolHomeSource, "/srv/vibe64/provider-homes/github/ada@example.com");
});

test("Project Setup terminal lifecycle allows local-mode ownership without a user", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await withTemporaryRoot(async (providerHomesRoot) => {
      const localHome = path.join(providerHomesRoot, "github", "local");
      const env = {
        ...process.env,
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      };
      const service = createService({
        env,
        providerHomesRoot,
        studioRoot: targetRoot,
        targetRoot
      });
      const metadata = terminalOwnerMetadata(terminalOwnerFromGithubToolHome({
        accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
        ownerUserKey: "local",
        providerScope: "app",
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

test("Project Setup ready cache reuse does not require Docker or setup plugins", async () => {
  await withTemporaryRoot(async (cacheRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      const testEnv = createProjectSetupTestEnv(cacheRoot, {
        DOCKER_HOST: "unix:///tmp/vibe64-docker-should-not-be-used.sock"
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
      const cachedOnlyStatus = await service.getCachedStatus();
      const status = await service.getStatus();

      assert.equal(cachedOnlyStatus.ready, true);
      assert.equal(status.ready, true);
      assert.equal(readProjectConfigCalls, 2);
      assert.equal(createRuntimeCalls, 0);
    });
  });
});
test("Project Setup continues to remote setup when Vibe64 ignore rules are present", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCommittedGitRepository(targetRoot);
    await writeFile(
      path.join(targetRoot, ".gitignore"),
      `${VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.join("\n")}\n`,
      "utf8"
    );
    runGit(targetRoot, ["add", ".gitignore"]);
    runGit(targetRoot, ["commit", "-m", "Add Vibe64 ignore rules"]);

    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.stages.find((stage) => stage.id === "vibe64-gitignore")?.status, "pass");
    assert.equal(status.currentStageId, "remote-ready");
    assert.equal(status.stages.find((stage) => stage.id === "remote-ready")?.status, "blocked");
  });
});

test("Project Setup treats a named remote default branch without a ref as empty", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    await mkdir(targetRoot);
    await createGitRepository(targetRoot);
    runGit(targetRoot, ["init", "--bare", "-b", "main", "remote.git"]);
    runGit(targetRoot, ["remote", "add", "origin", "remote.git"]);

    const status = await checkRemoteSync(targetRoot, {
      remoteDefaultBranch: "main"
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
          toolHomeSource: "/tmp/vibe64-gh-home"
        },
        repoSlug: "mercmobily/private-app",
        root: targetRoot
      }
    ]);
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
    const remoteRoot = path.join(targetRoot, "remote.git");
    const sourceRoot = path.join(root, "source");
    await mkdir(targetRoot);
    await createGitRepository(targetRoot);
    await writeFile(path.join(targetRoot, ".gitignore"), ".vibe64-local/\n", "utf8");
    runGit(targetRoot, ["init", "--bare", "-b", "main", "remote.git"]);

    await mkdir(sourceRoot, {
      recursive: true
    });
    runGit(sourceRoot, ["init", "-b", "main"]);
    runGit(sourceRoot, ["config", "user.name", "Studio Test"]);
    runGit(sourceRoot, ["config", "user.email", "studio-test@example.com"]);
    await writeFile(path.join(sourceRoot, "README.md"), "# Remote\n", "utf8");
    runGit(sourceRoot, ["add", "README.md"]);
    runGit(sourceRoot, ["commit", "-m", "Initial remote commit"]);
    runGit(sourceRoot, ["remote", "add", "origin", remoteRoot]);
    runGit(sourceRoot, ["push", "origin", "main"]);
    runGit(targetRoot, ["remote", "add", "origin", "remote.git"]);

    const status = await checkRemoteSync(targetRoot, {
      nonGitEntries: [".gitignore"],
      remoteDefaultBranch: "main"
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
    const remoteRoot = path.join(targetRoot, "remote.git");
    const sourceRoot = path.join(root, "source");
    await mkdir(targetRoot);
    await createGitRepository(targetRoot);
    await writeFile(path.join(targetRoot, "package.json"), "{}\n", "utf8");
    runGit(targetRoot, ["init", "--bare", "-b", "main", "remote.git"]);

    await mkdir(sourceRoot, {
      recursive: true
    });
    runGit(sourceRoot, ["init", "-b", "main"]);
    runGit(sourceRoot, ["config", "user.name", "Studio Test"]);
    runGit(sourceRoot, ["config", "user.email", "studio-test@example.com"]);
    await writeFile(path.join(sourceRoot, "README.md"), "# Remote\n", "utf8");
    runGit(sourceRoot, ["add", "README.md"]);
    runGit(sourceRoot, ["commit", "-m", "Initial remote commit"]);
    runGit(sourceRoot, ["remote", "add", "origin", remoteRoot]);
    runGit(sourceRoot, ["push", "origin", "main"]);
    runGit(targetRoot, ["remote", "add", "origin", "remote.git"]);

    const status = await checkRemoteSync(targetRoot, {
      nonGitEntries: ["package.json"],
      remoteDefaultBranch: "main"
    });

    assert.equal(status.status, "hard-stop");
    assert.match(status.observed, /local has no commits/u);
    assert.match(status.observed, /package\.json/u);
  });
});

test("Project Setup remote mirror repair script is valid shell", () => {
  assert.match(mirrorRemoteBranchScript(), /VIBE64_REMOTE_BRANCH is required/u);
  assert.match(mirrorRemoteBranchScript(), /gh auth token/u);
  assert.match(mirrorRemoteBranchScript(), /GIT_ASKPASS=\/tmp\/vibe64-git-askpass/u);
  assert.match(mirrorRemoteBranchScript(), /GIT_TERMINAL_PROMPT=0/u);
  assert.match(mirrorRemoteBranchScript(), /timeout 120s git -c safe\.directory=\/workspace -c credential\.helper= fetch/u);
  assert.match(mirrorRemoteBranchScript(), /Refusing to mirror remote over existing local files/u);
  assert.match(mirrorRemoteBranchScript(), /git -c safe\.directory=\/workspace reset --hard "\$remote_ref"/u);
  assertShellScriptSurvivesWhitespaceCollapse(mirrorRemoteBranchScript());
});

test("Project Setup GitHub repo repair links existing repos and only pushes when commits exist", () => {
  const script = ghRepoCreateScript("exampleapp");

  assert.match(script, /gh repo view "\$repo_slug" --json url/u);
  assert.match(script, /git remote add origin "\$repo_url"/u);
  assert.match(script, /Linked existing GitHub repository/u);
  assert.match(script, /if git rev-parse --verify HEAD/u);
  assert.match(script, /--push/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("Project Setup checkpoint repair commits and pushes the baseline", () => {
  const script = gitCheckpointScript();

  assert.match(script, /gh auth token/u);
  assert.match(script, /GIT_ASKPASS=\/tmp\/vibe64-git-askpass/u);
  assert.match(script, /if \[ "\$\(id -u\)" = "0" \] && command -v setpriv/u);
  assert.match(script, /setpriv --reuid "\$VIBE64_HOST_UID" --regid "\$VIBE64_HOST_GID"/u);
  assert.match(script, /if \[ "\$\(id -u\)" = "0" \]; then chown "\$VIBE64_HOST_UID:\$VIBE64_HOST_GID"/u);
  assert.match(script, /as_host git -c safe\.directory=\/workspace commit -m "\$VIBE64_COMMIT_MESSAGE"/u);
  assert.match(script, /remote_ref="refs\/heads\/\$branch"/u);
  assert.match(script, /as_host git -c safe\.directory=\/workspace -c credential\.helper= push -u origin "HEAD:\$remote_ref"/u);
  assert.match(script, /GIT_TERMINAL_PROMPT=0/u);
  assert.doesNotMatch(script, /Working tree is already clean/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
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

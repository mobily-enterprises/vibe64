import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  resolveGithubToolHomeForActor
} from "@local/studio-terminal-core/server/providerHomes";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  terminalOwnerForGithubActor,
  terminalOwnerMatchesRequest,
  terminalOwnerMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  closeTerminalSessionsForNamespacePrefix,
  readTerminalSession,
  startTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  CODEX_ATTACHMENT_CONTAINER_ROOT
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import {
  createCodexGitCommandService,
  createCodexGitManagedCommandRunner,
  prepareCodexGitCommand
} from "@local/vibe64-terminals/server/codexGitCommand";
import {
  codexAppTerminalOwnerMetadata
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";
import {
  sessionGitCommandActorMetadata
} from "../../packages/vibe64-terminals/src/server/sessionGitCommandActor.js";
import {
  closeLegacyOwnerlessTerminalSessions,
  closeOwnedTerminalSession,
  DEFAULT_LEGACY_OWNERLESS_TERMINAL_TTL_MS,
  readOwnedTerminalSession,
  resizeOwnedTerminalSession,
  subscribeOwnedTerminalSession,
  writeOwnedTerminalSession
} from "../../packages/studio-terminal-core/src/server/terminalAccess.js";

const providerHomesRoot = "/tmp/vibe64-provider-homes-test";
process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-tenant";
const userA = {
  email: "UserA@example.com"
};
const userB = {
  email: "userb@example.com"
};

function projectServiceWithSession(session = {}, {
  createRuntimeCalls = [],
  metadataWrites = []
} = {}) {
  return {
    createRuntime: async (options = {}) => {
      createRuntimeCalls.push(options);
      return {
        getSession: async () => session,
        store: {
          writeMetadataValue: async (sessionId, name, value) => {
            metadataWrites.push({
              name,
              sessionId,
              value
            });
          }
        }
      };
    }
  };
}

function runNode(args = [], {
  cwd = process.cwd(),
  env = process.env,
  input = ""
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => {
      resolve({
        status,
        stderr,
        stdout
      });
    });
    child.stdin?.end(input);
  });
}

test("GitHub actor home resolution uses local mode without a user", () => {
  const result = resolveGithubToolHomeForActor({
    accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    providerHomesRoot
  });

  assert.equal(result.ok, true);
  assert.equal(result.accountMode, GITHUB_ACCOUNT_MODE_LOCAL);
  assert.equal(result.ownerUserKey, "local");
  assert.equal(result.toolHomeSource, `${providerHomesRoot}/github/local`);
});

test("GitHub actor home resolution uses the authenticated user in user mode", () => {
  const result = resolveGithubToolHomeForActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: userA
  });

  assert.equal(result.ok, true);
  assert.equal(result.accountMode, GITHUB_ACCOUNT_MODE_USER);
  assert.equal(result.ownerEmail, "usera@example.com");
  assert.equal(result.ownerUserKey, "usera@example.com");
  assert.equal(result.toolHomeSource, `${providerHomesRoot}/github/usera@example.com`);
});

test("GitHub actor home resolution does not fall back to local in user mode", () => {
  const result = resolveGithubToolHomeForActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot
  });

  assert.equal(result.ok, false);
  assert.equal(result.accountMode, GITHUB_ACCOUNT_MODE_USER);
  assert.equal(result.code, "vibe64_user_required");
});

test("GitHub actor home resolution fails loudly without a provider homes root", () => {
  const result = resolveGithubToolHomeForActor({
    accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    providerHomesRoot: ""
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_provider_homes_root_required");
});

test("GitHub actor home resolution rejects unsafe user keys", () => {
  const result = resolveGithubToolHomeForActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: {
      email: "../user@example.com"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_user_required");
});

test("GitHub actor home resolution reads account mode from env", () => {
  const result = resolveGithubToolHomeForActor({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER
    },
    providerHomesRoot,
    vibe64User: userA
  });

  assert.equal(result.ok, true);
  assert.equal(result.accountMode, GITHUB_ACCOUNT_MODE_USER);
  assert.equal(result.ownerUserKey, "usera@example.com");
});

test("terminal ownership allows the same local actor", () => {
  const owner = terminalOwnerForGithubActor({
    accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    providerHomesRoot
  });
  const result = terminalOwnerMatchesRequest(terminalOwnerMetadata(owner), {
    accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    providerHomesRoot
  });

  assert.equal(result.ok, true);
});

test("terminal ownership metadata does not reject another tenant member", () => {
  const owner = terminalOwnerForGithubActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: userA
  });
  assert.equal(owner.ok, true);
  const metadata = terminalOwnerMetadata(owner);
  const result = terminalOwnerMatchesRequest(metadata, {
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: userB
  });

  assert.equal(result.ok, true);
  assert.equal(result.ownerScope, "user");
  assert.equal(result.ownerUserKey, "usera@example.com");
});

test("terminal ownership allows the same online user", () => {
  const owner = terminalOwnerForGithubActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: userA
  });
  const result = terminalOwnerMatchesRequest(terminalOwnerMetadata(owner), {
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: userA
  });

  assert.equal(result.ok, true);
});

test("ownerless terminals are tolerated in online user mode and local mode", () => {
  const online = terminalOwnerMatchesRequest({}, {
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: userA
  });
  const local = terminalOwnerMatchesRequest({}, {
    accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    providerHomesRoot
  });

  assert.equal(online.ok, true);
  assert.equal(online.legacyOwnerless, true);
  assert.equal(local.ok, true);
  assert.equal(local.legacyOwnerless, true);
});

test("app-owned terminals are readable by tenant members", () => {
  const metadata = terminalOwnerMetadata({
    ownerScope: "app",
    ownerUserKey: "app"
  });
  const userAccess = terminalOwnerMatchesRequest(metadata, {
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: userA
  });
  const appAccess = terminalOwnerMatchesRequest(metadata, {
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot
  });

  assert.equal(userAccess.ok, true);
  assert.equal(userAccess.ownerScope, "app");
  assert.equal(userAccess.ownerUserKey, "app");
  assert.equal(appAccess.ok, true);
});

test("Codex terminal ownership metadata is app-scoped", () => {
  const metadata = codexAppTerminalOwnerMetadata({
    toolHomeSource: "/srv/vibe64/provider-homes/codex"
  });

  assert.equal(metadata.terminalOwner.ownerScope, "app");
  assert.equal(metadata.terminalOwner.ownerUserKey, "codex");
  assert.equal(metadata.terminalOwner.githubProviderScope, "app");
  assert.equal(metadata.terminalOwner.githubToolHomeSource, "/srv/vibe64/provider-homes/codex");
});

test("session Git command actor metadata records the authenticated user in user mode", () => {
  const result = sessionGitCommandActorMetadata({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER
    },
    reason: "unit-test",
    session: {
      sessionId: "session-1"
    },
    targetRoot: "/tmp/project",
    threadId: "thread-1",
    vibe64User: {
      email: "Ada@Example.com"
    },
    workdir: "/tmp/project/worktree"
  });

  assert.equal(result.ok, true);
  assert.equal(result.metadata.session_git_command_actor_reason, "unit-test");
  assert.equal(result.metadata.session_git_command_actor_scope, "user");
  assert.equal(result.metadata.session_git_command_actor_email, "ada@example.com");
  assert.equal(result.metadata.session_git_command_actor_user_key, "ada@example.com");
  assert.equal(result.metadata.session_git_command_actor_session_id, "session-1");
  assert.equal(result.metadata.session_git_command_actor_thread_id, "thread-1");
  assert.equal(result.metadata.session_git_command_actor_target_root, "/tmp/project");
  assert.equal(result.metadata.session_git_command_actor_workdir, "/tmp/project/worktree");
});

test("terminal owner metadata allows read, write, resize, subscribe, and close for another tenant member", async () => {
  const namespace = `github-owner-test-${crypto.randomUUID()}`;
  const logs = [];
  const logger = {
    warn(fields, message) {
      logs.push({
        fields,
        message
      });
    }
  };
  const owner = terminalOwnerForGithubActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: userA
  });
  const terminal = startTerminalSession({
    args: [
      "-e",
      "process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "node long-running",
    metadata: terminalOwnerMetadata(owner),
    namespace
  });
  const wrongUserInput = {
    vibe64User: userB
  };
  const ownerCheckEnv = {
    [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER,
    VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
  };

  try {
    assert.equal(terminal.ok, true);
    for (const result of [
      readOwnedTerminalSession(terminal.id, {
        env: ownerCheckEnv,
        input: wrongUserInput,
        logger,
        namespace
      }),
      writeOwnedTerminalSession(terminal.id, "input", {
        env: ownerCheckEnv,
        input: wrongUserInput,
        namespace
      }),
      resizeOwnedTerminalSession(terminal.id, {
        cols: 100,
        rows: 30
      }, {
        env: ownerCheckEnv,
        input: wrongUserInput,
        namespace
      }),
      subscribeOwnedTerminalSession(terminal.id, () => null, {
        env: ownerCheckEnv,
        input: wrongUserInput,
        namespace
      }),
      await closeOwnedTerminalSession(terminal.id, {
        env: ownerCheckEnv,
        input: wrongUserInput,
        namespace
      })
    ]) {
      assert.equal(result.ok, true);
    }
    assert.equal(logs.length, 0);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("legacy ownerless local terminal access is logged", async () => {
  const namespace = `github-legacy-ownerless-test-${crypto.randomUUID()}`;
  const logs = [];
  const logger = {
    warn(fields, message) {
      logs.push({
        fields,
        message
      });
    }
  };
  const terminal = startTerminalSession({
    args: [
      "-e",
      "process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "node legacy-ownerless",
    metadata: {
      sessionId: "legacy-session",
      terminalKind: "shell"
    },
    namespace
  });
  const ownerCheckEnv = {
    [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_LOCAL,
    VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
  };

  try {
    assert.equal(terminal.ok, true);
    const subscription = subscribeOwnedTerminalSession(terminal.id, () => null, {
      env: ownerCheckEnv,
      logger,
      namespace
    });
    assert.equal(subscription.ok, true);
    subscription.unsubscribe();

    for (const result of [
      readOwnedTerminalSession(terminal.id, {
        env: ownerCheckEnv,
        logger,
        namespace
      }),
      writeOwnedTerminalSession(terminal.id, "input", {
        env: ownerCheckEnv,
        logger,
        namespace
      }),
      resizeOwnedTerminalSession(terminal.id, {
        cols: 100,
        rows: 30
      }, {
        env: ownerCheckEnv,
        logger,
        namespace
      }),
      await closeOwnedTerminalSession(terminal.id, {
        env: ownerCheckEnv,
        logger,
        namespace
      })
    ]) {
      assert.equal(result.ok, true);
    }

    assert.deepEqual(logs.map((entry) => entry.fields.action), [
      "subscribe",
      "read",
      "write",
      "resize",
      "close"
    ]);
    for (const entry of logs) {
      assert.equal(entry.fields.event, "vibe64.terminal.legacy_ownerless_access");
      assert.equal(entry.fields.code, "vibe64_terminal_legacy_ownerless");
      assert.equal(entry.fields.terminalId, terminal.id);
      assert.equal(entry.fields.sessionId, "legacy-session");
      assert.equal(entry.fields.terminalKind, "shell");
      assert.match(entry.message, /legacy terminal/u);
    }
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("legacy ownerless terminal cleanup closes stale ownerless sessions only", async () => {
  const namespacePrefix = `github-legacy-ownerless-cleanup-${crypto.randomUUID()}`;
  const owner = terminalOwnerForGithubActor({
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: userA
  });
  const logs = [];
  const logger = {
    warn(fields, message) {
      logs.push({
        fields,
        message
      });
    }
  };
  const legacyTerminal = startTerminalSession({
    args: [
      "-e",
      "process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "node legacy-ownerless",
    metadata: {
      sessionId: "legacy-cleanup-session",
      terminalKind: "shell"
    },
    namespace: `${namespacePrefix}:legacy`
  });
  const ownedTerminal = startTerminalSession({
    args: [
      "-e",
      "process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "node owned",
    metadata: {
      ...terminalOwnerMetadata(owner),
      sessionId: "owned-session",
      terminalKind: "shell"
    },
    namespace: `${namespacePrefix}:owned`
  });

  try {
    assert.equal(legacyTerminal.ok, true);
    assert.equal(ownedTerminal.ok, true);

    const result = await closeLegacyOwnerlessTerminalSessions({
      logger,
      namespacePrefix,
      now: Date.now() + DEFAULT_LEGACY_OWNERLESS_TERMINAL_TTL_MS + 1000,
      ttlMs: DEFAULT_LEGACY_OWNERLESS_TERMINAL_TTL_MS
    });

    assert.equal(result.ok, true);
    assert.equal(result.closed, 1);
    assert.deepEqual(result.closedTerminals, [{
      id: legacyTerminal.id,
      namespace: `${namespacePrefix}:legacy`
    }]);
    assert.equal(readTerminalSession(legacyTerminal.id, {
      namespace: `${namespacePrefix}:legacy`
    }).ok, false);
    assert.equal(readTerminalSession(ownedTerminal.id, {
      namespace: `${namespacePrefix}:owned`
    }).ok, true);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].fields.event, "vibe64.terminal.legacy_ownerless_cleanup");
    assert.equal(logs[0].fields.code, "vibe64_terminal_legacy_ownerless_cleanup");
    assert.equal(logs[0].fields.terminalId, legacyTerminal.id);
    assert.equal(logs[0].fields.sessionId, "legacy-cleanup-session");
    assert.equal(logs[0].fields.terminalNamespace, `${namespacePrefix}:legacy`);
    assert.match(logs[0].message, /closed a legacy terminal/u);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespacePrefix);
  }
});

test("Codex git command service runs raw git as the session Git command actor", async () => {
  const calls = [];
  const createRuntimeCalls = [];
  const service = createCodexGitCommandService({
    env: {
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        session_git_command_actor_scope: "local",
        session_git_command_actor_session_id: "session-1",
        session_git_command_actor_target_root: "/tmp/project",
        session_git_command_actor_thread_id: "thread-1",
        session_git_command_actor_user_key: "local",
        session_git_command_actor_workdir: "/tmp/project/worktree"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }, {
      createRuntimeCalls
    }),
    runCommand: async (command, args, options) => {
      calls.push({
        args,
        command,
        options
      });
      return {
        exitCode: 0,
        ok: true,
        stdout: " M file.txt\n"
      };
    }
  });

  const result = await service.run({
    args: ["status", "--short"],
    command: "git",
    cwd: "/tmp/project/worktree",
    inputBase64: Buffer.from("ignored stdin").toString("base64"),
    sessionId: "session-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.stdout, " M file.txt\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "git");
  assert.deepEqual(calls[0].args, ["status", "--short"]);
  assert.equal(calls[0].options.cwd, "/tmp/project/worktree");
  assert.equal(calls[0].options.env.HOME, `${providerHomesRoot}/github/local`);
  assert.equal(calls[0].options.env.GH_CONFIG_DIR, `${providerHomesRoot}/github/local/.config/gh`);
  assert.equal(calls[0].options.input.toString("utf8"), "ignored stdin");
  assert.deepEqual(createRuntimeCalls, [{
    input: {
      sessionId: "session-1"
    }
  }]);
});

test("Codex git command service logs failed command purpose and output streams", async () => {
  const logs = [];
  const logger = {
    warn(fields, message) {
      logs.push({
        fields,
        message
      });
    }
  };
  const service = createCodexGitCommandService({
    env: {
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
    },
    logger,
    projectService: projectServiceWithSession({
      metadata: {
        session_git_command_actor_scope: "local",
        session_git_command_actor_session_id: "session-1",
        session_git_command_actor_target_root: "/tmp/project",
        session_git_command_actor_user_key: "local",
        session_git_command_actor_workdir: "/tmp/project/worktree"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }),
    runCommand: async () => ({
      exitCode: 128,
      ok: false,
      signal: "SIGTERM",
      stderr: "remote: Authorization: Bearer ghs_secret\nfatal: authentication failed\n",
      stdout: "checking remote\n",
      timedOut: true
    })
  });

  const result = await service.run({
    args: [
      "fetch",
      "https://user:secret@example.com/org/repo.git"
    ],
    command: "git",
    cwd: "/tmp/project/worktree",
    purpose: "session-action.git-sync",
    sessionId: "session-1"
  });

  assert.equal(result.ok, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, "Vibe64 Codex git command finished.");
  assert.equal(logs[0].fields.event, "vibe64.codex_git_command.finished");
  assert.equal(logs[0].fields.purpose, "session-action.git-sync");
  assert.equal(logs[0].fields.commandKind, "git");
  assert.equal(logs[0].fields.cwd, "/tmp/project/worktree");
  assert.equal(logs[0].fields.sourceRoot, "/tmp/project/worktree");
  assert.equal(logs[0].fields.targetRoot, "/tmp/project");
  assert.equal(logs[0].fields.exitCode, 128);
  assert.equal(logs[0].fields.signal, "SIGTERM");
  assert.equal(logs[0].fields.timedOut, true);
  assert.equal(logs[0].fields.stdoutTail, "checking remote");
  assert.match(logs[0].fields.stderrTail, /fatal: authentication failed/u);
  assert.match(logs[0].fields.outputTail, /fatal: authentication failed/u);
  assert.match(logs[0].fields.commandSummary, /^git fetch https:\/\/\[redacted\]@example\.com\/org\/repo\.git$/u);
  assert.doesNotMatch(JSON.stringify(logs[0].fields), /secret|ghs_secret/u);
});

test("Codex git command service logs purpose and cwd for silent command failures", async () => {
  const logs = [];
  const logger = {
    warn(fields) {
      logs.push(fields);
    }
  };
  const service = createCodexGitCommandService({
    env: {
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
    },
    logger,
    projectService: projectServiceWithSession({
      metadata: {
        session_git_command_actor_scope: "local",
        session_git_command_actor_session_id: "session-1",
        session_git_command_actor_target_root: "/tmp/project",
        session_git_command_actor_user_key: "local",
        session_git_command_actor_workdir: "/tmp/project/worktree"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }),
    runCommand: async () => ({
      exitCode: 1,
      ok: false
    })
  });

  const result = await service.run({
    args: ["status", "--short"],
    command: "git",
    cwd: "/tmp/project/worktree",
    sessionId: "session-1"
  });

  assert.equal(result.ok, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].purpose, "codex-git-command.git.status");
  assert.equal(logs[0].cwd, "/tmp/project/worktree");
  assert.equal(logs[0].exitCode, 1);
  assert.equal(logs[0].stdoutTail, "");
  assert.equal(logs[0].stderrTail, "");
  assert.equal(logs[0].outputTail, "");
  assert.equal(logs[0].commandSummary, "git status --short");
});

test("Codex git managed command runner executes git inside the toolchain container", async () => {
  const calls = [];
  const networks = [];
  const runner = createCodexGitManagedCommandRunner({
    ensureRuntimeNetwork: async (targetRoot) => {
      networks.push(targetRoot);
    },
    image: "vibe64-test-toolchain:latest",
    runDockerCommand: async (command, args, options) => {
      calls.push({
        args,
        command,
        options
      });
      return {
        exitCode: 0,
        ok: true,
        stdout: "cloned\n"
      };
    }
  });
  const input = Buffer.from("stdin text");

  const result = await runner("git", [
    "clone",
    "https://github.com/example/repo.git",
    "/home/vibe64/.codex/.tmp/plugins-clone-test"
  ], {
    cwd: "/tmp/project/worktree",
    githubToolHomeSource: "/provider-homes/github/local",
    input,
    targetRoot: "/tmp/project",
    timeout: 1234,
    toolHomeSource: "/provider-homes/codex"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(networks, ["/tmp/project"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "docker");
  assert.equal(calls[0].options.input, input);
  assert.equal(calls[0].options.timeout, 1234);
  assert.equal(calls[0].args[0], "run");
  assert.ok(calls[0].args.includes("/provider-homes/codex:/home/vibe64"));
  assert.ok(calls[0].args.includes("/provider-homes/github/local:/home/vibe64/.vibe64-github-provider"));
  assert.ok(calls[0].args.includes("/tmp/project:/workspace"));
  assert.ok(calls[0].args.includes("/tmp/project:/tmp/project"));
  assert.equal(calls[0].args[calls[0].args.indexOf("-w") + 1], "/tmp/project/worktree");
  assert.ok(calls[0].args.includes("vibe64-test-toolchain:latest"));
  const script = calls[0].args.at(-1);
  assert.match(script, /exec git clone/u);
  assert.match(script, /\/home\/vibe64\/\.codex\/\.tmp\/plugins-clone-test/u);
});

test("Codex git command service runs with the sticky session Git command actor outside an active turn", async () => {
  const calls = [];
  const service = createCodexGitCommandService({
    env: {
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        session_git_command_actor_email: "ada@example.com",
        session_git_command_actor_scope: "user",
        session_git_command_actor_session_id: "session-1",
        session_git_command_actor_target_root: "/tmp/project",
        session_git_command_actor_thread_id: "thread-1",
        session_git_command_actor_user_key: "ada@example.com",
        session_git_command_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }),
    runCommand: async (command, args, options) => {
      calls.push({
        args,
        command,
        options
      });
      return {
        exitCode: 0,
        ok: true,
        stdout: "sticky actor\n"
      };
    }
  });

  const result = await service.run({
    args: ["status"],
    command: "git",
    cwd: "/tmp/project",
    sessionId: "session-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.stdout, "sticky actor\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.env.HOME, `${providerHomesRoot}/github/ada@example.com`);
});

test("Codex git command service fails closed without a session Git command actor", async () => {
  const calls = [];
  const service = createCodexGitCommandService({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER,
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {},
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }),
    runCommand: async (command, args, options) => {
      calls.push({
        args,
        command,
        options
      });
      return {
        exitCode: 0,
        ok: true,
        stdout: "unexpected\n"
      };
    }
  });

  const result = await service.run({
    args: ["status"],
    command: "git",
    cwd: "/tmp/project/worktree",
    sessionId: "session-1",
    systemActor: {
      actorScope: "local",
      actorUserKey: "local",
      targetRoot: "/tmp/project",
      workdir: "/tmp/project/worktree"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_session_git_command_actor_missing");
  assert.equal(calls.length, 0);
});

test("Codex git command service ignores supplied system actor and uses the session actor", async () => {
  const calls = [];
  const service = createCodexGitCommandService({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER,
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        session_git_command_actor_email: "ada@example.com",
        session_git_command_actor_scope: "user",
        session_git_command_actor_session_id: "session-1",
        session_git_command_actor_target_root: "/tmp/project",
        session_git_command_actor_thread_id: "thread-1",
        session_git_command_actor_user_key: "ada@example.com",
        session_git_command_actor_workdir: "/tmp/project/worktree"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }),
    runCommand: async (command, args, options) => {
      calls.push({
        args,
        command,
        options
      });
      return {
        exitCode: 0,
        ok: true,
        stdout: "prompt user\n"
      };
    }
  });

  const result = await service.run({
    args: ["status"],
    command: "git",
    cwd: "/tmp/project/worktree",
    sessionId: "session-1",
    systemActor: {
      actorScope: "local",
      actorUserKey: "local",
      targetRoot: "/tmp/project",
      workdir: "/tmp/project/worktree"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.stdout, "prompt user\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cwd, "/tmp/project/worktree");
  assert.equal(calls[0].options.env.HOME, `${providerHomesRoot}/github/ada@example.com`);
});

test("Codex git command wrapper forwards git argv through the session socket", async () => {
  const attachmentRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-codex-git-command-"));
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-codex-git-target-"));
  const calls = [];
  try {
    const prepared = await prepareCodexGitCommand({
      commandService: {
        run: async (input = {}) => {
          calls.push(input);
          return {
            exitCode: 0,
            ok: true,
            stdout: `wrapped ${input.command} ${input.args.join(" ")}`
          };
        }
      },
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: attachmentRoot
      },
      sessionId: "session-1",
      stateRoot: attachmentRoot
    });

    assert.equal(prepared.ok, true);
    assert.ok(prepared.env.VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR.startsWith(`${CODEX_ATTACHMENT_CONTAINER_ROOT}/`));
    const result = await runNode([path.join(prepared.hostWrapperDir, "git"), "status", "--short"], {
      cwd: targetRoot,
      env: {
        ...process.env,
        ...prepared.env,
        VIBE64_CODEX_GIT_COMMAND_SOCKET: prepared.hostSocketPath
      },
      input: "stdin text"
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "wrapped git status --short\n");
    assert.equal(result.stderr, "");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["status", "--short"]);
    assert.equal(calls[0].command, "git");
    assert.equal(calls[0].cwd, targetRoot);
    assert.equal(calls[0].sessionId, "session-1");
    assert.equal(Object.hasOwn(calls[0], "systemActor"), false);
    assert.equal(Buffer.from(calls[0].inputBase64, "base64").toString("utf8"), "stdin text");
  } finally {
    await rm(attachmentRoot, {
      force: true,
      recursive: true
    });
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
});

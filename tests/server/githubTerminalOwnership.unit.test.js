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
  VIBE64_AGENT_RUN_STATE
} from "@local/vibe64-runtime/server";
import {
  createGithubBroker,
  redactedBrokerOutput
} from "@local/vibe64-terminals/server/githubBroker";
import {
  codexAppTerminalOwnerMetadata,
  codexTurnActorMetadata,
  explicitGithubMutatingOperationFromPrompt
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";
import {
  prepareGithubBrokerHelper
} from "@local/vibe64-terminals/server/githubBrokerHelper";
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
const userA = {
  email: "UserA@example.com"
};
const userB = {
  email: "userb@example.com"
};

function projectServiceWithSession(session = {}, {
  metadataWrites = []
} = {}) {
  return {
    createRuntime: async () => ({
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
    })
  };
}

function runNode(args = [], {
  env = process.env
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
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

test("terminal ownership rejects the wrong online user", () => {
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

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_terminal_owner_mismatch");
  assert.equal(result.statusCode, 403);
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

test("ownerless terminals are denied in online user mode and tolerated in local mode", () => {
  const online = terminalOwnerMatchesRequest({}, {
    accountMode: GITHUB_ACCOUNT_MODE_USER,
    providerHomesRoot,
    vibe64User: userA
  });
  const local = terminalOwnerMatchesRequest({}, {
    accountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    providerHomesRoot
  });

  assert.equal(online.ok, false);
  assert.equal(online.code, "vibe64_terminal_owner_required");
  assert.equal(online.statusCode, 401);
  assert.equal(local.ok, true);
  assert.equal(local.legacyOwnerless, true);
});

test("app-owned terminals reject user-scoped access", () => {
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

  assert.equal(userAccess.ok, false);
  assert.equal(userAccess.code, "vibe64_terminal_owner_mismatch");
  assert.equal(userAccess.statusCode, 403);
  assert.equal(userAccess.ownerScope, "app");
  assert.equal(userAccess.observedOwnerScope, "user");
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

test("Codex turn actor metadata records the authenticated user in user mode", () => {
  const result = codexTurnActorMetadata({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER
    },
    session: {
      sessionId: "session-1"
    },
    targetRoot: "/tmp/project",
    threadId: "thread-1",
    turnId: "turn-1",
    vibe64User: {
      email: "Ada@Example.com"
    },
    workdir: "/tmp/project/worktree"
  });

  assert.equal(result.ok, true);
  assert.equal(result.metadata.codex_github_actor_scope, "user");
  assert.equal(result.metadata.codex_github_actor_email, "ada@example.com");
  assert.equal(result.metadata.codex_github_actor_user_key, "ada@example.com");
  assert.equal(result.metadata.codex_github_actor_session_id, "session-1");
  assert.equal(result.metadata.codex_github_actor_thread_id, "thread-1");
  assert.equal(result.metadata.codex_github_actor_turn_id, "turn-1");
  assert.equal(result.metadata.codex_github_actor_workdir, "/tmp/project/worktree");
});

test("Codex turn actor metadata records conservative current-turn GitHub mutation authorization", () => {
  assert.equal(
    explicitGithubMutatingOperationFromPrompt("Commit all changes and push the branch."),
    "commit_and_push"
  );
  assert.equal(
    explicitGithubMutatingOperationFromPrompt("Open a PR for these changes."),
    "create_pr"
  );
  assert.equal(
    explicitGithubMutatingOperationFromPrompt("I confirm: push the current branch using the Vibe64 GitHub broker operation push_branch now."),
    "push_branch"
  );
  assert.equal(
    explicitGithubMutatingOperationFromPrompt("Check status but do not push anything."),
    ""
  );

  const result = codexTurnActorMetadata({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_LOCAL
    },
    prompt: "Commit all changes and push the branch.",
    session: {
      sessionId: "session-1"
    },
    targetRoot: "/tmp/project",
    threadId: "thread-1",
    turnId: "turn-1",
    workdir: "/tmp/project/worktree"
  });

  assert.equal(result.ok, true);
  assert.equal(result.metadata.codex_github_actor_mutating_authorized_operation, "commit_and_push");
  assert.equal(result.metadata.codex_github_actor_mutating_authorized_turn_id, "turn-1");

  const pendingTurn = codexTurnActorMetadata({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_LOCAL
    },
    prompt: "Commit all changes and push the branch.",
    session: {
      sessionId: "session-1"
    },
    targetRoot: "/tmp/project",
    threadId: "thread-1",
    workdir: "/tmp/project/worktree"
  });
  assert.equal(pendingTurn.metadata.codex_github_actor_mutating_authorized_operation, undefined);
});

test("terminal owner checks deny read, write, resize, subscribe, and close to the wrong user", async () => {
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
      assert.equal(result.ok, false);
      assert.equal(result.code, "vibe64_terminal_owner_mismatch");
    }
    assert.equal(logs.length, 1);
    assert.equal(logs[0].fields.event, "vibe64.terminal.owner_denied");
    assert.equal(logs[0].fields.terminalId, terminal.id);
    assert.equal(logs[0].fields.expectedOwnerUserKey, "usera@example.com");
    assert.equal(logs[0].fields.observedOwnerUserKey, "userb@example.com");
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

test("GitHub broker resolves the tool home from recorded Codex actor metadata", async () => {
  const calls = [];
  const broker = createGithubBroker({
    env: {
      VIBE64_GITHUB_ACCOUNT_MODE: GITHUB_ACCOUNT_MODE_USER,
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: {
      createRuntime: async () => ({
        getSession: async () => ({
          metadata: {
            codex_github_actor_email: "usera@example.com",
            codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
            codex_github_actor_scope: "user",
            codex_github_actor_session_id: "session-1",
            codex_github_actor_target_root: "/tmp/project",
            codex_github_actor_thread_id: "thread-1",
            codex_github_actor_turn_id: "turn-1",
            codex_github_actor_user_key: "usera@example.com",
            codex_github_actor_workdir: "/tmp/project/worktree"
          },
          sessionId: "session-1",
          targetRoot: "/tmp/project"
        })
      })
    },
    runCommand: async (command, args, options) => {
      calls.push({
        args,
        command,
        options
      });
      return {
        exitCode: 0,
        ok: true,
        output: "## main",
        stdout: "## main"
      };
    }
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.operation, "git_status");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "git");
  assert.deepEqual(calls[0].args, ["status", "--short", "--branch"]);
  assert.equal(calls[0].options.cwd, "/tmp/project/worktree");
  assert.equal(calls[0].options.env.HOME, `${providerHomesRoot}/github/usera@example.com`);
});

test("GitHub broker resolves the local provider home for local actors", async () => {
  const calls = [];
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_scope: "local",
        codex_github_actor_session_id: "session-1",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_thread_id: "thread-1",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }),
    runCommand: async (_command, _args, options) => {
      calls.push(options);
      return {
        exitCode: 0,
        ok: true,
        output: "",
        stdout: ""
      };
    }
  });

  const result = await broker.run({
    operation: "current_branch",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].env.HOME, `${providerHomesRoot}/github/local`);
});

test("GitHub broker rejects unknown operations", async () => {
  const broker = createGithubBroker({
    projectService: projectServiceWithSession({})
  });

  const result = await broker.run({
    operation: "git status",
    sessionId: "session-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_broker_unknown_operation");
});

test("GitHub broker rejects missing actor bindings", async () => {
  const broker = createGithubBroker({
    projectService: projectServiceWithSession({
      metadata: {},
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    })
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_actor_missing");
});

test("GitHub broker rejects missing actor bindings in online user mode", async () => {
  const broker = createGithubBroker({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: GITHUB_ACCOUNT_MODE_USER,
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {},
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    })
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1",
    vibe64User: userA
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_actor_missing");
});

test("GitHub broker rejects expired actor bindings", async () => {
  const broker = createGithubBroker({
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() - 60_000).toISOString(),
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    })
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_actor_expired");
});

test("GitHub broker rejects workdirs outside the target root", async () => {
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/other"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    })
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_broker_workdir_invalid");
});

test("GitHub broker rejects stale Codex turn context when agent runs are recorded", async () => {
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: {
      createRuntime: async () => ({
        getSession: async () => ({
          agentRuns: [
            {
              active: false,
              finishedAt: "2000-01-01T00:00:00.000Z",
              providerThreadId: "thread-1",
              providerTurnId: "turn-1",
              state: VIBE64_AGENT_RUN_STATE.COMPLETED,
              updatedAt: "2000-01-01T00:00:00.000Z"
            }
          ],
          metadata: {
            codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
            codex_github_actor_scope: "local",
            codex_github_actor_target_root: "/tmp/project",
            codex_github_actor_thread_id: "thread-1",
            codex_github_actor_turn_id: "turn-1",
            codex_github_actor_user_key: "local",
            codex_github_actor_workdir: "/tmp/project"
          },
          sessionId: "session-1",
          targetRoot: "/tmp/project"
        })
      })
    },
    runCommand: async () => {
      throw new Error("stale Codex context must not run broker command");
    }
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_actor_context_stale");
});

test("GitHub broker redacts token-like output", () => {
  const redacted = redactedBrokerOutput([
    "authorization: bearer github_pat-abcdefghijklmnop",
    "secret=ghp-abcdefghijklmnop",
    "DB_PASSWORD=database-password",
    "credential helper returned token=gho-abcdefghijklmnop",
    "https://x-access-token:ghp-abcdefghijklmnop@github.com/example/repo.git"
  ].join("\n"));

  assert.doesNotMatch(redacted, /github_pat-abcdefghijklmnop/u);
  assert.doesNotMatch(redacted, /ghp-abcdefghijklmnop/u);
  assert.doesNotMatch(redacted, /database-password/u);
  assert.doesNotMatch(redacted, /gho-abcdefghijklmnop/u);
  assert.doesNotMatch(redacted, /x-access-token:.*@github/u);
  assert.match(redacted, /authorization: \[redacted\]/u);
  assert.match(redacted, /DB_PASSWORD=\[redacted\]/u);
});

test("GitHub broker rejects actors that no longer have project access", async () => {
  const broker = createGithubBroker({
    authorizeActorAccess: async ({ actor, targetRoot, workdir }) => {
      assert.equal(actor.actorUserKey, "usera@example.com");
      assert.equal(targetRoot, "/tmp/project");
      assert.equal(workdir, "/tmp/project");
      return {
        code: "vibe64_project_access_denied",
        error: "Project access was revoked.",
        ok: false,
        statusCode: 403
      };
    },
    env: {
      VIBE64_GITHUB_ACCOUNT_MODE: GITHUB_ACCOUNT_MODE_USER,
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: {
      createRuntime: async () => ({
        getSession: async () => ({
          agentRuns: [
            {
              active: true,
              providerThreadId: "thread-1",
              providerTurnId: "turn-1",
              state: VIBE64_AGENT_RUN_STATE.ACTIVE,
              updatedAt: new Date().toISOString()
            }
          ],
          metadata: {
            codex_github_actor_email: "usera@example.com",
            codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
            codex_github_actor_scope: "user",
            codex_github_actor_target_root: "/tmp/project",
            codex_github_actor_thread_id: "thread-1",
            codex_github_actor_turn_id: "turn-1",
            codex_github_actor_user_key: "usera@example.com",
            codex_github_actor_workdir: "/tmp/project"
          },
          sessionId: "session-1",
          targetRoot: "/tmp/project"
        })
      })
    },
    runCommand: async () => {
      throw new Error("revoked actor must not run broker command");
    }
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_project_access_denied");
  assert.equal(result.statusCode, 403);
});

test("GitHub broker blocks mutating operations without a server-side confirmation", async () => {
  const logs = [];
  const metadataWrites = [];
  const broker = createGithubBroker({
    env: {
      VIBE64_GITHUB_ACCOUNT_MODE: GITHUB_ACCOUNT_MODE_USER,
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    logger: {
      warn(fields, message) {
        logs.push({
          fields,
          message
        });
      }
    },
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_scope: "user",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "usera@example.com",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }, {
      metadataWrites
    }),
    runCommand: async () => {
      throw new Error("mutating operation should not run");
    }
  });

  const result = await broker.run({
    operation: "commit_and_push",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_confirmation_required");
  assert.deepEqual(result.confirmation, {
    operation: "commit_and_push",
    required: true
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].fields.event, "vibe64.github_broker.confirmation_required");
  assert.equal(logs[0].fields.operation, "commit_and_push");
  assert.equal(logs[0].fields.actorUserKey, "usera@example.com");
  assert.equal(Object.hasOwn(logs[0].fields, "outputTail"), false);
  assert.deepEqual(Object.fromEntries(metadataWrites.map((write) => [write.name, write.value])), {
    codex_github_broker_last_at: metadataWrites.find((write) => write.name === "codex_github_broker_last_at")?.value,
    codex_github_broker_last_code: "vibe64_github_confirmation_required",
    codex_github_broker_last_needs_confirmation: "yes",
    codex_github_broker_last_ok: "no",
    codex_github_broker_last_operation: "commit_and_push",
    codex_github_broker_last_summary: "This GitHub operation requires explicit user confirmation.",
    codex_github_broker_last_turn_id: "turn-1"
  });
});

test("GitHub broker runs confirmed commit and push with allowlisted argv", async () => {
  const calls = [];
  const logs = [];
  const metadataWrites = [];
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    logger: {
      info(fields, message) {
        logs.push({
          fields,
          message
        });
      }
    },
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_mutating_authorized_operation: "commit_and_push",
        codex_github_actor_mutating_authorized_turn_id: "turn-1",
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }, {
      metadataWrites
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
        output: `${command} ok`,
        stdout: `${command} ok`
      };
    }
  });

  const result = await broker.run({
    branch: "feature/test",
    message: "Commit from broker",
    operation: "commit_and_push",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.commandCount, 3);
  assert.deepEqual(calls.map((call) => [call.command, call.args]), [
    ["git", ["add", "-A"]],
    ["git", ["commit", "-m", "Commit from broker"]],
    ["git", ["push", "-u", "origin", "HEAD:feature/test"]]
  ]);
  assert.equal(calls[0].options.cwd, "/tmp/project");
  assert.equal(calls[0].options.env.HOME, `${providerHomesRoot}/github/local`);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].fields.event, "vibe64.github_broker.operation_finished");
  assert.equal(logs[0].fields.operation, "commit_and_push");
  assert.equal(logs[0].fields.commandCount, 3);
  assert.equal(Object.hasOwn(logs[0].fields, "summary"), false);
  const metadata = Object.fromEntries(metadataWrites.map((write) => [write.name, write.value]));
  assert.equal(metadata.codex_github_broker_last_ok, "yes");
  assert.equal(metadata.codex_github_broker_last_operation, "commit_and_push");
  assert.equal(metadata.codex_github_broker_last_summary, "git ok");
  assert.equal(metadata.codex_github_broker_last_turn_id, "turn-1");
  assert.equal(metadata.branch_pushed, "feature/test");
  assert.equal(metadata.branch_push_remote, "origin");
  assert.deepEqual(result.result, {
    branch: "feature/test",
    pushed: true,
    remote: "origin"
  });
});

test("GitHub broker discovers the current branch pull request with structured result fields", async () => {
  const calls = [];
  const metadataWrites = [];
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        branch: "feature/test",
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }, {
      metadataWrites
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
        output: "{\"number\":44,\"url\":\"https://github.com/example/repo/pull/44\",\"title\":\"Preview seed\",\"state\":\"OPEN\",\"baseRefName\":\"main\",\"headRefName\":\"feature/test\",\"isDraft\":false,\"mergeable\":\"MERGEABLE\"}",
        stdout: "{\"number\":44,\"url\":\"https://github.com/example/repo/pull/44\",\"title\":\"Preview seed\",\"state\":\"OPEN\",\"baseRefName\":\"main\",\"headRefName\":\"feature/test\",\"isDraft\":false,\"mergeable\":\"MERGEABLE\"}"
      };
    }
  });

  const result = await broker.run({
    operation: "current_branch_pr",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => [call.command, call.args]), [
    ["gh", ["pr", "view", "--json", "number,url,title,state,baseRefName,headRefName,isDraft,mergeable"]]
  ]);
  assert.equal(calls[0].options.cwd, "/tmp/project");
  assert.equal(calls[0].options.env.HOME, `${providerHomesRoot}/github/local`);
  assert.deepEqual(result.result, {
    base: "main",
    head: "feature/test",
    isDraft: false,
    mergeable: "MERGEABLE",
    prNumber: 44,
    prSource: "created",
    prTitle: "Preview seed",
    prUrl: "https://github.com/example/repo/pull/44",
    state: "OPEN"
  });
  const metadata = Object.fromEntries(metadataWrites.map((write) => [write.name, write.value]));
  assert.equal(metadata.codex_github_broker_last_ok, "yes");
  assert.equal(metadata.codex_github_broker_last_operation, "current_branch_pr");
  assert.equal(metadata.pr_number, "44");
  assert.equal(metadata.pr_source, "created");
  assert.equal(metadata.pr_title, "Preview seed");
  assert.equal(metadata.pr_url, "https://github.com/example/repo/pull/44");
});

test("GitHub broker runs confirmed pull request merge with allowlisted argv", async () => {
  const calls = [];
  const metadataWrites = [];
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_mutating_authorized_operation: "merge_pr",
        codex_github_actor_mutating_authorized_turn_id: "turn-1",
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }, {
      metadataWrites
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
        output: "merged",
        stdout: "merged"
      };
    }
  });

  const result = await broker.run({
    deleteBranch: true,
    method: "squash",
    number: 12,
    operation: "merge_pr",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => [call.command, call.args]), [
    ["gh", ["pr", "merge", "12", "--squash", "--delete-branch"]]
  ]);
  assert.equal(calls[0].options.cwd, "/tmp/project");
  assert.equal(calls[0].options.env.HOME, `${providerHomesRoot}/github/local`);
  assert.deepEqual(result.result, {
    deleteBranch: true,
    merged: true,
    method: "squash",
    prNumber: 12
  });
  const metadata = Object.fromEntries(metadataWrites.map((write) => [write.name, write.value]));
  assert.equal(metadata.pr_merged, "yes");
  assert.equal(metadata.pr_number, "12");
});

test("GitHub broker runs confirmed issue and pull request commands with allowlisted argv", async () => {
  const cases = [
    {
      expectedArgs: ["issue", "create", "--title", "Bug title", "--body", "Bug body"],
      input: {
        body: "Bug body",
        operation: "create_issue",
        title: "Bug title"
      },
      operation: "create_issue"
    },
    {
      expectedArgs: ["pr", "create", "--base", "main", "--head", "feature/test", "--title", "PR title", "--body", "PR body"],
      input: {
        base: "main",
        body: "PR body",
        head: "feature/test",
        operation: "create_pr",
        title: "PR title"
      },
      operation: "create_pr"
    },
    {
      expectedArgs: ["pr", "comment", "12", "--body", "Looks good"],
      input: {
        body: "Looks good",
        number: 12,
        operation: "comment_pr"
      },
      operation: "comment_pr"
    }
  ];

  for (const currentCase of cases) {
    const calls = [];
    const broker = createGithubBroker({
      env: {
        VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
      },
      projectService: projectServiceWithSession({
        metadata: {
          codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
          codex_github_actor_mutating_authorized_operation: currentCase.operation,
          codex_github_actor_mutating_authorized_turn_id: "turn-1",
          codex_github_actor_scope: "local",
          codex_github_actor_target_root: "/tmp/project",
          codex_github_actor_turn_id: "turn-1",
          codex_github_actor_user_key: "local",
          codex_github_actor_workdir: "/tmp/project"
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
          output: "ok",
          stdout: "ok"
        };
      }
    });

    const result = await broker.run({
      ...currentCase.input,
      sessionId: "session-1",
      turnId: "turn-1"
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((call) => [call.command, call.args]), [
      ["gh", currentCase.expectedArgs]
    ]);
    assert.equal(calls[0].options.cwd, "/tmp/project");
    assert.equal(calls[0].options.env.HOME, `${providerHomesRoot}/github/local`);
  }
});

test("GitHub broker create_pr returns structured fields and writes pull request metadata", async () => {
  const calls = [];
  const metadataWrites = [];
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        branch: "feature/test",
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_mutating_authorized_operation: "create_pr",
        codex_github_actor_mutating_authorized_turn_id: "turn-1",
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }, {
      metadataWrites
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
        output: "https://github.com/example/repo/pull/45\n",
        stdout: "https://github.com/example/repo/pull/45\n"
      };
    }
  });

  const result = await broker.run({
    base: "main",
    body: "PR body",
    head: "feature/test",
    operation: "create_pr",
    sessionId: "session-1",
    title: "PR title",
    turnId: "turn-1"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => [call.command, call.args]), [
    ["gh", ["pr", "create", "--base", "main", "--head", "feature/test", "--title", "PR title", "--body", "PR body"]]
  ]);
  assert.deepEqual(result.result, {
    base: "main",
    head: "feature/test",
    prNumber: 45,
    prSource: "created",
    prTitle: "PR title",
    prUrl: "https://github.com/example/repo/pull/45"
  });
  const metadata = Object.fromEntries(metadataWrites.map((write) => [write.name, write.value]));
  assert.equal(metadata.pr_number, "45");
  assert.equal(metadata.pr_source, "created");
  assert.equal(metadata.pr_title, "PR title");
  assert.equal(metadata.pr_url, "https://github.com/example/repo/pull/45");
});

test("GitHub broker runs confirmed branch sync with allowlisted argv", async () => {
  const calls = [];
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_mutating_authorized_operation: "sync_branch",
        codex_github_actor_mutating_authorized_turn_id: "turn-1",
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
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
        output: "synced",
        stdout: "synced"
      };
    }
  });

  const result = await broker.run({
    branch: "main",
    operation: "sync_branch",
    remote: "upstream",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => [call.command, call.args]), [
    ["git", ["fetch", "upstream", "main"]],
    ["git", ["merge", "--ff-only", "FETCH_HEAD"]]
  ]);
  assert.equal(calls[0].options.cwd, "/tmp/project");
  assert.equal(calls[0].options.env.HOME, `${providerHomesRoot}/github/local`);
});

test("GitHub broker rejects unsafe mutating branch names after confirmation", async () => {
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_mutating_authorized_operation: "push_branch",
        codex_github_actor_mutating_authorized_turn_id: "turn-1",
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }),
    runCommand: async () => {
      throw new Error("unsafe branch should not run");
    }
  });

  const result = await broker.run({
    branch: "../main",
    operation: "push_branch",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_broker_field_invalid");
  assert.equal(result.field, "branch");
});

test("GitHub broker rejects repositories outside the project repository", async () => {
  const calls = [];
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project",
        github_repository_full_name: "example/beepollen"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }),
    runCommand: async (command, args) => {
      calls.push({
        args,
        command
      });
      if (command === "git" && args.join(" ") === "remote get-url origin") {
        return {
          exitCode: 0,
          ok: true,
          output: "https://github.com/example/other.git",
          stdout: "https://github.com/example/other.git"
        };
      }
      throw new Error("wrong repository should not run broker operation");
    }
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_broker_repo_mismatch");
  assert.equal(result.expectedRepository, "example/beepollen");
  assert.equal(result.observedRepository, "example/other");
  assert.deepEqual(calls, [
    {
      args: ["remote", "get-url", "origin"],
      command: "git"
    }
  ]);
});

test("GitHub broker rejects branches outside the session policy", async () => {
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        branch: "vibe64/session-branch",
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_mutating_authorized_operation: "push_branch",
        codex_github_actor_mutating_authorized_turn_id: "turn-1",
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }),
    runCommand: async () => {
      throw new Error("out-of-policy branch should not run");
    }
  });

  const result = await broker.run({
    branch: "main",
    operation: "push_branch",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_broker_branch_policy_violation");
  assert.equal(result.field, "branch");
  assert.equal(result.expectedBranch, "vibe64/session-branch");
  assert.equal(result.observedBranch, "main");
});

test("GitHub broker does not reuse mutating authorization from an old turn", async () => {
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_mutating_authorized_operation: "push_branch",
        codex_github_actor_mutating_authorized_turn_id: "old-turn",
        codex_github_actor_scope: "local",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    }),
    runCommand: async () => {
      throw new Error("old authorization should not run");
    }
  });

  const result = await broker.run({
    branch: "vibe64/session-branch",
    operation: "push_branch",
    sessionId: "session-1",
    turnId: "turn-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_confirmation_required");
});

test("GitHub broker rejects turn id mismatch", async () => {
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: {
      createRuntime: async () => ({
        getSession: async () => ({
          metadata: {
            codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
            codex_github_actor_scope: "local",
            codex_github_actor_target_root: "/tmp/project",
            codex_github_actor_turn_id: "turn-1",
            codex_github_actor_user_key: "local",
            codex_github_actor_workdir: "/tmp/project"
          },
          sessionId: "session-1",
          targetRoot: "/tmp/project"
        })
      })
    }
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1",
    turnId: "turn-2"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_actor_turn_mismatch");
});

test("GitHub broker rejects missing turn ids on direct calls", async () => {
  const broker = createGithubBroker({
    env: {
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: projectServiceWithSession({
      metadata: {
        codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
        codex_github_actor_scope: "local",
        codex_github_actor_session_id: "session-1",
        codex_github_actor_target_root: "/tmp/project",
        codex_github_actor_turn_id: "turn-1",
        codex_github_actor_user_key: "local",
        codex_github_actor_workdir: "/tmp/project"
      },
      sessionId: "session-1",
      targetRoot: "/tmp/project"
    })
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_actor_turn_required");
});

test("GitHub broker rejects authenticated request users that do not match the recorded actor", async () => {
  const broker = createGithubBroker({
    env: {
      VIBE64_GITHUB_ACCOUNT_MODE: GITHUB_ACCOUNT_MODE_USER,
      VIBE64_PROVIDER_HOMES_ROOT: providerHomesRoot
    },
    projectService: {
      createRuntime: async () => ({
        getSession: async () => ({
          metadata: {
            codex_github_actor_expires_at: new Date(Date.now() + 60_000).toISOString(),
            codex_github_actor_scope: "user",
            codex_github_actor_target_root: "/tmp/project",
            codex_github_actor_turn_id: "turn-1",
            codex_github_actor_user_key: "usera@example.com",
            codex_github_actor_workdir: "/tmp/project"
          },
          sessionId: "session-1",
          targetRoot: "/tmp/project"
        })
      })
    }
  });

  const result = await broker.run({
    operation: "git_status",
    sessionId: "session-1",
    turnId: "turn-1",
    vibe64User: userB
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_github_actor_user_mismatch");
});

test("GitHub broker helper exposes list, schema, and named run calls", async () => {
  const attachmentRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-gh-helper-"));
  const calls = [];
  try {
    const prepared = await prepareGithubBrokerHelper({
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: attachmentRoot
      },
      githubBroker: {
        currentTurnId: async (sessionId) => `${sessionId}:turn-current`,
        listOperations: () => [
          {
            operation: "git_status",
            readOnly: true
          }
        ],
        operationSchema: (operation) => operation === "git_status"
          ? {
              operation: "git_status"
            }
          : null,
        run: async (input) => {
          calls.push(input);
          return {
            ok: true,
            operation: input.operation,
            sessionId: input.sessionId
          };
        }
      },
      sessionId: "session-1",
      stateRoot: attachmentRoot
    });
    const helperEnv = {
      ...process.env,
      ...prepared.env,
      VIBE64_GITHUB_BROKER_SOCKET: prepared.hostSocketPath
    };

    const listed = await runNode([prepared.hostScriptPath, "--list"], {
      env: helperEnv
    });
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).operations[0].operation, "git_status");

    const schema = await runNode([prepared.hostScriptPath, "--schema", "git_status"], {
      env: helperEnv
    });
    assert.equal(schema.status, 0, schema.stderr);
    assert.equal(JSON.parse(schema.stdout).schema.operation, "git_status");

    const run = await runNode([prepared.hostScriptPath, "--json", "{\"operation\":\"git_status\"}"], {
      env: helperEnv
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).sessionId, "session-1");
    assert.deepEqual(calls, [
      {
        operation: "git_status",
        sessionId: "session-1",
        turnId: "session-1:turn-current"
      }
    ]);
  } finally {
    await rm(attachmentRoot, {
      force: true,
      recursive: true
    });
  }
});

test("GitHub broker helper redacts secret-looking response fields", async () => {
  const attachmentRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-gh-helper-"));
  try {
    const prepared = await prepareGithubBrokerHelper({
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: attachmentRoot
      },
      githubBroker: {
        listOperations: () => [],
        operationSchema: () => null,
        run: async () => ({
          ok: true,
          outputTail: "authorization: bearer github_pat-abcdefghijklmnop",
          token: "ghp-abcdefghijklmnop"
        })
      },
      sessionId: "session-1",
      stateRoot: attachmentRoot
    });
    const helperEnv = {
      ...process.env,
      ...prepared.env,
      VIBE64_GITHUB_BROKER_SOCKET: prepared.hostSocketPath
    };

    const result = await runNode([prepared.hostScriptPath, "--json", "{\"operation\":\"git_status\"}"], {
      env: helperEnv
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /github_pat-abcdefghijklmnop/u);
    assert.doesNotMatch(result.stdout, /ghp-abcdefghijklmnop/u);
    assert.match(result.stdout, /\[redacted\]/u);
  } finally {
    await rm(attachmentRoot, {
      force: true,
      recursive: true
    });
  }
});

test("GitHub broker helper rejects invalid JSON without calling the broker", async () => {
  const attachmentRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-gh-helper-"));
  let called = false;
  try {
    const prepared = await prepareGithubBrokerHelper({
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: attachmentRoot
      },
      githubBroker: {
        listOperations: () => [],
        operationSchema: () => null,
        run: async () => {
          called = true;
          return {
            ok: true
          };
        }
      },
      sessionId: "session-1",
      stateRoot: attachmentRoot
    });
    const result = await runNode([prepared.hostScriptPath, "--json", "{"], {
      env: {
        ...process.env,
        ...prepared.env,
        VIBE64_GITHUB_BROKER_SOCKET: prepared.hostSocketPath
      }
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be valid JSON|Usage: vibe64-github-broker/u);
    assert.equal(called, false);
  } finally {
    await rm(attachmentRoot, {
      force: true,
      recursive: true
    });
  }
});

test("GitHub broker helper rejects missing session context", async () => {
  const attachmentRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-gh-helper-"));
  try {
    const prepared = await prepareGithubBrokerHelper({
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: attachmentRoot
      },
      githubBroker: {
        listOperations: () => [],
        operationSchema: () => null,
        run: async () => ({
          ok: true
        })
      },
      sessionId: "session-1",
      stateRoot: attachmentRoot
    });
    const result = await runNode([prepared.hostScriptPath, "--json", "{\"operation\":\"git_status\"}"], {
      env: {
        ...process.env,
        ...prepared.env,
        VIBE64_GITHUB_BROKER_SESSION_ID: "",
        VIBE64_GITHUB_BROKER_SOCKET: prepared.hostSocketPath
      }
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /helper environment is not available/u);
  } finally {
    await rm(attachmentRoot, {
      force: true,
      recursive: true
    });
  }
});

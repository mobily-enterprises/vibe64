import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  closeTerminalSession,
  startTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  ACCOUNT_AUTH_NAMESPACE,
  API_KEY_AUTH_MODE,
  authTerminalMetadata,
  canReuseAuthTerminal,
  CODEX_API_KEY_ENV,
  codexApiKeyLoginCommandArgs,
  GITHUB_DEVICE_AUTH_URL,
  APP_PROVIDER_SCOPE,
  USER_PROVIDER_SCOPE,
  parseAuthOutput,
  createService,
  ghLoginCommandArgs,
  githubProviderHome,
  githubProviderUserKey,
  terminalArgsForAuth
} from "../../packages/vibe64-accounts/src/server/service.js";
import { registerRoutes as registerAccountRoutes } from "../../packages/vibe64-accounts/src/server/registerRoutes.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";
import {
  testReply,
  testRouteApp,
  withLocalRequestBypass
} from "./vibe64RouteTestHelpers.js";

const OWNER_USER = Object.freeze({
  email: "Owner@Example.com",
  role: "owner"
});
const LINKED_OWNER_USER = Object.freeze({
  email: "Owner@Example.com",
  github: Object.freeze({
    avatarUrl: "https://github.com/merc.png",
    connectedAt: "2026-06-08T04:33:06.965Z",
    id: 2128734,
    login: "mercmobily"
  })
});
const FRIEND_USER = Object.freeze({
  email: "friend@example.com",
  role: "member"
});

function connectedToolchain(calls = []) {
  return async function runToolchain(commandArgs, options = {}) {
    calls.push({
      commandArgs,
      options
    });
    return connectedToolchainResult(commandArgs);
  };
}

function connectedToolchainResult(commandArgs) {
  if (commandArgs[0] === "codex") {
    return {
      ok: true,
      output: "Codex is logged in.",
      stdout: "Logged in"
    };
  }
  if (commandArgs[0] === "gh" && commandArgs[1] === "auth") {
    return {
      ok: true,
      output: "github.com\nToken scopes: repo, read:org, gist, workflow",
      stdout: "github.com"
    };
  }
  if (commandArgs[0] === "gh" && commandArgs[1] === "api") {
    return {
      ok: true,
      output: "merc",
      stdout: "merc"
    };
  }
  if (commandArgs[0] === "git" && commandArgs.includes("--get-urlmatch")) {
    return {
      ok: true,
      output: "!/usr/bin/gh auth git-credential",
      stdout: "!/usr/bin/gh auth git-credential"
    };
  }
  if (commandArgs[0] === "git" && commandArgs.includes("user.name")) {
    return {
      ok: true,
      output: "Merc Mobily",
      stdout: "Merc Mobily"
    };
  }
  if (commandArgs[0] === "git" && commandArgs.includes("user.email")) {
    return {
      ok: true,
      output: "12345+merc@users.noreply.github.com",
      stdout: "12345+merc@users.noreply.github.com"
    };
  }
  throw new Error(`Unexpected toolchain command: ${commandArgs.join(" ")}`);
}

function disconnectedCodexToolchain(calls = []) {
  return async function runToolchain(commandArgs, options = {}) {
    calls.push({
      commandArgs,
      options
    });
    if (commandArgs[0] === "codex") {
      return {
        ok: false,
        output: "Codex is not logged in.",
        stdout: ""
      };
    }
    return connectedToolchainResult(commandArgs);
  };
}

function disconnectedGithubGitCredentialToolchain(calls = []) {
  return async function runToolchain(commandArgs, options = {}) {
    calls.push({
      commandArgs,
      options
    });
    if (commandArgs[0] === "git" && commandArgs.includes("--get-urlmatch")) {
      return {
        ok: false,
        output: "",
        stdout: ""
      };
    }
    return connectedToolchainResult(commandArgs);
  };
}

function disconnectedGithubAuthToolchain(calls = []) {
  return async function runToolchain(commandArgs, options = {}) {
    calls.push({
      commandArgs,
      options
    });
    if (commandArgs[0] === "gh") {
      return {
        ok: false,
        output: "You are not logged into any GitHub hosts.",
        stdout: ""
      };
    }
    if (commandArgs[0] === "git" && commandArgs.includes("--get-urlmatch")) {
      return {
        ok: false,
        output: "",
        stdout: ""
      };
    }
    if (commandArgs[0] === "git" && (commandArgs.includes("user.name") || commandArgs.includes("user.email"))) {
      return {
        ok: false,
        output: "",
        stdout: ""
      };
    }
    return connectedToolchainResult(commandArgs);
  };
}

function disconnectedGithubGitIdentityToolchain(calls = []) {
  return async function runToolchain(commandArgs, options = {}) {
    calls.push({
      commandArgs,
      options
    });
    if (commandArgs[0] === "git" && (commandArgs.includes("user.name") || commandArgs.includes("user.email"))) {
      return {
        ok: false,
        output: "",
        stdout: ""
      };
    }
    return connectedToolchainResult(commandArgs);
  };
}

function accountInput(user = OWNER_USER, input = {}) {
  return {
    ...input,
    vibe64User: user
  };
}

function githubCalls(calls = []) {
  return calls.filter((call) => call.commandArgs[0] === "gh" || call.commandArgs[0] === "git");
}

function codexCalls(calls = []) {
  return calls.filter((call) => call.commandArgs[0] === "codex");
}

test("Accounts status uses shared Codex auth and the active user's GitHub home", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    const providerHomesRoot = path.join(root, "provider-homes");
    const calls = [];
    const status = await createService({
      providerHomesRoot,
      runToolchain: connectedToolchain(calls),
      targetRoot
    }).getStatus(accountInput(OWNER_USER));

    assert.equal(status.ok, true);
    assert.equal(status.ready, true);
    assert.deepEqual(status.providerScopes, {
      codex: APP_PROVIDER_SCOPE,
      github: USER_PROVIDER_SCOPE
    });
    assert.deepEqual(
      status.accounts.find((account) => account.id === "github")?.gitIdentity,
      {
        email: "12345+merc@users.noreply.github.com",
        name: "Merc Mobily"
      }
    );
    assert.equal(calls.length, 6);

    const expectedGithubHome = githubProviderHome(providerHomesRoot, OWNER_USER);
    assert.equal(codexCalls(calls).length, 1);
    assert.deepEqual(codexCalls(calls)[0].commandArgs, [
      "codex",
      "-c",
      "check_for_update_on_startup=false",
      "login",
      "status"
    ]);
    assert.equal(codexCalls(calls)[0].options.toolHomeSource || "", "");
    assert.equal(githubCalls(calls).length, 5);
    assert.deepEqual(new Set(githubCalls(calls).map((call) => call.options.toolHomeSource)), new Set([expectedGithubHome]));
  });
});

test("Codex status can be checked without requiring a GitHub user context", async () => {
  await withTemporaryRoot(async (root) => {
    const calls = [];
    const status = await createService({
      runToolchain: connectedToolchain(calls),
      targetRoot: path.join(root, "target")
    }).getCodexStatus();

    assert.equal(status.ok, true);
    assert.equal(status.account.id, "codex");
    assert.equal(status.account.connected, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].commandArgs, [
      "codex",
      "-c",
      "check_for_update_on_startup=false",
      "login",
      "status"
    ]);
  });
});

test("GitHub provider homes are keyed per Vibe64 user while Codex remains shared", async () => {
  await withTemporaryRoot(async (root) => {
    const providerHomesRoot = path.join(root, "provider-homes");
    const calls = [];
    const service = createService({
      providerHomesRoot,
      runToolchain: connectedToolchain(calls),
      targetRoot: path.join(root, "target")
    });

    await service.getStatus(accountInput(OWNER_USER));
    await service.getStatus(accountInput(FRIEND_USER));

    const githubHomes = new Set(githubCalls(calls).map((call) => call.options.toolHomeSource));
    assert.deepEqual(githubHomes, new Set([
      githubProviderHome(providerHomesRoot, OWNER_USER),
      githubProviderHome(providerHomesRoot, FRIEND_USER)
    ]));
    assert.equal(codexCalls(calls).length, 2);
    assert.ok(codexCalls(calls).every((call) => !call.options.toolHomeSource));
  });
});

test("Accounts status requires GitHub Git credential helper for remote operations", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    const calls = [];
    const status = await createService({
      providerHomesRoot: path.join(root, "provider-homes"),
      runToolchain: disconnectedGithubGitCredentialToolchain(calls),
      targetRoot
    }).getStatus(accountInput(OWNER_USER, {
      refresh: true
    }));

    assert.equal(status.ok, true);
    assert.equal(status.ready, false);
    assert.match(status.blockedReason, /Git credential helper is not configured/u);
    assert.equal(calls.length, 6);
  });
});

test("Accounts status shows reconnect required for remembered GitHub identities without live auth", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    const calls = [];
    const status = await createService({
      providerHomesRoot: path.join(root, "provider-homes"),
      runToolchain: disconnectedGithubAuthToolchain(calls),
      targetRoot
    }).getStatus(accountInput(LINKED_OWNER_USER, {
      refresh: true
    }));

    const github = status.accounts.find((account) => account.id === "github");
    assert.equal(status.ok, true);
    assert.equal(status.ready, false);
    assert.equal(status.blockedReason, "GitHub was previously linked as @mercmobily, but this host is not ready to use it. Reconnect GitHub to continue.");
    assert.equal(github.status, "reconnect_required");
    assert.equal(github.connected, false);
    assert.equal(github.previouslyLinked, true);
    assert.equal(github.previousUsername, "mercmobily");
    assert.deepEqual(github.previousGithub, {
      avatarUrl: "https://github.com/merc.png",
      connectedAt: "2026-06-08T04:33:06.965Z",
      id: 2128734,
      login: "mercmobily"
    });
    assert.equal(calls.length, 6);
  });
});

test("Accounts status requires Git identity in the active user's GitHub home", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    const calls = [];
    const status = await createService({
      providerHomesRoot: path.join(root, "provider-homes"),
      runToolchain: disconnectedGithubGitIdentityToolchain(calls),
      targetRoot
    }).getStatus(accountInput(OWNER_USER, {
      refresh: true
    }));

    assert.equal(status.ok, true);
    assert.equal(status.ready, false);
    assert.match(status.blockedReason, /Git identity is not configured/u);
    assert.equal(calls.length, 6);
  });
});

test("Accounts status reads live Codex shared state instead of reusing provider caches", async () => {
  await withTemporaryRoot(async (root) => {
    const providerHomesRoot = path.join(root, "provider-homes");
    const connectedCalls = [];
    const disconnectedCalls = [];

    const connected = await createService({
      providerHomesRoot,
      runToolchain: connectedToolchain(connectedCalls),
      targetRoot: path.join(root, "target")
    }).getStatus(accountInput(OWNER_USER));
    assert.equal(connected.ready, true);

    const disconnected = await createService({
      providerHomesRoot,
      runToolchain: disconnectedCodexToolchain(disconnectedCalls),
      targetRoot: path.join(root, "target")
    }).getStatus(accountInput(OWNER_USER));
    assert.equal(disconnected.ready, false);
    assert.match(disconnected.blockedReason, /Codex is not authenticated/u);
    assert.equal(disconnectedCalls.length, 6);
  });
});

test("GitHub auth output falls back to the device URL when gh only prints a code", () => {
  const parsed = parseAuthOutput({
    accountId: "github",
    output: [
      "! First copy your one-time code: A1B2-C3D4",
      "Press Enter to open github.com in your browser..."
    ].join("\n")
  });

  assert.equal(parsed.authUrl, GITHUB_DEVICE_AUTH_URL);
  assert.equal(parsed.userCode, "A1B2-C3D4");
});

test("Codex device auth parses current five-character code suffixes", () => {
  const parsed = parseAuthOutput({
    accountId: "codex",
    mode: "device",
    output: [
      "Follow these steps to sign in with ChatGPT using device code authorization:",
      "1. Open this link in your browser and sign in to your account",
      "   https://auth.openai.com/codex/device",
      "2. Enter this one-time code (expires in 15 minutes)",
      "   CIKQ-R107I"
    ].join("\n")
  });

  assert.equal(parsed.authUrl, "https://auth.openai.com/codex/device");
  assert.equal(parsed.userCode, "CIKQ-R107I");
});

test("Codex device auth parses visible ANSI-wrapped code output", () => {
  const parsed = parseAuthOutput({
    accountId: "codex",
    mode: "device",
    output: [
      "Follow these steps to sign in with ChatGPT using device code authorization:",
      "1. Open this link in your browser and sign in to your account",
      "   ¤[94mhttps://auth.openai.com/codex/device¤[0m",
      "2. Enter this one-time code ¤[90m(expires in 15 minutes)¤[0m",
      "   ¤[94mCJ5L-3L4MG¤[0m"
    ].join("\n")
  });

  assert.equal(parsed.authUrl, "https://auth.openai.com/codex/device");
  assert.equal(parsed.userCode, "CJ5L-3L4MG");
});

test("Account auth terminal reuse is scoped to the requested account and mode", () => {
  const githubContext = {
    userKey: githubProviderUserKey(OWNER_USER)
  };
  const metadata = authTerminalMetadata("github", "browser", githubContext);
  const canReuse = canReuseAuthTerminal("github", "browser", githubContext);

  assert.deepEqual(metadata, {
    accountId: "github",
    mode: "browser",
    providerScope: USER_PROVIDER_SCOPE,
    userKey: githubProviderUserKey(OWNER_USER)
  });
  assert.equal(canReuse({
    metadata
  }), true);
  assert.equal(canReuse({
    metadata: authTerminalMetadata("codex", "device")
  }), false);
  assert.equal(canReuse({
    metadata: authTerminalMetadata("github", "device")
  }), false);
  assert.equal(canReuse({
    metadata: authTerminalMetadata("github", "browser", {
      userKey: githubProviderUserKey(FRIEND_USER)
    })
  }), false);
});

test("Codex auth terminal reuse is shared across Vibe64 users", () => {
  const metadata = authTerminalMetadata("codex", "device");
  const canReuse = canReuseAuthTerminal("codex", "device");

  assert.deepEqual(metadata, {
    accountId: "codex",
    mode: "device",
    providerScope: APP_PROVIDER_SCOPE
  });
  assert.equal(canReuse({
    metadata
  }), true);
});

test("Codex API key auth is never reused between submissions", () => {
  const metadata = authTerminalMetadata("codex", API_KEY_AUTH_MODE);
  const canReuse = canReuseAuthTerminal("codex", API_KEY_AUTH_MODE);

  assert.deepEqual(metadata, {
    accountId: "codex",
    mode: API_KEY_AUTH_MODE,
    providerScope: APP_PROVIDER_SCOPE
  });
  assert.equal(canReuse({
    metadata
  }), false);
});

test("Codex browser auth is rejected on hosted Vibe64", async () => {
  await withTemporaryRoot(async (root) => {
    const result = await createService({
      targetRoot: path.join(root, "target")
    }).startAuth(accountInput(OWNER_USER, {
      accountId: "codex",
      mode: "browser"
    }));

    assert.equal(result.ok, false);
    assert.equal(result.code, "unsupported_auth_mode");
    assert.match(result.error, /device code authentication/u);
  });
});

test("Codex API key auth requires a submitted key", async () => {
  await withTemporaryRoot(async (root) => {
    const result = await createService({
      targetRoot: path.join(root, "target")
    }).startAuth(accountInput(OWNER_USER, {
      accountId: "codex",
      mode: API_KEY_AUTH_MODE
    }));

    assert.equal(result.ok, false);
    assert.equal(result.code, "codex_api_key_required");
    assert.match(result.error, /OpenAI API key is required/u);
  });
});

test("Codex setup actions require the Vibe64 owner", async () => {
  await withTemporaryRoot(async (root) => {
    const service = createService({
      targetRoot: path.join(root, "target")
    });
    const startResult = await service.startAuth(accountInput(FRIEND_USER, {
      accountId: "codex",
      mode: "device"
    }));
    assert.equal(startResult.ok, false);
    assert.equal(startResult.code, "vibe64_owner_required");

    const logoutResult = await service.logout(accountInput(FRIEND_USER, {
      accountId: "codex"
    }));
    assert.equal(logoutResult.ok, false);
    assert.equal(logoutResult.code, "vibe64_owner_required");
  });
});

test("Codex auth terminal I/O is restricted to the Vibe64 owner", async () => {
  await withTemporaryRoot(async (root) => {
    const service = createService({
      targetRoot: path.join(root, "target")
    });
    const terminal = startTerminalSession({
      args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
      command: process.execPath,
      commandPreview: "node codex-auth",
      metadata: authTerminalMetadata("codex", "device"),
      namespace: ACCOUNT_AUTH_NAMESPACE,
      reuseRunning: false
    });
    assert.equal(terminal.ok, true);

    try {
      const ownerSubscribe = service.subscribeAuthTerminal(accountInput(OWNER_USER, {
        sessionId: terminal.id
      }), () => null);
      assert.equal(ownerSubscribe.ok, true);
      ownerSubscribe.unsubscribe();

      const friendSubscribe = service.subscribeAuthTerminal(accountInput(FRIEND_USER, {
        sessionId: terminal.id
      }), () => null);
      assert.equal(friendSubscribe.ok, false);
      assert.equal(friendSubscribe.code, "unknown_auth_session");
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace: ACCOUNT_AUTH_NAMESPACE
      });
    }
  });
});

test("Codex API key auth command reads the key from stdin via inherited Docker env", () => {
  const commandArgs = codexApiKeyLoginCommandArgs();
  const script = commandArgs[2] || "";
  const terminalArgs = terminalArgsForAuth("codex", API_KEY_AUTH_MODE);

  assert.equal(commandArgs[0], "bash");
  assert.equal(commandArgs[1], "-lc");
  assert.match(script, /codex -c check_for_update_on_startup=false login --with-api-key/u);
  assert.match(script, new RegExp(`printf '%s\\\\n' "\\$${CODEX_API_KEY_ENV}"`, "u"));
  assert.ok(terminalArgs.includes("-e"));
  assert.ok(terminalArgs.includes(CODEX_API_KEY_ENV));
  assert.doesNotMatch(terminalArgs.join(" "), /sk-test-secret/u);
});

test("GitHub auth sessions are recovered from terminal metadata for the same Vibe64 user only", async () => {
  await withTemporaryRoot(async (root) => {
    const providerHomesRoot = path.join(root, "provider-homes");
    const terminal = startTerminalSession({
      args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
      command: process.execPath,
      commandPreview: "node github-auth",
      metadata: authTerminalMetadata("github", "browser", {
        userKey: githubProviderUserKey(OWNER_USER)
      }),
      namespace: ACCOUNT_AUTH_NAMESPACE,
      reuseRunning: false
    });
    assert.equal(terminal.ok, true);

    try {
      const ownerRead = await createService({
        providerHomesRoot,
        targetRoot: path.join(root, "target")
      }).readAuthSession(accountInput(OWNER_USER, {
        sessionId: terminal.id
      }));

      assert.equal(ownerRead.ok, true);
      assert.equal(ownerRead.id, terminal.id);
      assert.equal(ownerRead.account.id, "github");
      assert.equal(ownerRead.status, "authenticating");

      const friendRead = await createService({
        providerHomesRoot,
        targetRoot: path.join(root, "target")
      }).readAuthSession(accountInput(FRIEND_USER, {
        sessionId: terminal.id
      }));

      assert.equal(friendRead.ok, false);
      assert.equal(friendRead.code, "unknown_auth_session");
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace: ACCOUNT_AUTH_NAMESPACE
      });
    }
  });
});

test("GitHub auth terminal I/O is restricted to the same Vibe64 user", async () => {
  await withTemporaryRoot(async (root) => {
    const providerHomesRoot = path.join(root, "provider-homes");
    const service = createService({
      providerHomesRoot,
      targetRoot: path.join(root, "target")
    });
    const terminal = startTerminalSession({
      args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
      command: process.execPath,
      commandPreview: "node github-auth",
      metadata: authTerminalMetadata("github", "browser", {
        userKey: githubProviderUserKey(OWNER_USER)
      }),
      namespace: ACCOUNT_AUTH_NAMESPACE,
      reuseRunning: false
    });
    assert.equal(terminal.ok, true);

    try {
      const ownerSubscribe = service.subscribeAuthTerminal(accountInput(OWNER_USER, {
        sessionId: terminal.id
      }), () => null);
      assert.equal(ownerSubscribe.ok, true);
      ownerSubscribe.unsubscribe();

      const friendSubscribe = service.subscribeAuthTerminal(accountInput(FRIEND_USER, {
        sessionId: terminal.id
      }), () => null);
      assert.equal(friendSubscribe.ok, false);
      assert.equal(friendSubscribe.code, "unknown_auth_session");

      const friendWrite = service.writeAuthTerminal(accountInput(FRIEND_USER, {
        sessionId: terminal.id
      }), "\r");
      assert.equal(friendWrite.ok, false);
      assert.equal(friendWrite.code, "unknown_auth_session");
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace: ACCOUNT_AUTH_NAMESPACE
      });
    }
  });
});

test("GitHub auth start requires explicit Git identity fields", async () => {
  await withTemporaryRoot(async (root) => {
    const result = await createService({
      providerHomesRoot: path.join(root, "provider-homes"),
      targetRoot: path.join(root, "target")
    }).startAuth(accountInput(OWNER_USER, {
      accountId: "github"
    }));

    assert.equal(result.ok, false);
    assert.equal(result.code, "github_git_identity_required");
  });
});

test("GitHub browser auth command prefeeds the web prompt newline", () => {
  const args = ghLoginCommandArgs({
    email: "merc@example.com",
    name: "Merc Mobily"
  });
  const script = args[2] || "";

  assert.equal(args[0], "bash");
  assert.equal(args[1], "-lc");
  assert.match(script, /printf '\\n' \| gh auth login --hostname github\.com --git-protocol https --web --scopes repo,read:org,gist,workflow/u);
  assert.doesNotMatch(script, /\n\s*gh auth login --hostname github\.com/u);
  assert.match(script, /git config --global user\.name 'Merc Mobily'/u);
  assert.match(script, /git config --global user\.email merc@example\.com/u);
});

test("Account routes inject the authenticated Vibe64 user into account actions", async () => {
  await withLocalRequestBypass(async () => {
    const app = testRouteApp();
    registerAccountRoutes(app, {
      routeRelativePath: "vibe64/accounts",
      routeSurface: "app",
      projectScoped: false
    });

    const route = app.registeredRoutes.find((candidate) => {
      return candidate.method === "POST" && candidate.path === "/api/vibe64/accounts/auth";
    });
    assert.ok(route);

    const reply = testReply();
    await route.handler({
      input: {
        body: {
          accountId: "github"
        }
      },
      params: {},
      vibe64User: OWNER_USER,
      async executeAction(action) {
        return {
          action,
          ok: true
        };
      }
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.deepEqual(reply.payload.action.input, {
      accountId: "github",
      vibe64User: OWNER_USER
    });
  });
});

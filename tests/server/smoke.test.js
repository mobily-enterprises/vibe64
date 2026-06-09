import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket from "ws";

import {
  githubProviderHome
} from "@local/studio-terminal-core/server/providerHomes";
import { createServer, resolveListenTarget, startServer } from "../../server.js";
import { BROWSER_LIFECYCLE_WEBSOCKET_PATH } from "../../server/lib/browserLifecycle.js";
import { loadRuntimeEnvFiles, resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";
import { GITHUB_API_BASE, PROJECT_API_BASE } from "../../server/lib/projectRoutes.js";

async function withTemporaryPackageRoot(packageName, callback) {
  const projectsRoot = await mkdtemp(path.join(tmpdir(), "vibe64-projects-"));
  const slug = "smoke_project";
  const root = path.join(projectsRoot, slug);
  await mkdir(root, {
    recursive: true
  });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: packageName,
      private: true,
      scripts: {
        test: "echo ok"
      },
      version: "0.0.0"
    }, null, 2),
    "utf8"
  );

  try {
    return await callback(root, {
      apiBase: `/api/app/${slug}`,
      projectsRoot,
      slug
    });
  } finally {
    await rm(projectsRoot, {
      force: true,
      recursive: true
    });
  }
}

async function withTargetRoot(_targetRoot, projectFixture, callback) {
  const authDataRoot = await mkdtemp(path.join(tmpdir(), "vibe64-auth-smoke-"));

  let app;
  try {
    app = await createServer({
      authDataRoot,
      projectsRoot: projectFixture.projectsRoot,
      verifySupabaseAccessToken: fakeVerifySupabaseAccessToken
    });
    const cookie = await authenticateOwner(app);
    const authHeaders = {
      cookie: Array.isArray(cookie) ? cookie[0] : cookie
    };
    return await callback(app, authHeaders, projectFixture.apiBase, authDataRoot);
  } finally {
    if (app) {
      await app.close();
    }
    await rm(authDataRoot, {
      force: true,
      recursive: true
    });
  }
}

test("server defaults to loopback host", () => {
  const previousHost = process.env.HOST;
  const previousPort = process.env.PORT;
  delete process.env.HOST;
  delete process.env.PORT;
  try {
    assert.equal(resolveRuntimeEnv().HOST, "127.0.0.1");
    assert.equal(resolveRuntimeEnv().PORT, null);
    assert.equal(resolveListenTarget().transport, "socket");
  } finally {
    if (previousHost == null) {
      delete process.env.HOST;
    } else {
      process.env.HOST = previousHost;
    }
    if (previousPort == null) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});

test("runtime env files load broadly while runtime config stays explicit", async () => {
  const keys = [
    "HOST",
    "PORT",
    "VIBE64_DATA_ROOT",
    "VIBE64_LISTEN_SOCKET",
    "VIBE64_SUPABASE_PUBLISHABLE_KEY",
    "VIBE64_SUPABASE_SECRET_KEY",
    "VIBE64_SUPABASE_URL"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const envRoot = await mkdtemp(path.join(tmpdir(), "vibe64-runtime-env-"));
  const appEnvFile = path.join(envRoot, ".env");
  const hostEnvFile = path.join(envRoot, "vibe64.env");

  try {
    for (const key of keys) {
      delete process.env[key];
    }
    await writeFile(appEnvFile, [
      "VIBE64_SUPABASE_PUBLISHABLE_KEY=repo-publishable",
      "VIBE64_SUPABASE_URL=https://repo.example.supabase.co",
      "HOST=0.0.0.0",
      "PORT=3939",
      "VIBE64_LISTEN_SOCKET=/tmp/vibe64-file.sock"
    ].join("\n"), "utf8");
    await writeFile(hostEnvFile, [
      "VIBE64_SUPABASE_PUBLISHABLE_KEY=host-publishable",
      "VIBE64_SUPABASE_SECRET_KEY=host-secret",
      "VIBE64_SUPABASE_URL=https://host.example.supabase.co",
      "VIBE64_DATA_ROOT=/tmp/vibe64-file-data-root"
    ].join("\n"), "utf8");

    loadRuntimeEnvFiles({
      appEnvFile,
      hostEnvFile
    });

    assert.equal(process.env.VIBE64_SUPABASE_PUBLISHABLE_KEY, "repo-publishable");
    assert.equal(process.env.VIBE64_SUPABASE_SECRET_KEY, "host-secret");
    assert.equal(process.env.VIBE64_SUPABASE_URL, "https://repo.example.supabase.co");
    assert.equal(process.env.HOST, "0.0.0.0");
    assert.equal(process.env.PORT, "3939");
    assert.equal(process.env.VIBE64_DATA_ROOT, "/tmp/vibe64-file-data-root");
    assert.equal(process.env.VIBE64_LISTEN_SOCKET, "/tmp/vibe64-file.sock");

    const runtimeEnv = resolveRuntimeEnv();
    assert.equal(runtimeEnv.HOST, "0.0.0.0");
    assert.equal(runtimeEnv.PORT, 3939);
    assert.equal(runtimeEnv.VIBE64_SUPABASE_SECRET_KEY, "host-secret");
    assert.equal(runtimeEnv.VIBE64_DATA_ROOT, undefined);
    assert.equal(runtimeEnv.VIBE64_LISTEN_SOCKET, undefined);
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(envRoot, {
      force: true,
      recursive: true
    });
  }
});

test("GET /api/health returns built-in health response", async () => {
  const app = await createServer();
  const response = await app.inject({
    method: "GET",
    url: "/api/health"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);

  await app.close();
});

test("protected API routes require Vibe64 login", async () => {
  const authDataRoot = await mkdtemp(path.join(tmpdir(), "vibe64-auth-required-"));
  const app = await createServer({
    authDataRoot,
    verifySupabaseAccessToken: fakeVerifySupabaseAccessToken
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/vibe64/project-type"
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, "vibe64_auth_required");
  } finally {
    await app.close();
    await rm(authDataRoot, {
      force: true,
      recursive: true
    });
  }
});

test("first-login Codex setup completion uses the configured account verifier", async () => {
  const authDataRoot = await mkdtemp(path.join(tmpdir(), "vibe64-auth-codex-setup-"));
  let codexConnected = false;
  const app = await createServer({
    authDataRoot,
    codexConnectedVerifier: async () => ({
      connected: codexConnected,
      ok: true
    }),
    verifySupabaseAccessToken: fakeVerifySupabaseAccessToken
  });
  try {
    const cookie = await authenticateOwner(app);
    const headers = {
      cookie: Array.isArray(cookie) ? cookie[0] : cookie
    };
    const blocked = await app.inject({
      headers,
      method: "POST",
      url: "/api/auth/setup/codex-complete"
    });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().code, "vibe64_codex_setup_incomplete");

    codexConnected = true;
    const completed = await app.inject({
      headers,
      method: "POST",
      url: "/api/auth/setup/codex-complete"
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().firstLoginCodexSetupPending, false);

    const state = await app.inject({
      headers,
      method: "GET",
      url: "/api/auth/state"
    });
    assert.equal(state.statusCode, 200);
    assert.equal(state.json().firstLoginCodexSetupPending, false);
  } finally {
    await app.close();
    await rm(authDataRoot, {
      force: true,
      recursive: true
    });
  }
});

test("browser lifecycle WebSocket requires Vibe64 login", async () => {
  const authDataRoot = await mkdtemp(path.join(tmpdir(), "vibe64-auth-ws-"));
  const app = await createServer({
    authDataRoot,
    verifySupabaseAccessToken: fakeVerifySupabaseAccessToken
  });
  try {
    await app.listen({
      host: "127.0.0.1",
      port: 0
    });
    const address = app.server.address();
    const socketUrl = `ws://127.0.0.1:${address.port}${BROWSER_LIFECYCLE_WEBSOCKET_PATH}`;

    const rejected = await connectWebSocket(socketUrl);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.statusCode, 401);

    const cookie = await authenticateOwner(app);
    const accepted = await connectWebSocket(socketUrl, {
      headers: {
        Cookie: Array.isArray(cookie) ? cookie[0] : cookie
      }
    });
    try {
      assert.equal(accepted.ok, true);
      assert.equal(accepted.message.type, "browser-lifecycle-state");
    } finally {
      accepted.socket.close();
    }
  } finally {
    await app.close();
    await rm(authDataRoot, {
      force: true,
      recursive: true
    });
  }
});

test("management project API lists and creates slugs without global selection", async () => {
  const authDataRoot = await mkdtemp(path.join(tmpdir(), "vibe64-auth-projects-"));
  const projectsRoot = await mkdtemp(path.join(tmpdir(), "vibe64-projects-"));
  const app = await createServer({
    authDataRoot,
    projectsRoot,
    verifySupabaseAccessToken: fakeVerifySupabaseAccessToken
  });
  try {
    const blocked = await app.inject({
      method: "GET",
      url: PROJECT_API_BASE
    });
    assert.equal(blocked.statusCode, 401);

    const cookie = await authenticateOwner(app);
    const authHeaders = {
      cookie: Array.isArray(cookie) ? cookie[0] : cookie
    };
    const memberCookie = await authenticateMember(app);
    const memberHeaders = {
      cookie: Array.isArray(memberCookie) ? memberCookie[0] : memberCookie
    };

    const memberListed = await app.inject({
      headers: memberHeaders,
      method: "GET",
      url: PROJECT_API_BASE
    });
    assert.equal(memberListed.statusCode, 200);

    const memberCreate = await app.inject({
      headers: memberHeaders,
      method: "POST",
      payload: {
        slug: "member_project"
      },
      url: PROJECT_API_BASE
    });
    assert.equal(memberCreate.statusCode, 403);
    assert.equal(memberCreate.json().errors[0].code, "vibe64_owner_required");

    const created = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        githubRepository: {
          fullName: "example/alpha_1"
        },
        slug: "alpha_1"
      },
      url: PROJECT_API_BASE
    });
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().project.projectRoot, path.join(projectsRoot, "alpha_1"));
    await access(path.join(projectsRoot, "alpha_1"));

    const secondCreated = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        githubRepository: {
          fullName: "example/beta_2"
        },
        slug: "beta_2"
      },
      url: PROJECT_API_BASE
    });
    assert.equal(secondCreated.statusCode, 200);
    assert.equal(secondCreated.json().project.projectRoot, path.join(projectsRoot, "beta_2"));

    const invalid = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        slug: "Bad.Slug"
      },
      url: PROJECT_API_BASE
    });
    assert.equal(invalid.statusCode, 422);
    assert.equal(invalid.json().errors[0].code, "vibe64_invalid_project_slug");

    const listed = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: PROJECT_API_BASE
    });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().projects.map((project) => project.slug), ["alpha_1", "beta_2"]);

    const projectType = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/app/alpha_1/vibe64/project-type"
    });
    assert.equal(projectType.statusCode, 200);
    assert.equal(projectType.json().projectType.status, "missing");

    const savedAlphaProjectType = await app.inject({
      headers: authHeaders,
      method: "PUT",
      payload: {
        projectType: "jskit"
      },
      url: "/api/app/alpha_1/vibe64/project-type"
    });
    assert.equal(savedAlphaProjectType.statusCode, 200);
    assert.equal(savedAlphaProjectType.json().projectType.ready, true);

    const betaProjectType = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/app/beta_2/vibe64/project-type"
    });
    assert.equal(betaProjectType.statusCode, 200);
    assert.equal(betaProjectType.json().projectType.status, "missing");
    await access(path.join(authDataRoot, "projects", "alpha_1", "project_type"));
    await assert.rejects(
      access(path.join(authDataRoot, "projects", "beta_2", "project_type"))
    );
  } finally {
    await app.close();
    await rm(authDataRoot, {
      force: true,
      recursive: true
    });
    await rm(projectsRoot, {
      force: true,
      recursive: true
    });
  }
});

test("only owners can add GitHub-backed projects", async () => {
  const authDataRoot = await mkdtemp(path.join(tmpdir(), "vibe64-auth-github-projects-"));
  const projectsRoot = await mkdtemp(path.join(tmpdir(), "vibe64-github-projects-"));
  const calls = [];
  const app = await createServer({
    authDataRoot,
    projectsRoot,
    runGithubToolchain: fakeGithubProjectToolchain(calls),
    verifySupabaseAccessToken: fakeVerifySupabaseAccessToken
  });
  try {
    const ownerCookie = await authenticateOwner(app);
    const ownerHeaders = {
      cookie: Array.isArray(ownerCookie) ? ownerCookie[0] : ownerCookie
    };
    const memberCookie = await authenticateMember(app);
    const memberHeaders = {
      cookie: Array.isArray(memberCookie) ? memberCookie[0] : memberCookie
    };

    const memberUsers = await app.inject({
      headers: memberHeaders,
      method: "GET",
      url: "/api/auth/users"
    });
    assert.equal(memberUsers.statusCode, 200);
    assert.deepEqual(
      memberUsers.json().users.map((user) => user.email),
      ["member@example.com", "owner@example.com"]
    );

    const memberInvite = await app.inject({
      headers: memberHeaders,
      method: "POST",
      payload: {
        email: "second-member@example.com"
      },
      url: "/api/auth/invite"
    });
    assert.equal(memberInvite.statusCode, 403);
    assert.equal(memberInvite.json().code, "vibe64_owner_required");

    const memberOwners = await app.inject({
      headers: memberHeaders,
      method: "GET",
      url: `${GITHUB_API_BASE}/repository-owners`
    });
    assert.equal(memberOwners.statusCode, 200);

    const owners = await app.inject({
      headers: ownerHeaders,
      method: "GET",
      url: `${GITHUB_API_BASE}/repository-owners`
    });
    assert.equal(owners.statusCode, 200);
    assert.deepEqual(owners.json().owners.map((owner) => owner.login), ["octocat", "vibe64-org", "readonly-org"]);

    const repositoryList = await app.inject({
      headers: memberHeaders,
      method: "GET",
      url: `${GITHUB_API_BASE}/repositories/search?owner=vibe64-org`
    });
    assert.equal(repositoryList.statusCode, 200);
    assert.deepEqual(
      repositoryList.json().repositories.map((repository) => repository.fullName),
      ["vibe64-org/mickeymouse", "vibe64-org/donald"]
    );

    const memberOpen = await app.inject({
      headers: memberHeaders,
      method: "POST",
      payload: {
        repository: "vibe64-org/mickeymouse",
        slug: "member_opened"
      },
      url: `${PROJECT_API_BASE}/from-repository`
    });
    assert.equal(memberOpen.statusCode, 403);
    assert.equal(memberOpen.json().errors[0].code, "vibe64_owner_required");

    const memberCreate = await app.inject({
      headers: memberHeaders,
      method: "POST",
      payload: {
        name: "member-repo",
        owner: "vibe64-org",
        slug: "member_repo",
        visibility: "private"
      },
      url: `${PROJECT_API_BASE}/create-repository`
    });
    assert.equal(memberCreate.statusCode, 403);

    const opened = await app.inject({
      headers: ownerHeaders,
      method: "POST",
      payload: {
        repository: "vibe64-org/mickeymouse",
        slug: "beepollen"
      },
      url: `${PROJECT_API_BASE}/from-repository`
    });
    assert.equal(opened.statusCode, 200);
    assert.equal(opened.json().project.slug, "beepollen");
    assert.equal(opened.json().project.githubRepository.fullName, "vibe64-org/mickeymouse");
    assert.equal(opened.json().project.githubRepository.canPush, false);

    const created = await app.inject({
      headers: ownerHeaders,
      method: "POST",
      payload: {
        name: "new-repo",
        owner: "vibe64-org",
        slug: "new_project",
        visibility: "private"
      },
      url: `${PROJECT_API_BASE}/create-repository`
    });
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().project.slug, "new_project");
    assert.equal(created.json().project.githubRepository.fullName, "vibe64-org/new-repo");

    const listed = await app.inject({
      headers: ownerHeaders,
      method: "GET",
      url: PROJECT_API_BASE
    });
    assert.deepEqual(
      listed.json().projects.map((project) => project.githubRepository?.fullName),
      ["vibe64-org/mickeymouse", "vibe64-org/new-repo"]
    );
    assert.ok(calls.some((call) => call.command.join(" ") === "gh repo clone vibe64-org/mickeymouse ."));
    assert.ok(calls.some((call) => call.command.join(" ") === "git init -b main"));
    assert.ok(calls.some((call) => call.command.join(" ") === "gh repo create vibe64-org/new-repo --private --source=. --remote=origin"));
    assert.ok(calls.some((call) => call.command.join(" ") === "gh repo list vibe64-org --limit 1000 --json name,nameWithOwner,description,isPrivate,isArchived,url,sshUrl,defaultBranchRef,pushedAt,viewerPermission,owner"));

    await app.vibe64Auth.users.updateGithubIdentity({
      email: "member@example.com"
    }, {
      id: 456,
      login: "memberhub"
    });

    const linkedMemberUsers = await app.inject({
      headers: memberHeaders,
      method: "GET",
      url: "/api/auth/users"
    });
    assert.equal(linkedMemberUsers.statusCode, 200);
    assert.equal(
      linkedMemberUsers.json().users.find((user) => user.email === "member@example.com")?.github?.login,
      "memberhub"
    );

    const memberAccess = await app.inject({
      headers: memberHeaders,
      method: "GET",
      url: `${PROJECT_API_BASE}/new_project/access`
    });
    assert.equal(memberAccess.statusCode, 403);

    const projectAccess = await app.inject({
      headers: ownerHeaders,
      method: "GET",
      url: `${PROJECT_API_BASE}/new_project/access`
    });
    assert.equal(projectAccess.statusCode, 200);
    assert.equal(projectAccess.json().currentUserCanManageAccess, true);
    assert.equal(projectAccess.json().users.find((user) => user.email === "member@example.com")?.github?.login, "memberhub");

    const inviteAccess = await app.inject({
      headers: ownerHeaders,
      method: "POST",
      payload: {
        email: "member@example.com"
      },
      url: `${PROJECT_API_BASE}/new_project/access/invite`
    });
    assert.equal(inviteAccess.statusCode, 200);
    assert.ok(calls.some((call) => call.command.join(" ") === "gh api -X PUT repos/vibe64-org/new-repo/collaborators/memberhub -f permission=push"));
  } finally {
    await app.close();
    await rm(authDataRoot, {
      force: true,
      recursive: true
    });
    await rm(projectsRoot, {
      force: true,
      recursive: true
    });
  }
});

test("started server publishes management mode as the browser entry URL", async () => {
  const app = await startServer({
    host: "127.0.0.1",
    port: 0,
    strictPort: false
  });

  try {
    const url = new URL(app.vibe64Url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/app/manage/projects");
  } finally {
    await app.close();
  }
});

test("started server defaults to Unix socket when PORT is not set", async () => {
  const previousPort = process.env.PORT;
  const socketRoot = await mkdtemp(path.join(tmpdir(), "vibe64-listen-socket-"));
  const socketPath = path.join(socketRoot, "server.sock");
  delete process.env.PORT;
  const app = await startServer({
    listenSocket: socketPath,
    publicOrigin: "https://tonymobily.vibe64.dev",
    startupSlug: "beepollen"
  });

  try {
    assert.equal(app.vibe64Listen.transport, "socket");
    assert.equal(app.vibe64Listen.socketPath, socketPath);
    assert.equal(app.vibe64Url, "https://tonymobily.vibe64.dev/app/beepollen");
    await access(socketPath);
  } finally {
    await app.close();
    await rm(socketRoot, {
      force: true,
      recursive: true
    });
    if (previousPort == null) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});

async function authenticateOwner(app, {
  githubLogin = "octocat",
  linkGithub = true
} = {}) {
  const response = await app.inject({
    method: "POST",
    payload: {
      accessToken: "owner-token"
    },
    url: "/api/auth/supabase-session"
  });
  assert.equal(response.statusCode, 200);
  if (linkGithub) {
    await writeReadyGithubProviderHome(app.vibe64Auth.dataRoot, {
      email: "owner@example.com",
      githubLogin,
      gitUserName: "Owner Example"
    });
  }
  return response.headers["set-cookie"];
}

async function authenticateMember(app, {
  githubLogin = "memberhub",
  linkGithub = true
} = {}) {
  const invite = await app.vibe64Auth.users.inviteUser({
    email: "member@example.com"
  });
  assert.equal(invite.status, "invited");
  const response = await app.inject({
    method: "POST",
    payload: {
      accessToken: "member-token"
    },
    url: "/api/auth/supabase-session"
  });
  assert.equal(response.statusCode, 200);
  if (linkGithub) {
    await writeReadyGithubProviderHome(app.vibe64Auth.dataRoot, {
      email: "member@example.com",
      githubLogin,
      gitUserName: "Member Example"
    });
  }
  return response.headers["set-cookie"];
}

async function writeReadyGithubProviderHome(dataRoot, {
  email = "",
  githubLogin = "",
  gitUserName = ""
} = {}) {
  const home = githubProviderHome(path.join(dataRoot, "provider-homes"), {
    email
  });
  await mkdir(path.join(home, ".config", "gh"), {
    mode: 0o700,
    recursive: true
  });
  await writeFile(
    path.join(home, ".config", "gh", "hosts.yml"),
    [
      "github.com:",
      "    oauth_token: test-token",
      `    user: ${githubLogin}`,
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(home, ".gitconfig"),
    [
      "[credential \"https://github.com\"]",
      "\thelper = gh auth git-credential",
      "[user]",
      `\tname = ${gitUserName}`,
      `\temail = ${email}`,
      ""
    ].join("\n"),
    "utf8"
  );
}

async function fakeVerifySupabaseAccessToken(token = "") {
  if (token === "owner-token") {
    return {
      email: "owner@example.com",
      id: "supabase-owner"
    };
  }
  if (token === "member-token") {
    return {
      email: "member@example.com",
      id: "supabase-member"
    };
  }
  const error = new Error("Unknown test token.");
  error.code = "vibe64_supabase_user_verification_failed";
  throw error;
}

function fakeGithubProjectToolchain(calls) {
  return async function runGithubToolchain(command, options = {}) {
    calls.push({
      command,
      targetRoot: options.targetRoot || ""
    });
    const joined = command.join(" ");
    if (joined.startsWith("gh api graphql")) {
      return toolchainJson({
        data: {
          viewer: {
            avatarUrl: "https://github.com/octocat.png",
            login: "octocat",
            organizations: {
              nodes: [
                {
                  avatarUrl: "https://github.com/vibe64-org.png",
                  login: "vibe64-org",
                  name: "Vibe64 Org",
                  viewerCanCreateRepositories: true
                },
                {
                  avatarUrl: "https://github.com/readonly-org.png",
                  login: "readonly-org",
                  name: "Read Only Org",
                  viewerCanCreateRepositories: false
                }
              ]
            }
          }
        }
      });
    }
    if (joined === "gh api user") {
      return toolchainJson({
        avatar_url: "https://github.com/octocat.png",
        id: 123,
        login: "octocat"
      });
    }
    if (joined === "gh repo view vibe64-org/new-repo --json viewerPermission") {
      return toolchainJson({
        viewerPermission: "ADMIN"
      });
    }
    if (joined === "gh api repos/vibe64-org/new-repo/collaborators/octocat/permission") {
      return toolchainJson({
        permission: "admin"
      });
    }
    if (joined === "gh api repos/vibe64-org/new-repo/collaborators/memberhub/permission") {
      return {
        ok: false,
        output: "Not Found",
        stdout: ""
      };
    }
    if (joined === "gh api -X PUT repos/vibe64-org/new-repo/collaborators/memberhub -f permission=push") {
      return {
        ok: true,
        output: "",
        stdout: "{}"
      };
    }
    if (joined === "gh repo view vibe64-org/mickeymouse --json name,nameWithOwner,description,visibility,isPrivate,owner,defaultBranchRef,url,sshUrl,viewerPermission,isArchived") {
      return toolchainJson(githubRepositoryView({
        name: "mickeymouse",
        nameWithOwner: "vibe64-org/mickeymouse",
        viewerPermission: "READ"
      }));
    }
    if (joined === "gh repo view vibe64-org/new-repo --json name,nameWithOwner,description,visibility,isPrivate,owner,defaultBranchRef,url,sshUrl,viewerPermission,isArchived") {
      return toolchainJson(githubRepositoryView({
        name: "new-repo",
        nameWithOwner: "vibe64-org/new-repo",
        viewerPermission: "ADMIN"
      }));
    }
    if (joined === "gh repo list vibe64-org --limit 1000 --json name,nameWithOwner,description,isPrivate,isArchived,url,sshUrl,defaultBranchRef,pushedAt,viewerPermission,owner") {
      return toolchainJson([
        githubRepositoryListItem({
          name: "mickeymouse",
          nameWithOwner: "vibe64-org/mickeymouse",
          viewerPermission: "READ"
        }),
        githubRepositoryListItem({
          name: "donald",
          nameWithOwner: "vibe64-org/donald",
          viewerPermission: "WRITE"
        })
      ]);
    }
    if (
      joined === "gh repo clone vibe64-org/mickeymouse ." ||
      joined === "git init -b main" ||
      joined === "gh repo create vibe64-org/new-repo --private --source=. --remote=origin"
    ) {
      return {
        ok: true,
        output: "",
        stdout: ""
      };
    }
    return {
      ok: false,
      output: `Unexpected fake GitHub command: ${joined}`,
      stdout: ""
    };
  };
}

function githubRepositoryView({
  name,
  nameWithOwner,
  viewerPermission
}) {
  return {
    defaultBranchRef: {
      name: "main"
    },
    description: "A repository",
    isArchived: false,
    isPrivate: true,
    name,
    nameWithOwner,
    owner: {
      login: nameWithOwner.split("/")[0]
    },
    sshUrl: `git@github.com:${nameWithOwner}.git`,
    url: `https://github.com/${nameWithOwner}`,
    viewerPermission,
    visibility: "PRIVATE"
  };
}

function githubRepositoryListItem({
  name,
  nameWithOwner,
  viewerPermission
}) {
  return {
    defaultBranchRef: {
      name: "main"
    },
    description: "A repository",
    isArchived: false,
    isPrivate: true,
    name,
    nameWithOwner,
    owner: {
      login: nameWithOwner.split("/")[0]
    },
    pushedAt: "2026-06-07T00:00:00Z",
    sshUrl: `git@github.com:${nameWithOwner}.git`,
    url: `https://github.com/${nameWithOwner}`,
    viewerPermission
  };
}

function toolchainJson(payload) {
  const stdout = JSON.stringify(payload);
  return {
    ok: true,
    output: stdout,
    stdout
  };
}

function connectWebSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Timed out waiting for WebSocket ${url}`));
    }, 2000);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        statusCode: response.statusCode
      });
    });
    socket.once("message", (rawMessage) => {
      clearTimeout(timeout);
      resolve({
        message: JSON.parse(rawMessage.toString()),
        ok: true,
        socket
      });
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

test("current-app route reports the selected target root before project type setup", async () => {
  await withTemporaryPackageRoot("external-target-app", async (targetRoot, projectFixture) => {
    await withTargetRoot(targetRoot , projectFixture, async (app, authHeaders, apiBase) => {
      const remoteHost = await app.inject({
        headers: {
          ...authHeaders,
          host: "example.com"
        },
        method: "GET",
        url: `${apiBase}/studio/current-app`
      });
      assert.equal(remoteHost.statusCode, 200);
      assert.equal(remoteHost.json().ok, true);

      const response = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: `${apiBase}/studio/current-app`
      });
      assert.equal(response.statusCode, 200);
      const payload = response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.root, targetRoot);
      assert.equal(payload.ready, false);
      assert.equal(payload.projectType.status, "missing");
    });
  });
});

test("Vibe64 project routes persist project type and plain-file config", async () => {
  await withTemporaryPackageRoot("configured-target-app", async (targetRoot, projectFixture) => {
    await withTargetRoot(targetRoot , projectFixture, async (app, authHeaders, apiBase, dataRoot) => {
      const stateRoot = path.join(dataRoot, "projects", projectFixture.slug);
      const beforeType = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: `${apiBase}/vibe64/project-type`
      });
      assert.equal(beforeType.statusCode, 200);
      assert.equal(beforeType.json().projectType.ready, false);
      assert.equal(beforeType.json().projectType.status, "missing");

      const savedType = await app.inject({
        headers: authHeaders,
        method: "PUT",
        payload: {
          projectType: "jskit"
        },
        url: `${apiBase}/vibe64/project-type`
      });
      assert.equal(savedType.statusCode, 200);
      assert.equal(savedType.json().projectType.ready, true);
      assert.equal(
        await readFile(path.join(stateRoot, "project_type"), "utf8"),
        "jskit\n"
      );

      const defaults = await app.inject({
        headers: authHeaders,
        method: "GET",
        url: `${apiBase}/vibe64/project-config/defaults`
      });
      assert.equal(defaults.statusCode, 200);
      assert.equal(defaults.json().defaults.projectType, "jskit");
      assert.equal(defaults.json().defaults.defaults.github_pr_merge_method, "merge");

      const savedConfig = await app.inject({
        headers: authHeaders,
        method: "PUT",
        payload: {
          values: {
            github_pr_merge_method: "squash",
            jskit_database_runtime: "mysql"
          }
        },
        url: `${apiBase}/vibe64/project-config`
      });
      assert.equal(savedConfig.statusCode, 200);
      assert.equal(savedConfig.json().config.ready, true);
      assert.equal(
        await readFile(path.join(stateRoot, "config", "github_pr_merge_method"), "utf8"),
        "squash\n"
      );
    });
  });
});

test("Vibe64 session creation returns a setup gate and removed issue-session routes stay unavailable", async () => {
  await withTemporaryPackageRoot("session-target-app", async (targetRoot, projectFixture) => {
    await withTargetRoot(targetRoot , projectFixture, async (app, authHeaders, apiBase) => {
      const removedIssueSessionRoute = await app.inject({
        headers: authHeaders,
        method: "POST",
        url: `${apiBase}/studio/current-app/issue-sessions`
      });
      assert.equal(removedIssueSessionRoute.statusCode, 404);

      const missingProjectType = await app.inject({
        headers: authHeaders,
        method: "POST",
        payload: {},
        url: `${apiBase}/vibe64/sessions`
      });
      assert.equal(missingProjectType.statusCode, 400);
      assert.equal(missingProjectType.json().ok, false);
      assert.equal(missingProjectType.json().errors[0].code, "vibe64_project_type_missing");
    });
  });
});

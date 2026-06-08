import { expect, test, type Page, type Route } from "@playwright/test";

const SLUG = "alpha_1";
const PROJECT_ROOT = `/home/vibe64/${SLUG}`;
const PROJECT_REPOSITORY = `example/${SLUG}`;
const MANAGEMENT_PATH = "/app/manage";
const DEVELOPMENT_PATH = `/app/${SLUG}`;
const DASHBOARD_PATH = `${DEVELOPMENT_PATH}/dashboard`;
const SCOPED_API_PREFIX = `/api/app/${SLUG}`;
const ownerUser = {
  email: "owner@example.com",
  gravatarUrl: "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=identicon",
  identityLinked: true,
  role: "owner",
  status: "active"
};

test("first-run owner setup reaches management and opens a slug-scoped project", async ({ page }) => {
  const requests: string[] = [];
  const sessions: SessionRow[] = [];
  const projects: ProjectRow[] = [];
  const users = [
    {
      ...ownerUser,
      supabaseUserId: "supabase-owner"
    }
  ];
  let authenticated = false;

  await mockLifecycleSocket(page);
  await mockSupabaseAuth(page);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    requests.push(`${method} ${url.pathname}`);

    if (url.pathname === "/api/auth/state" && method === "GET") {
      await fulfillJson(route, authenticated
        ? authenticatedState()
        : {
            authenticated: false,
            ok: true,
            supabase: supabaseConfig(),
            setupRequired: true,
            user: null
          });
      return;
    }

    if (url.pathname === "/api/auth/supabase-config" && method === "GET") {
      await fulfillJson(route, {
        ok: true,
        supabase: supabaseConfig()
      });
      return;
    }

    if (url.pathname === "/api/auth/supabase-session" && method === "POST") {
      authenticated = true;
      await fulfillJson(route, {
        ok: true,
        user: ownerUser
      });
      return;
    }

    if (url.pathname === "/api/auth/users" && method === "GET") {
      await fulfillJson(route, {
        ok: true,
        users
      });
      return;
    }

    if (url.pathname === "/api/auth/invite" && method === "POST") {
      const body = request.postDataJSON() as { email?: string };
      users.push({
        email: String(body.email || "").toLowerCase(),
        gravatarUrl: "",
        identityLinked: false,
        role: "member",
        status: "invited",
        supabaseUserId: ""
      });
      await fulfillJson(route, {
        ok: true
      });
      return;
    }

    if (url.pathname === "/api/vibe64/github/repository-owners" && method === "GET") {
      await fulfillJson(route, {
        ok: true,
        owners: [
          {
            canCreateRepository: true,
            login: "example",
            type: "user"
          }
        ]
      });
      return;
    }

    if (url.pathname === "/api/vibe64/github/repositories/search" && method === "GET") {
      await fulfillJson(route, {
        ok: true,
        repositories: [
          {
            canPush: true,
            description: "Example project repository",
            fullName: PROJECT_REPOSITORY,
            isPrivate: false,
            name: SLUG,
            owner: "example",
            visibility: "public"
          }
        ]
      });
      return;
    }

    if (url.pathname === "/api/vibe64/projects/from-repository" && method === "POST") {
      const body = request.postDataJSON() as { repository?: string; slug?: string };
      const slug = String(body.slug || "").trim();
      const repository = String(body.repository || PROJECT_REPOSITORY).trim();
      const project = projectRow(slug, repository);
      projects.push(project);
      await fulfillJson(route, {
        ok: true,
        project,
        repository: project.githubRepository
      });
      return;
    }

    if (url.pathname === "/api/vibe64/projects") {
      if (method === "POST") {
        const body = request.postDataJSON() as { slug?: string };
        const slug = String(body.slug || "").trim();
        projects.push(projectRow(slug));
      }
      await fulfillJson(route, projectList(projects));
      return;
    }

    if (url.pathname === "/api/vibe64/accounts" && method === "GET") {
      await fulfillJson(route, accountsReady());
      return;
    }

    if (url.pathname === "/api/vibe64/sessions" && method === "GET") {
      await fulfillJson(route, emptySessions());
      return;
    }

    if (url.pathname === "/api/bootstrap" && method === "GET") {
      await fulfillJson(route, bootstrapPayload());
      return;
    }

    if (url.pathname === "/api/studio/studio-setup" && method === "GET") {
      await fulfillJson(route, studioSetupReady());
      return;
    }

    if (url.pathname === "/api/studio/studio-setup/stream" && method === "GET") {
      await fulfillSse(route, studioSetupReady());
      return;
    }

    if (url.pathname.startsWith(SCOPED_API_PREFIX)) {
      await fulfillScopedDevelopmentApi(route, url.pathname.slice(SCOPED_API_PREFIX.length), method, sessions);
      return;
    }

    throw new Error(`Unexpected API request in slug smoke: ${method} ${url.pathname}`);
  });

  await page.goto(MANAGEMENT_PATH);
  await expect(page.getByRole("heading", { name: "Create owner", exact: true })).toBeVisible();
  await page.getByLabel("Email").fill(ownerUser.email);
  await page.getByLabel("Password", { exact: true }).fill("owner-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("owner-password");
  await page.getByRole("button", { name: "Create owner" }).click();

  await expect(page).toHaveURL(new RegExp(`${MANAGEMENT_PATH}$`, "u"));
  await expect(page.getByRole("heading", { name: "Management", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Projects", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Studio setup", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "AI Accounts", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Users", exact: true })).toBeVisible();
  await expect(page.getByText("No projects yet.")).toBeVisible();

  await page.getByRole("tab", { name: "Studio setup", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Studio setup", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Ready", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Users", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Users", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change password", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "AI Accounts", exact: true }).click();
  await expect(page.getByRole("tab", { name: "AI Accounts", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "AI Accounts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codex", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GitHub", exact: true })).toHaveCount(0);

  await page.goto(`/account?returnTo=${encodeURIComponent(MANAGEMENT_PATH)}`);
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "GitHub", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Password", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codex", exact: true })).toHaveCount(0);
  await expect(page.getByText("GitHub connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Logout", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(new RegExp(`${MANAGEMENT_PATH}$`, "u"));

  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  const addProjectWizard = page.locator(".project-wizard");
  await expect(addProjectWizard.getByRole("heading", { name: "Add project", exact: true })).toBeVisible();
  await addProjectWizard.getByLabel("Project name").fill(SLUG);
  await addProjectWizard.getByRole("button", { name: "Continue", exact: true }).click();
  await addProjectWizard.getByLabel("Repository name").fill(SLUG);
  await addProjectWizard.getByRole("button", { name: PROJECT_REPOSITORY }).click();
  await addProjectWizard.getByRole("button", { name: "Add project", exact: true }).click();
  const projectsRegion = page.getByRole("region", { name: "Projects", exact: true });
  const projectButton = projectsRegion.getByRole("button", { name: new RegExp(SLUG, "u") });
  await expect(projectButton).toBeVisible();

  await page.getByRole("tab", { name: "Users", exact: true }).click();
  await page.getByLabel("Invite email").fill("friend@example.com");
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText("friend@example.com")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Invited", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await projectButton.click();
  await expect(page).toHaveURL(new RegExp(`${DEVELOPMENT_PATH}$`, "u"));
  await expect(page.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create session" })).toBeVisible();

  await page.getByRole("button", { name: "Create session" }).click();
  await page.getByRole("listitem").filter({ hasText: "Make improvements" }).click();
  await expect(page.getByText("Created session")).toBeVisible();
  await page.getByLabel("Abandon session").click();
  await expect(page.getByRole("dialog", { name: "Abandon session?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Abandon session?" }).getByRole("button", { name: "Abandon session" }).click();
  await expect(page.getByRole("button", { name: "Create session" })).toBeVisible();
  await expect(page.getByText("No sessions yet.")).toHaveCount(0);

  await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/configure/?$`, "u"));
  await expect(page.locator(".project-config-setup")).toBeVisible();
  await expect(page.locator(".section-container-shell__nav").getByText("Accounts", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Codex", exact: true })).toHaveCount(0);

  await page.locator(".section-container-shell__nav").getByText("Setup", { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/setup\\?tab=project-setup$`, "u"));
  await expect(page.getByRole("tab", { name: "Project Setup", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Adapter Setup", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Preparing your project", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready", exact: true })).toBeVisible();

  expect(requests).toContain(`GET ${SCOPED_API_PREFIX}/vibe64/projects`);
  expect(requests).toContain(`GET ${SCOPED_API_PREFIX}/studio/current-app/capabilities`);
  expect(requests).toContain(`POST ${SCOPED_API_PREFIX}/vibe64/sessions`);
  expect(requests).toContain(`POST ${SCOPED_API_PREFIX}/vibe64/sessions/session-1/abandon`);
  expect(requests).not.toContain("GET /api/vibe64/sessions");
  expect(requests).not.toContain("POST /api/vibe64/sessions");
  expect(requests).not.toContain("GET /api/studio/current-app/capabilities");
});

test("authenticated users must connect GitHub on the account page before using the app", async ({ page }) => {
  const requests: string[] = [];
  await mockLifecycleSocket(page);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    requests.push(`${method} ${url.pathname}`);

    if (url.pathname === "/api/auth/state" && method === "GET") {
      await fulfillJson(route, authenticatedState());
      return;
    }

    if (url.pathname === "/api/vibe64/accounts" && method === "GET") {
      await fulfillJson(route, githubMissingAccounts());
      return;
    }

    if (url.pathname === "/api/bootstrap" && method === "GET") {
      await fulfillJson(route, bootstrapPayload());
      return;
    }

    throw new Error(`Unexpected API request in GitHub prerequisite smoke: ${method} ${url.pathname}`);
  });

  await page.goto(MANAGEMENT_PATH);

  await expect(page).toHaveURL(/\/account\?returnTo=%2Fapp%2Fmanage$/u);
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "GitHub", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Password", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codex", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in or create GitHub account" })).toBeVisible();
  expect(requests).not.toContain("GET /api/vibe64/projects");
});

type ProjectRow = {
  githubRepository: {
    canPush: boolean;
    cloneUrl: string;
    defaultBranch: string;
    fullName: string;
    isPrivate: boolean;
    name: string;
    owner: string;
    source: string;
    url: string;
    viewerPermission: string;
    visibility: string;
  };
  slug: string;
  projectRoot: string;
};

type SessionRow = {
  currentStep: string;
  metadata: {
    issue_word: string;
    worktree_path: string;
  };
  presentation: {
    intents: unknown[];
    screen: {
      kind: string;
      sections: unknown[];
      title: string;
    };
    terminal: {
      codex: {
        label: string;
        readOnlyInAutopilot: boolean;
        renderer: string;
        terminalSessionId: string;
        visible: boolean;
        visibleUntil: string;
      };
    };
  };
  revision: number;
  sessionId: string;
  status: string;
  stepMachine: {
    status: string;
    stepId: string;
  };
  stepRevision: number;
  workflowDefinition: {
    id: string;
    label: string;
  };
};

function projectRow(slug: string, repository = `example/${slug}`): ProjectRow {
  const [owner = "example", name = slug] = repository.split("/");
  return {
    githubRepository: {
      canPush: true,
      cloneUrl: `https://github.com/${owner}/${name}.git`,
      defaultBranch: "main",
      fullName: `${owner}/${name}`,
      isPrivate: false,
      name,
      owner,
      source: "github",
      url: `https://github.com/${owner}/${name}`,
      viewerPermission: "WRITE",
      visibility: "public"
    },
    slug,
    projectRoot: `/home/vibe64/${slug}`
  };
}

function authenticatedState() {
  return {
    authenticated: true,
    ok: true,
    supabase: supabaseConfig(),
    setupRequired: false,
    user: ownerUser
  };
}

function supabaseConfig() {
  return {
    configured: true,
    publishableKey: "sb_publishable_test",
    url: "https://example.supabase.co"
  };
}

async function mockSupabaseAuth(page: Page) {
  await page.route("**/auth/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/user")) {
      await fulfillJson(route, supabaseSessionPayload().user);
      return;
    }
    await fulfillJson(route, supabaseSessionPayload());
  });
}

function supabaseSessionPayload() {
  return {
    access_token: "owner-access-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    refresh_token: "owner-refresh-token",
    token_type: "bearer",
    user: {
      aud: "authenticated",
      email: ownerUser.email,
      id: "supabase-owner",
      role: "authenticated"
    }
  };
}

function projectList(projects: ProjectRow[]) {
  return {
    ok: true,
    projectsRoot: "/home/vibe64",
    projects
  };
}

function bootstrapPayload() {
  return {
    app: {
      features: {
        assistantEnabled: false,
        assistantRequiredPermission: "",
        socialEnabled: false,
        socialFederationEnabled: false
      }
    },
    definition: null,
    requestMeta: {
      hasRequest: false
    },
    session: {
      authenticated: false,
      oauthDefaultProvider: null,
      oauthProviders: []
    },
    surfaceAccess: {},
    userSettings: null
  };
}

async function fulfillScopedDevelopmentApi(route: Route, suffix: string, method: string, sessions: SessionRow[]) {
  if (method === "GET" && suffix === "/vibe64/projects") {
    await fulfillJson(route, {
      currentProject: {
        external: false,
        name: SLUG,
        path: PROJECT_ROOT,
        selected: true,
        slug: SLUG,
        source: "managed"
      },
      hasSelection: true,
      ok: true,
      projects: [
        {
          external: false,
          name: SLUG,
          path: PROJECT_ROOT,
          selected: true,
          slug: SLUG,
          source: "managed"
        }
      ],
      projectsRoot: "/home/vibe64",
      targetRoot: PROJECT_ROOT
    });
    return;
  }

  if (method === "GET" && suffix === "/vibe64/project-type") {
    await fulfillJson(route, {
      ok: true,
      projectType: {
        adapter: {
          id: "jskit",
          label: "JSKIT target adapter"
        },
        availableProjectTypes: [
          {
            enabled: true,
            id: "jskit",
            label: "JSKIT AI"
          }
        ],
        errorCode: "",
        message: "",
        path: `${PROJECT_ROOT}/.vibe64/project_type`,
        projectType: "jskit",
        ready: true,
        status: "ready",
        targetRoot: PROJECT_ROOT
      }
    });
    return;
  }

  if (method === "GET" && suffix === "/vibe64/project-config") {
    await fulfillJson(route, {
      config: {
        adapter: {
          id: "jskit",
          label: "JSKIT target adapter"
        },
        configRoot: `${PROJECT_ROOT}/.vibe64/config`,
        defaults: {},
        fields: [],
        fieldValues: {},
        helperPath: `${PROJECT_ROOT}/.vibe64/runtime/vibe64-config.sh`,
        invalid: [],
        message: "",
        missing: [],
        projectType: "jskit",
        ready: true,
        runtimeRoot: `${PROJECT_ROOT}/.vibe64/runtime`,
        sections: [],
        values: {}
      },
      ok: true
    });
    return;
  }

  if (method === "GET" && suffix === "/vibe64/accounts") {
    await fulfillJson(route, accountsReady());
    return;
  }

  if (method === "GET" && suffix === "/studio/current-app") {
    await fulfillJson(route, currentAppReady());
    return;
  }

  if (method === "GET" && suffix === "/studio/current-app/capabilities") {
    await fulfillJson(route, capabilitiesReady());
    return;
  }

  if (method === "GET" && suffix === "/studio/current-app/setup-readiness") {
    await fulfillJson(route, setupReadinessReady());
    return;
  }

  if (method === "GET" && suffix === "/studio/current-app/setup-readiness/stream") {
    await fulfillSse(route, setupReadinessReady(), "stages");
    return;
  }

  if (method === "GET" && suffix === "/studio/project-setup") {
    await fulfillJson(route, projectSetupReady());
    return;
  }

  if (method === "GET" && suffix === "/studio/project-setup/stream") {
    await fulfillSse(route, projectSetupReady(), "stages");
    return;
  }

  if (method === "GET" && suffix === "/vibe64/sessions") {
    await fulfillJson(route, emptySessions(sessions));
    return;
  }

  if (method === "POST" && suffix === "/vibe64/sessions") {
    const session = sessionPayload(`session-${sessions.length + 1}`);
    sessions.push(session);
    await fulfillJson(route, session);
    return;
  }

  const sessionDetailMatch = /^\/vibe64\/sessions\/([^/]+)$/u.exec(suffix);
  if (method === "GET" && sessionDetailMatch) {
    await fulfillJson(route, sessionById(sessions, sessionDetailMatch[1]));
    return;
  }

  const conversationLogMatch = /^\/vibe64\/sessions\/([^/]+)\/conversation-log$/u.exec(suffix);
  if (method === "GET" && conversationLogMatch) {
    await fulfillJson(route, {
      conversationLog: [],
      ok: true,
      revision: sessionById(sessions, conversationLogMatch[1]).revision || 1,
      sessionId: conversationLogMatch[1]
    });
    return;
  }

  const artifactReadinessMatch = /^\/vibe64\/sessions\/([^/]+)\/artifact-readiness$/u.exec(suffix);
  if (method === "GET" && artifactReadinessMatch) {
    await fulfillJson(route, {
      artifactReadiness: {},
      ok: true,
      sessionId: artifactReadinessMatch[1]
    });
    return;
  }

  const artifactPreviewMatch = /^\/vibe64\/sessions\/([^/]+)\/artifact-preview$/u.exec(suffix);
  if (method === "GET" && artifactPreviewMatch) {
    await fulfillJson(route, {
      label: "",
      ok: true,
      previewId: "",
      sessionId: artifactPreviewMatch[1],
      text: ""
    });
    return;
  }

  const artifactReadinessStreamMatch = /^\/vibe64\/sessions\/([^/]+)\/artifact-readiness\/stream$/u.exec(suffix);
  if (method === "GET" && artifactReadinessStreamMatch) {
    await fulfillArtifactReadinessSse(route, artifactReadinessStreamMatch[1]);
    return;
  }

  const launchTargetsMatch = /^\/vibe64\/sessions\/([^/]+)\/launch-targets$/u.exec(suffix);
  if (method === "GET" && launchTargetsMatch) {
    await fulfillJson(route, emptyLaunchTargets());
    return;
  }

  const abandonMatch = /^\/vibe64\/sessions\/([^/]+)\/abandon$/u.exec(suffix);
  if (method === "POST" && abandonMatch) {
    const session = sessionById(sessions, abandonMatch[1]);
    const index = sessions.findIndex((item) => item.sessionId === session.sessionId);
    if (index >= 0) {
      sessions.splice(index, 1);
    }
    await fulfillJson(route, {
      ...session,
      status: "abandoned"
    });
    return;
  }

  throw new Error(`Unexpected scoped development API request: ${method} ${suffix}`);
}

function accountsReady() {
  return {
    accounts: [
      {
        connected: true,
        id: "codex",
        label: "Codex",
        status: "connected"
      },
      {
        connected: true,
        id: "github",
        label: "GitHub",
        status: "connected"
      }
    ],
    ok: true,
    ready: true
  };
}

function githubMissingAccounts() {
  return {
    accounts: [
      {
        connected: true,
        id: "codex",
        label: "Codex",
        status: "connected"
      },
      {
        connected: false,
        id: "github",
        label: "GitHub",
        message: "GitHub CLI is not authenticated for this Vibe64 user.",
        status: "not_connected"
      }
    ],
    blockedReason: "GitHub CLI is not authenticated for this Vibe64 user.",
    ok: true,
    ready: false
  };
}

function emptyLaunchTargets() {
  return {
    activeTerminal: null,
    launchTargets: [],
    ok: true,
    openTarget: {
      available: false,
      disabledReason: "No launch targets are available.",
      href: "",
      kind: "url",
      label: "Open browser",
      previewHref: ""
    },
    previewTarget: {
      available: false,
      disabledReason: "No launch targets are available.",
      href: "",
      kind: "url",
      label: "Preview",
      targetHref: ""
    }
  };
}

function setupReadinessReady() {
  return {
    currentStage: null,
    message: "",
    ready: true,
    stages: [
      studioSetupReady(),
      projectSetupReady()
    ]
  };
}

function studioSetupReady() {
  return {
    checks: [
      {
        explanation: "Docker is reachable.",
        expected: "Docker engine is reachable.",
        id: "docker",
        label: "Docker engine",
        observed: "Docker responded.",
        required: true,
        status: "pass"
      }
    ],
    ok: true,
    ready: true
  };
}

function projectSetupReady() {
  return {
    currentStageId: "",
    hardStop: false,
    ok: true,
    ready: true,
    stages: [
      {
        explanation: "The target app has a Git work tree.",
        expected: "A non-bare Git repository exists with a named branch.",
        id: "git-ready",
        label: "Git ready",
        observed: "Branch: main",
        required: true,
        status: "pass"
      },
      {
        explanation: "The target app passes the project verification command.",
        expected: "Project verification passes.",
        id: "ready",
        label: "Ready",
        observed: "All project setup stages passed.",
        required: true,
        status: "pass"
      }
    ],
    targetRoot: PROJECT_ROOT
  };
}

function currentAppReady() {
  return {
    adapter: {
      id: "jskit",
      label: "JSKIT"
    },
    git: {
      branch: "main",
      checked: true,
      dirty: false,
      isRepo: true
    },
    ok: true,
    ready: true,
    rootPath: PROJECT_ROOT
  };
}

function capabilitiesReady() {
  return {
    capabilities: {
      chat: { enabled: true, fix: null, reason: "" },
      createSession: { enabled: true, fix: null, reason: "" },
      githubWorkflow: { enabled: true, fix: null, reason: "" },
      home: { enabled: true, fix: null, reason: "" },
      preview: { enabled: true, fix: null, reason: "" },
      runScripts: { enabled: true, fix: null, reason: "" }
    },
    connections: {
      accounts: accountsReady().accounts,
      ai: {
        message: "Codex is selected and authenticated.",
        providers: [
          {
            ...accountsReady().accounts[0],
            ready: true,
            selected: true
          }
        ],
        ready: true,
        selectedProviderId: "codex"
      },
      github: {
        ...accountsReady().accounts[1],
        ready: true
      },
      ready: true
    },
    ok: true,
    setup: setupReadinessReady(),
    targetRoot: PROJECT_ROOT,
    updatedAt: "2026-06-05T00:00:00.000Z"
  };
}

function emptySessions(sessions: SessionRow[] = []) {
  return {
    creation: {
      canCreate: true,
      defaultWorkflowDefinition: "big_feature",
      disabledReason: "",
      mode: "select",
      requiredWorkflowDefinition: null,
      seedRequired: false,
      workflowDefinitions: [
        {
          description: "Define, plan, implement, review, validate, commit, create a PR, and optionally merge.",
          id: "big_feature",
          label: "Make improvements"
        }
      ]
    },
    limits: {
      maxOpenSessions: 5,
      openSessionCount: sessions.length
    },
    ok: true,
    sessions,
    stepDefinitions: []
  };
}

function sessionPayload(sessionId: string): SessionRow {
  return {
    currentStep: "work_definition",
    metadata: {
      issue_word: "Created session",
      worktree_path: `${PROJECT_ROOT}/.vibe64/sessions/active/${sessionId}/worktree`
    },
    presentation: {
      intents: [],
      screen: {
        kind: "input",
        sections: [],
        title: "Created session"
      },
      terminal: {
        codex: {
          label: "",
          readOnlyInAutopilot: true,
          renderer: "codex_terminal",
          terminalSessionId: "",
          visible: false,
          visibleUntil: ""
        }
      }
    },
    revision: 1,
    sessionId,
    status: "active",
    stepMachine: {
      status: "ready",
      stepId: "work_definition"
    },
    stepRevision: 1,
    workflowDefinition: {
      id: "big_feature",
      label: "Make improvements"
    }
  };
}

function sessionById(sessions: SessionRow[], sessionId: string) {
  return sessions.find((session) => session.sessionId === sessionId) || {
    errors: [
      {
        code: "vibe64_session_not_found",
        message: "Vibe64 session not found."
      }
    ],
    ok: false,
    sessionId
  };
}

async function mockLifecycleSocket(page: Page) {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;

    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.CONNECTING;
      url = "";

      constructor(url: string | URL) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url, window.location.href).pathname;
        if (pathname !== "/api/studio/browser-lifecycle/ws") {
          return new OriginalWebSocket(url);
        }
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              closeBrowserOnDisconnect: false,
              type: "browser-lifecycle-state"
            })
          }));
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json"
  });
}

async function fulfillSse(route: Route, status: unknown, itemsKey = "checks") {
  const items = Array.isArray(status?.[itemsKey]) ? status[itemsKey] : [];
  const events = [
    ["run.started", {}],
    ...items.flatMap((item) => [
      ["check.started", {
        id: item.id,
        label: item.label
      }],
      ["check.finished", {
        check: item,
        id: item.id,
        label: item.label,
        status: item.status
      }]
    ]),
    ["run.finished", {
      status
    }]
  ];

  await route.fulfill({
    body: events
      .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`)
      .join("\n")
      .concat("\n"),
    contentType: "text/event-stream"
  });
}

async function fulfillArtifactReadinessSse(route: Route, sessionId: string) {
  await route.fulfill({
    body: `event: artifact-readiness.updated\ndata: ${JSON.stringify({
      artifactReadiness: {},
      ok: true,
      sessionId
    })}\n\n`,
    contentType: "text/event-stream"
  });
}

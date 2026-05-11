import { expect, test } from "@playwright/test";

const BASE_URL = String(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173").replace(/\/+$/u, "");

const viewports = [
  { name: "compact", width: 390, height: 844 },
  { name: "medium", width: 768, height: 1024 },
  { name: "expanded", width: 1280, height: 900 }
];

const blockedBootstrapPayload = {
  ready: false,
  checks: [
    {
      id: "docker",
      label: "Docker engine",
      status: "pass",
      required: true,
      expected: "Docker engine is reachable.",
      observed: "Docker responded.",
      explanation: "Studio uses Docker for managed local toolchain services."
    },
    {
      id: "mysql-capability",
      label: "MySQL capability",
      status: "fail",
      required: true,
      expected: "Managed MySQL can create and drop a probe database and table.",
      observed: "Probe database is not ready.",
      explanation: "Studio needs a managed MySQL runtime before it can operate on apps that need one.",
      repair: {
        kind: "command",
        actionId: "mysql-capability",
        label: "Repair MySQL",
        commandPreview: "docker compose up -d mysql"
      }
    },
    {
      id: "toolchain-image",
      label: "Managed toolchain image",
      status: "pass",
      required: true,
      expected: "The managed toolchain image exists.",
      observed: "jskit-ai-studio-toolchain:0.1.0",
      explanation: "Node, npm, git, GitHub CLI, and Codex run inside this managed image."
    },
    {
      id: "gh-auth",
      label: "GitHub login",
      status: "fail",
      required: true,
      expected: "GitHub CLI is logged in inside the managed toolchain.",
      observed: "gh auth status failed.",
      explanation: "Studio needs GitHub CLI authentication for repository operations.",
      repair: {
        kind: "terminal",
        actionId: "gh-auth",
        label: "Log in to GitHub",
        commandPreview: "gh auth login"
      }
    },
    {
      id: "codex-auth",
      label: "Codex login",
      status: "fail",
      required: true,
      expected: "Codex CLI is logged in inside the managed toolchain.",
      observed: "Codex is installed but not authenticated.",
      explanation: "Studio needs a local Codex session before it can delegate implementation work.",
      repair: {
        kind: "terminal",
        actionId: "codex-auth",
        label: "Log in to Codex",
        commandPreview: "codex login"
      }
    }
  ]
};

const readyBootstrapPayload = {
  ready: true,
  checks: [
    {
      id: "docker",
      label: "Docker engine",
      status: "pass",
      required: true,
      expected: "Docker engine is reachable.",
      observed: "Docker responded.",
      explanation: "Docker is reachable."
    },
    {
      id: "gh-auth",
      label: "GitHub login",
      status: "pass",
      required: true,
      expected: "GitHub CLI is logged in inside the managed toolchain.",
      observed: "Logged in.",
      explanation: "GH is authenticated inside the managed toolchain."
    },
    {
      id: "codex-auth",
      label: "Codex login",
      status: "pass",
      required: true,
      expected: "Codex login status succeeds inside the managed toolchain.",
      observed: "Logged in.",
      explanation: "Codex is authenticated inside the managed toolchain."
    }
  ]
};

const blockedTargetAppPayload = {
  ready: false,
  studioRoot: "/studio/jskit-ai-studio",
  targetRoot: "/workspace/example-target-app",
  checks: [
    {
      id: "target-directory",
      label: "Target directory",
      status: "pass",
      required: true,
      expected: "Target root exists and is readable/writable by Studio.",
      observed: "/workspace/example-target-app",
      explanation: "Studio can reach the target root without reading app metadata."
    },
    {
      id: "target-identity",
      label: "Target identity",
      status: "pass",
      required: true,
      expected: "Target root and Studio root are separate.",
      observed: "Studio root: /studio/jskit-ai-studio\nTarget root: /workspace/example-target-app",
      explanation: "Studio is pointed at a separate target directory."
    },
    {
      id: "git-repository",
      label: "Git repository",
      status: "fail",
      required: true,
      expected: "Target root is inside a git work tree.",
      observed: "fatal: not a git repository",
      explanation: "Target App Doctor needs a git repository before Studio can create branches, commits, issues, or PRs.",
      repair: {
        kind: "terminal",
        actionId: "terminal-git-init",
        label: "Initialize Git",
        commandPreview: "docker run --rm jskit-ai-studio-toolchain:0.1.0 git init"
      }
    },
    {
      id: "git-identity",
      label: "Git identity",
      status: "fail",
      required: true,
      expected: "Git user.name and user.email are configured.",
      observed: "user.name: missing\nuser.email: missing",
      explanation: "Studio will not write files until commit identity is configured.",
      repair: {
        kind: "terminal",
        actionId: "terminal-git-identity",
        label: "Set Git identity",
        commandPreview: "git config --global user.name \"<name>\"\ngit config --global user.email \"<email>\"",
        fields: [
          {
            id: "name",
            label: "Git user.name",
            placeholder: "Your Name",
            required: true,
            type: "text"
          },
          {
            id: "email",
            label: "Git user.email",
            placeholder: "you@example.com",
            required: true,
            type: "email"
          }
        ]
      }
    },
    {
      id: "github-auth",
      label: "GitHub CLI auth",
      status: "pass",
      required: true,
      expected: "gh is authenticated and can call the GitHub API.",
      observed: "merc",
      explanation: "GitHub CLI can call the GitHub API from the managed toolchain."
    },
    {
      id: "github-repository",
      label: "GitHub repository",
      status: "fail",
      required: true,
      expected: "Target origin resolves to a GitHub repository.",
      observed: "origin remote is not configured.",
      explanation: "Studio can create a GitHub repo for the target after confirmation.",
      repair: {
        kind: "terminal",
        actionId: "terminal-gh-create-repo",
        label: "Create/link GitHub repo",
        commandPreview: "gh repo create example-target-app --source=. --remote=origin --private --push"
      }
    }
  ]
};

const readyTargetAppPayload = {
  ready: true,
  studioRoot: "/studio/jskit-ai-studio",
  targetRoot: "/workspace/example-target-app",
  checks: [
    {
      id: "target-directory",
      label: "Target directory",
      status: "pass",
      required: true,
      expected: "Target root exists and is readable/writable by Studio.",
      observed: "/workspace/example-target-app",
      explanation: "Studio can reach the target root without reading app metadata."
    },
    {
      id: "git-repository",
      label: "Git repository",
      status: "pass",
      required: true,
      expected: "Target root is inside a git work tree.",
      observed: "true",
      explanation: "Git is available for the target app."
    }
  ]
};

const blockedAppSetupPayload = {
  ready: false,
  targetRoot: "/workspace/example-target-app",
  currentStageId: "scaffold",
  hardStop: false,
  stages: [
    {
      id: "directory",
      label: "Directory admissibility",
      status: "pass",
      required: true,
      expected: "Target directory is empty or already a Git repository.",
      observed: ".git directory exists.",
      explanation: "Studio can continue with Git safety checks."
    },
    {
      id: "git-ready",
      label: "Git ready",
      status: "pass",
      required: true,
      expected: "A non-bare Git repository exists with a named branch.",
      observed: "Branch: main",
      explanation: "Git has the minimum local shape Studio needs."
    },
    {
      id: "remote-ready",
      label: "Remote ready",
      status: "pass",
      required: true,
      expected: "origin points at an accessible GitHub repository.",
      observed: "merc/example-target-app",
      explanation: "gh can inspect the repository Studio will use for issues and PRs."
    },
    {
      id: "remote-sync",
      label: "Remote/local sync",
      status: "pass",
      required: true,
      expected: "Local and remote histories are not divergent.",
      observed: "No local commits and remote has no default branch.",
      explanation: "This is a fresh repository pair."
    },
    {
      id: "scaffold",
      label: "Initial JSKIT scaffold",
      status: "blocked",
      required: true,
      expected: "Minimal JSKIT scaffold markers exist.",
      observed: "No scaffold files are present yet.",
      explanation: "Create the smallest JSKIT app scaffold before installing dependencies or running doctor.",
      repair: {
        kind: "terminal",
        actionId: "terminal-scaffold-jskit",
        label: "Create JSKIT scaffold",
        commandPreview: "npx @jskit-ai/create-app example-target-app --target . --tenancy-mode none"
      }
    },
    {
      id: "dependencies",
      label: "Dependencies runnable",
      status: "pending",
      required: true,
      expected: "Node dependencies are installed enough to run JSKIT commands.",
      observed: "Waiting for previous stage.",
      explanation: "This stage runs after the previous required stages pass."
    },
    {
      id: "runtime-services",
      label: "Runtime services",
      status: "pending",
      required: true,
      expected: "Only runtime services required by the target app are reachable.",
      observed: "Waiting for previous stage.",
      explanation: "This stage runs after the previous required stages pass."
    },
    {
      id: "jskit-doctor",
      label: "JSKIT doctor",
      status: "pending",
      required: true,
      expected: "The official JSKIT verification command passes.",
      observed: "Waiting for previous stage.",
      explanation: "This stage runs after the previous required stages pass."
    },
    {
      id: "git-checkpoint",
      label: "Git checkpoint",
      status: "pending",
      required: true,
      expected: "Working tree is clean after setup changes.",
      observed: "Waiting for previous stage.",
      explanation: "This stage runs after the previous required stages pass."
    },
    {
      id: "ready",
      label: "Ready",
      status: "pending",
      required: true,
      expected: "The target app is ready for Studio workflows.",
      observed: "Waiting for previous stage.",
      explanation: "This stage runs after the previous required stages pass."
    }
  ]
};

const readyAppSetupPayload = {
  ready: true,
  targetRoot: "/workspace/example-target-app",
  currentStageId: "",
  hardStop: false,
  stages: [
    {
      id: "directory",
      label: "Directory admissibility",
      status: "pass",
      required: true,
      expected: "Target directory is empty or already a Git repository.",
      observed: ".git directory exists.",
      explanation: "Studio can continue with Git safety checks."
    },
    {
      id: "jskit-doctor",
      label: "JSKIT doctor",
      status: "pass",
      required: true,
      expected: "Official JSKIT verification passes.",
      observed: "Verification passed.",
      explanation: "The target app passes the authoritative JSKIT readiness check."
    },
    {
      id: "git-checkpoint",
      label: "Git checkpoint",
      status: "pass",
      required: true,
      expected: "Working tree is clean after setup changes.",
      observed: "Clean",
      explanation: "Setup changes have been committed or there were no setup changes."
    },
    {
      id: "ready",
      label: "Ready",
      status: "pass",
      required: true,
      expected: "The target app is ready for Studio workflows.",
      observed: "All setup stages passed.",
      explanation: "Studio can now inspect and operate on this app."
    }
  ]
};

const currentAppPayload = {
  rootPath: "/workspace/example-target-app",
  isJskitApp: true,
  packageJson: {
    name: "example-target-app",
    scripts: [
      { name: "dev", command: "vite" }
    ]
  },
  jskitLock: {
    installedPackages: [
      {
        packageId: "@local/main",
        packagePath: "packages/main",
        sourceType: "local",
        version: "0.1.0"
      }
    ]
  },
  config: {
    tenancyMode: "none",
    surfaceDefaultId: "home",
    surfaces: [
      {
        id: "home",
        label: "Home",
        enabled: true,
        requiresAuth: false,
        requiresWorkspace: false,
        pagesRoot: "home"
      }
    ]
  },
  runtimeNeeds: {
    auth: false,
    database: false,
    users: false,
    workspaces: false
  },
  markers: [
    { id: "package-json", label: "package.json", exists: true },
    { id: "jskit-lock", label: ".jskit/lock.json", exists: true }
  ],
  git: {
    checked: true,
    isRepo: true,
    dirty: false,
    branch: "main",
    changedFiles: []
  }
};

function sseStatusPayload(status, itemsKey = "checks") {
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

  return events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`)
    .join("\n");
}

async function fulfillSse(route, status, itemsKey = "checks") {
  await route.fulfill({
    contentType: "text/event-stream",
    body: sseStatusPayload(status, itemsKey)
  });
}

function trackStudioApiRequests(page) {
  const requests: string[] = [];

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/api/studio/")) {
      requests.push(pathname);
    }
  });

  return {
    count(pathname: string) {
      return requests.filter((requestPathname) => requestPathname === pathname).length;
    },
    requests
  };
}

async function mockBootstrapBlocked(page) {
  await page.route("**/api/studio/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(blockedBootstrapPayload)
    });
  });
  await page.route("**/api/studio/bootstrap/stream", async (route) => {
    await fulfillSse(route, blockedBootstrapPayload);
  });
}

async function mockTargetAppBlocked(page) {
  await page.route("**/api/studio/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyBootstrapPayload)
    });
  });
  await page.route("**/api/studio/bootstrap/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/target-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(blockedTargetAppPayload)
    });
  });
  await page.route("**/api/studio/target-app/stream", async (route) => {
    await fulfillSse(route, blockedTargetAppPayload);
  });
}

async function mockStudioReady(page) {
  await page.route("**/api/studio/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyBootstrapPayload)
    });
  });
  await page.route("**/api/studio/bootstrap/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/target-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyTargetAppPayload)
    });
  });
  await page.route("**/api/studio/target-app/stream", async (route) => {
    await fulfillSse(route, readyTargetAppPayload);
  });
  await page.route("**/api/studio/app-setup/stream", async (route) => {
    await fulfillSse(route, readyAppSetupPayload, "stages");
  });
  await page.route("**/api/studio/app-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyAppSetupPayload)
    });
  });
  await page.route("**/api/studio/current-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentAppPayload)
    });
  });
}

async function mockAppSetupBlocked(page) {
  await page.route("**/api/studio/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyBootstrapPayload)
    });
  });
  await page.route("**/api/studio/bootstrap/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/target-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyTargetAppPayload)
    });
  });
  await page.route("**/api/studio/target-app/stream", async (route) => {
    await fulfillSse(route, readyTargetAppPayload);
  });
  await page.route("**/api/studio/app-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(blockedAppSetupPayload)
    });
  });
  await page.route("**/api/studio/app-setup/stream", async (route) => {
    await fulfillSse(route, blockedAppSetupPayload, "stages");
  });
}

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function expectGeneratedScreenContract(page) {
  const screen = page.locator(".generated-ui-screen").first();

  await expect(screen).toBeVisible();
  await expect(screen).toHaveClass(/generated-ui-screen--app/u);
  await expect(screen.locator("h1").first()).toBeVisible();
}

async function expectVisibleTapTargets(page) {
  const targetHeights = await page.locator("a[href], button, [role='button'], .v-btn").evaluateAll(
    (elements) => elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => element.getBoundingClientRect().height)
  );

  for (const height of targetHeights) {
    expect(height).toBeGreaterThanOrEqual(48);
  }
}

test.describe("bootstrap doctor responsive smoke", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} bootup route renders without horizontal overflow`, async ({ page }) => {
      await mockBootstrapBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/bootup`);
      await expect(page.getByRole("heading", { name: "Bootup", exact: true })).toBeVisible();
      await expect(page.getByText("Bootup blocked").first()).toBeVisible();
      await expect(page.getByText("MySQL capability").first()).toBeVisible();
      await expect(page.getByText("Managed toolchain image").first()).toBeVisible();
      await expect(page.getByText("GitHub login").first()).toBeVisible();
      await expect(page.getByText("Codex login").first()).toBeVisible();
      await expect(page.locator(".bootstrap-doctor__status-icon")).toHaveCount(blockedBootstrapPayload.checks.length);
      await expect(page.getByText("Pass", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Fail", { exact: true })).toHaveCount(0);
      const firstFactLine = page.locator(".bootstrap-doctor__fact-line").first();
      await expect(firstFactLine).toContainText("Expected:");
      await expect(firstFactLine).toContainText("Observed:");
      await expectGeneratedScreenContract(page);
      await expectVisibleTapTargets(page);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("target app doctor responsive smoke", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} target gate renders before current app inspection`, async ({ page }) => {
      await mockTargetAppBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/app-bootup`);
      await expect(page.getByRole("heading", { name: "App Bootup", exact: true })).toBeVisible();
      await expect(page.getByText("Target app blocked").first()).toBeVisible();
      await expect(page.getByText("Target directory").first()).toBeVisible();
      await expect(page.getByText("Target identity").first()).toBeVisible();
      await expect(page.getByText("Git repository").first()).toBeVisible();
      await expect(page.getByText("Git identity").first()).toBeVisible();
      await expect(page.getByText("GitHub repository").first()).toBeVisible();
      await expect(page.getByText("Initialize Git").first()).toBeVisible();
      await expect(page.getByText("Set Git identity").first()).toBeVisible();
      await expect(page.getByText("Create/link GitHub repo").first()).toBeVisible();
      await expect(page.locator(".target-app-doctor .bootstrap-doctor__status-icon")).toHaveCount(
        blockedTargetAppPayload.checks.length
      );
      await expect(page.getByRole("heading", { name: "Home" })).toHaveCount(0);
      const firstFactLine = page.locator(".target-app-doctor .bootstrap-doctor__fact-line").first();
      await expect(firstFactLine).toContainText("Expected:");
      await expect(firstFactLine).toContainText("Observed:");
      await page.getByRole("button", { name: "Set Git identity" }).click();
      await expect(page.getByLabel("Git user.name")).toBeVisible();
      await expect(page.getByLabel("Git user.email")).toBeVisible();
      await expect(page.getByRole("button", { name: "Run repair" })).toBeDisabled();
      await page.getByLabel("Git user.name").fill("Ada Lovelace");
      await page.getByLabel("Git user.email").fill("ada@example.com");
      await expect(page.getByRole("button", { name: "Run repair" })).toBeEnabled();
      await expect(page.locator(".studio-screen__dialog .bootstrap-doctor__command")).toContainText("Ada Lovelace");
      const repairDialog = page.getByRole("dialog");
      await repairDialog.getByRole("button", { name: "Close" }).click();
      await expect(repairDialog).toBeHidden();
      await expectGeneratedScreenContract(page);
      await expectVisibleTapTargets(page);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("app setup doctor responsive smoke", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} app setup gate renders sequential stages`, async ({ page }) => {
      await mockAppSetupBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/app-setup`);
      await expect(page.getByRole("heading", { name: "App Setup", exact: true })).toBeVisible();
      await expect(page.getByText("App setup blocked").first()).toBeVisible();
      await expect(page.getByText("Directory admissibility").first()).toBeVisible();
      await expect(page.getByText("Remote/local sync").first()).toBeVisible();
      await expect(page.getByText("Initial JSKIT scaffold").first()).toBeVisible();
      await expect(page.getByText("Dependencies runnable").first()).toBeVisible();
      await expect(page.getByText("JSKIT doctor").first()).toBeVisible();
      await expect(page.getByText("Git checkpoint").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Create JSKIT scaffold" })).toBeVisible();
      await expect(page.locator(".app-setup-doctor .bootstrap-doctor__status-icon")).toHaveCount(
        blockedAppSetupPayload.stages.length
      );
      const scaffoldFactLine = page.locator(".app-setup-doctor .bootstrap-doctor__fact-line").nth(4);
      await expect(scaffoldFactLine).toContainText("Expected:");
      await expect(scaffoldFactLine).toContainText("Observed:");
      await expectGeneratedScreenContract(page);
      await expectVisibleTapTargets(page);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("studio gate redirects", () => {
  test("root redirects to bootup when machine bootup is blocked", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockBootstrapBlocked(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveURL(/\/bootup$/u);
    await expect(page.getByRole("heading", { name: "Bootup", exact: true })).toBeVisible();
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(1);
    expect(apiRequests.count("/api/studio/bootstrap/stream")).toBe(0);
  });

  test("home redirects to app bootup when target app bootup is blocked", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockTargetAppBlocked(page);
    await page.goto(`${BASE_URL}/home`);
    await expect(page).toHaveURL(/\/app-bootup$/u);
    await expect(page.getByRole("heading", { name: "App Bootup", exact: true })).toBeVisible();
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(1);
    expect(apiRequests.count("/api/studio/target-app")).toBe(1);
    expect(apiRequests.count("/api/studio/target-app/stream")).toBe(0);
  });

  test("home redirects to app setup when setup is blocked", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockAppSetupBlocked(page);
    await page.goto(`${BASE_URL}/home`);
    await expect(page).toHaveURL(/\/app-setup$/u);
    await expect(page.getByRole("heading", { name: "App Setup", exact: true })).toBeVisible();
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(1);
    expect(apiRequests.count("/api/studio/target-app")).toBe(1);
    expect(apiRequests.count("/api/studio/app-setup")).toBe(1);
    expect(apiRequests.count("/api/studio/app-setup/stream")).toBe(0);
  });

  test("root redirects to home when every bootup gate is ready", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveURL(/\/home$/u);
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(page.getByText("example-target-app").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(1);
    expect(apiRequests.count("/api/studio/target-app")).toBe(1);
    expect(apiRequests.count("/api/studio/app-setup")).toBe(1);
    expect(apiRequests.count("/api/studio/current-app")).toBe(1);
  });

  test("direct app bootup runs the target app doctor stream once", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockTargetAppBlocked(page);
    await page.goto(`${BASE_URL}/app-bootup`);
    await expect(page.getByRole("heading", { name: "App Bootup", exact: true })).toBeVisible();
    await expect(page.getByText("Target app blocked").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(1);
    expect(apiRequests.count("/api/studio/target-app")).toBe(0);
    expect(apiRequests.count("/api/studio/target-app/stream")).toBe(1);
  });

  test("direct app setup runs the app setup doctor stream once", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockAppSetupBlocked(page);
    await page.goto(`${BASE_URL}/app-setup`);
    await expect(page.getByRole("heading", { name: "App Setup", exact: true })).toBeVisible();
    await expect(page.getByText("App setup blocked").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(1);
    expect(apiRequests.count("/api/studio/target-app")).toBe(1);
    expect(apiRequests.count("/api/studio/app-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/app-setup/stream")).toBe(1);
  });
});

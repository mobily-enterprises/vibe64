const PLAYWRIGHT_PORT = String(process.env.PLAYWRIGHT_PORT || "5173").trim() || "5173";
const DEFAULT_BASE_URL = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;
const BASE_URL = String(process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/u, "");

const viewports = [
  { name: "compact", width: 390, height: 844 },
  { name: "medium", width: 768, height: 1024 },
  { name: "expanded", width: 1280, height: 900 }
];

const targetRoot = "/workspace/example-target-app";
const savedProjectConfigValues = {
  github_pr_merge_method: "merge",
  jskit_database_runtime: "none"
};

const bootstrapPayload = {
  app: {
    features: {
      assistantEnabled: false,
      assistantRequiredPermission: "",
      socialEnabled: false,
      socialFederationEnabled: false
    }
  },
  profile: null,
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

const readyProjectTypePayload = {
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
    path: `${targetRoot}/.ai-studio/project_type`,
    projectType: "jskit",
    ready: true,
    status: "ready",
    targetRoot
  }
};

const readyProjectConfigPayload = {
  config: {
    adapter: {
      id: "jskit",
      label: "JSKIT target adapter"
    },
    configRoot: `${targetRoot}/.ai-studio/config`,
    defaults: savedProjectConfigValues,
    fields: [],
    fieldValues: Object.fromEntries(
      Object.entries(savedProjectConfigValues).map(([fieldId, value]) => [
        fieldId,
        {
          defaultValue: value,
          filePath: `${targetRoot}/.ai-studio/config/${fieldId}`,
          invalid: null,
          saved: true,
          value
        }
      ])
    ),
    helperPath: `${targetRoot}/.ai-studio/runtime/ai-studio-config.sh`,
    invalid: [],
    message: "",
    missing: [],
    projectType: "jskit",
    ready: true,
    runtimeRoot: `${targetRoot}/.ai-studio/runtime`,
    sections: [],
    values: savedProjectConfigValues
  },
  ok: true
};

const readyAccountsPayload = {
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
      label: "Seed JSKIT app",
      status: "blocked",
      required: true,
      expected: "Minimal JSKIT scaffold markers exist.",
      observed: "No scaffold files are present yet.",
      explanation: "Seed this target with the selected JSKIT configuration before installing dependencies or checking runtime readiness.",
      repair: {
        kind: "terminal",
        actionId: "terminal-scaffold-jskit",
        label: "Seed this project",
        commandPreview: "npx @jskit-ai/create-app example-target-app --target . --force --tenancy-mode none --title \"Example Target App\" --initial-bundles none"
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
  rootPath: targetRoot,
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
        label: "Sessions",
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

const targetScriptsPayload = {
  ok: true,
  config: {
    exists: false,
    path: ".ai-studio/config/starred_scripts"
  },
  starredScriptIds: ["jskit:update", "build", "server", "verify"],
  scripts: [
    { id: "build", name: "build", label: "build", command: "vite build", source: "project", starred: true },
    { id: "dev", name: "dev", label: "dev", command: "vite", source: "project", starred: false },
    { id: "jskit:update", name: "jskit:update", label: "jskit:update", command: "jskit app update-packages", source: "project", starred: true },
    { id: "lint", name: "lint", label: "lint", command: "eslint .", source: "project", starred: false },
    { id: "preview", name: "preview", label: "preview", command: "vite preview", source: "project", starred: false },
    { id: "server", name: "server", label: "server", command: "node server.js", source: "project", starred: true },
    { id: "test", name: "test", label: "test", command: "node --test", source: "project", starred: false },
    { id: "verify", name: "verify", label: "verify", command: "jskit app verify", source: "project", starred: true }
  ]
};

const completedArchiveSession = {
  sessionId: "2026-05-12_03-10-00",
  status: "finished",
  branch: "issue-2-session-history",
  issueUrl: "https://github.com/merc/example-target-app/issues/2",
  prUrl: "https://github.com/merc/example-target-app/pull/12",
  completedSteps: ["issue_created", "plan_made", "plan_executed"],
  finalReportText: "Completed archive report."
};

const abandonedArchiveSession = {
  sessionId: "2026-05-12_03-11-00",
  status: "abandoned",
  branch: "issue-2-abandoned-session",
  issueUrl: "https://github.com/merc/example-target-app/issues/2",
  completedSteps: ["issue_created", "plan_made"]
};

export {
  BASE_URL,
  viewports,
  bootstrapPayload,
  readyAccountsPayload,
  readyProjectConfigPayload,
  readyProjectTypePayload,
  blockedBootstrapPayload,
  readyBootstrapPayload,
  blockedTargetAppPayload,
  readyTargetAppPayload,
  blockedAppSetupPayload,
  readyAppSetupPayload,
  currentAppPayload,
  targetScriptsPayload,
  completedArchiveSession,
  abandonedArchiveSession
};
export {
  codexPromptText,
  codexPlanPromptText,
  codexPromptSessionId,
  secondCodexPromptText,
  secondCodexPromptSessionId,
  thirdCodexPromptText,
  thirdCodexPromptSessionId,
  nonCodexStepSessionId,
  sessionWorktreePath,
  codexThreadProbe,
  codexThreadCommand,
  codexThreadId,
  codexShellSubmitSequence,
  codexPromptSignature,
  codexPromptStepDefinitions,
  codexPromptSessionPayload,
  secondCodexPromptSessionPayload,
  thirdCodexPromptSessionPayload,
  nonCodexStepSessionPayload,
  codexIssueDraftedPayload,
  codexIssueCreatedPayload,
  codexPlanPromptPayload,
  deepUiSkipSessionId,
  deepUiPromptSessionId,
  deepUiSkipStepDefinitions,
  deepUiSkipSessionPayload,
  deepUiSkippedSessionPayload,
  deepUiPromptedSessionPayload,
  planExecutionRejectSessionId,
  planExecutionRejectStepDefinitions,
  planExecutionRejectPayload,
  reviewDeslopSessionId,
  reviewDeslopStepDefinitions,
  reviewDeslopAcceptedPayload,
  reviewDeslopNextPromptPayload,
  reviewDeslopUnexpectedAdvancedPayload
} from './base-shell/codex-data';

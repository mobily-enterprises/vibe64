const PLAYWRIGHT_PORT = String(process.env.PLAYWRIGHT_PORT || "5173").trim() || "5173";
const DEFAULT_BASE_URL = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;
const BASE_URL = String(process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/u, "");
const WORKSPACE_SLUG = "example-target-app";
const DEVELOPMENT_PATH = `/app/project/${WORKSPACE_SLUG}`;
const DASHBOARD_PATH = `${DEVELOPMENT_PATH}/dashboard`;
const SCOPED_API_PREFIX = `/api/app/${WORKSPACE_SLUG}`;

const viewports = [
  { name: "compact", width: 390, height: 844 },
  { name: "medium", width: 768, height: 1024 },
  { name: "expanded", width: 1280, height: 900 }
];

const targetRoot = "/workspace/example-target-app";
const projectRuntimeRoot = "/workspace/vibe64-local-editor/state/projects/example-target-app-test";
const sessionRuntimeRoot = (sessionId: string) =>
  `${projectRuntimeRoot}/sessions/active/${sessionId}`;
const savedProjectConfigValues = {
  jskit_database_runtime: "none"
};

const readyProjectSelectionPayload = {
  ok: true,
  currentProject: {
    external: false,
    name: "example-target-app",
    path: targetRoot,
    selected: true,
    slug: "example-target-app",
    source: "workspace"
  },
  hasSelection: true,
  projects: [
    {
      external: false,
      name: "example-target-app",
      path: targetRoot,
      selected: true,
      slug: "example-target-app",
      source: "workspace"
    }
  ],
  projectsRoot: "/workspace/vibe64",
  targetRoot
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
    path: `${targetRoot}/vibe64.project.json`,
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
    configRoot: `${targetRoot}/vibe64.project.json`,
    defaults: savedProjectConfigValues,
    fields: [],
    fieldValues: Object.fromEntries(
      Object.entries(savedProjectConfigValues).map(([fieldId, value]) => [
        fieldId,
        {
          defaultValue: value,
          filePath: `${targetRoot}/vibe64.project.json`,
          invalid: null,
          saved: true,
          value
        }
      ])
    ),
    helperPath: `${targetRoot}//vibe64-config.sh`,
    invalid: [],
    message: "",
    missing: [],
    projectType: "jskit",
    ready: true,
    runtimeRoot: `${targetRoot}/`,
    sections: [],
    values: savedProjectConfigValues
  },
  ok: true
};

const readyConnectionsPayload = {
  connections: [
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

const blockedConnectionsPayload = {
  connections: [
    {
      connected: false,
      id: "codex",
      label: "Codex",
      message: "Codex is not authenticated for Studio.",
      status: "missing"
    },
    {
      connected: false,
      id: "github",
      label: "GitHub",
      message: "GitHub CLI is not authenticated for Studio.",
      status: "missing"
    }
  ],
  message: "Connect Codex and GitHub before using Studio project actions.",
  ok: true,
  ready: false
};

const blockedBootstrapPayload = {
  ready: false,
  checks: [
    {
      id: "node",
      label: "Node.js",
      status: "pass",
      required: true,
      expected: "Node.js is installed on the host.",
      observed: "v22.23.1",
      explanation: "Studio uses Node.js for JavaScript and TypeScript project setup, scripts, and framework CLIs."
    },
    {
      id: "gh-auth",
      label: "GitHub login",
      status: "fail",
      required: true,
      expected: "GitHub CLI is authenticated for this OS user.",
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
      expected: "Codex CLI is authenticated for this OS user.",
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
      id: "node",
      label: "Node.js",
      status: "pass",
      required: true,
      expected: "Node.js is installed on the host.",
      observed: "v22.23.1",
      explanation: "Node.js is available on the host."
    },
    {
      id: "gh-auth",
      label: "GitHub login",
      status: "pass",
      required: true,
      expected: "GitHub CLI is authenticated for this OS user.",
      observed: "Logged in.",
      explanation: "GH is authenticated for this OS user."
    },
    {
      id: "codex-auth",
      label: "Codex login",
      status: "pass",
      required: true,
      expected: "Codex login status succeeds for this OS user.",
      observed: "Logged in.",
      explanation: "Codex is authenticated for this OS user."
    }
  ]
};

const blockedTargetAppPayload = {
  ready: false,
  studioRoot: "/studio/jskit-vibe64",
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
      observed: "Studio root: /studio/jskit-vibe64\nTarget root: /workspace/example-target-app",
      explanation: "Studio is pointed at a separate target directory."
    },
    {
      id: "git-repository",
      label: "Git repository",
      status: "fail",
      required: true,
      expected: "Target root is inside a git work tree.",
      observed: "fatal: not a git repository",
      explanation: "Target App Doctor needs a git repository before Studio can create branches, commits, or local sessions.",
      repair: {
        kind: "terminal",
        actionId: "terminal-git-init",
        label: "Initialize Git",
        commandPreview: "git init"
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
    }
  ]
};

const readyTargetAppPayload = {
  ready: true,
  studioRoot: "/studio/jskit-vibe64",
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
      expected: "A local checkpoint commit exists.",
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
    path: "runtime-config/current-app/starred_scripts"
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
  completedSteps: ["issue_created", "plan_and_execute"],
  finalReportText: "Completed archive report."
};

const abandonedArchiveSession = {
  sessionId: "2026-05-12_03-11-00",
  status: "abandoned",
  branch: "issue-2-abandoned-session",
  issueUrl: "https://github.com/merc/example-target-app/issues/2",
  completedSteps: ["issue_created"]
};

export {
  BASE_URL,
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  SCOPED_API_PREFIX,
  WORKSPACE_SLUG,
  projectRuntimeRoot,
  sessionRuntimeRoot,
  targetRoot,
  viewports,
  readyProjectSelectionPayload,
  bootstrapPayload,
  blockedConnectionsPayload,
  readyConnectionsPayload,
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
  sessionSourcePath,
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

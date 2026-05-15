import { expect, test } from "@playwright/test";
import { buildIssueSessionCodexPromptSignature } from "../../src/lib/issueSessionPromptAutomation.js";

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

const npmScriptsPayload = {
  ok: true,
  config: {
    exists: false,
    path: ".jskit/config/starred_npm_scripts",
    source: "default"
  },
  defaultStarredScriptNames: ["jskit:update", "devlinks", "build", "server", "verify"],
  starredScriptNames: ["jskit:update", "devlinks", "build", "server", "verify"],
  scripts: [
    { name: "build", command: "vite build", starred: true },
    { name: "dev", command: "vite", starred: false },
    { name: "devlinks", command: "jskit app link-local-packages", starred: true },
    { name: "jskit:update", command: "jskit app update-packages", starred: true },
    { name: "lint", command: "eslint .", starred: false },
    { name: "preview", command: "vite preview", starred: false },
    { name: "server", command: "node server.js", starred: true },
    { name: "test", command: "node --test", starred: false },
    { name: "verify", command: "jskit app verify", starred: true }
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
  completedSteps: ["issue_created", "plan_made"],
  agentDecisionsLatest: "Abandoned archive decision."
};

const codexPromptText = "Create the GitHub issue for the requested Studio session UI.";
const codexPlanPromptText = "Create an implementation plan for the approved GitHub issue.";
const codexPromptSessionId = "2026-05-12_01-02-39";
const secondCodexPromptText = "Create another GitHub issue while the first terminal keeps running.";
const secondCodexPromptSessionId = "2026-05-12_01-03-40";
const thirdCodexPromptText = "Create a third GitHub issue while two terminals keep running.";
const thirdCodexPromptSessionId = "2026-05-12_01-04-41";
const nonCodexStepSessionId = "2026-05-12_01-05-42";
const sessionWorktreePath = (sessionId: string) =>
  `/workspace/example-target-app/.jskit/sessions/active/${sessionId}/worktree`;
const codexThreadProbe = "! echo $CODEX_THREAD_ID";
const codexThreadCommand = "echo $CODEX_THREAD_ID";
const codexThreadId = "019e1575-2458-7b93-bf9d-e7d7ffd49ad2";
const codexShellSubmitSequence = ["\u001b", "\u0015", "! ", codexThreadCommand, " ", "\u001b", "\r"];
function codexPromptSignature(session) {
  return buildIssueSessionCodexPromptSignature({
    activeCycle: session?.activeCycle || "",
    currentReviewPass: session?.currentReviewPass || "",
    prompt: session?.prompt || "",
    sessionId: session?.sessionId || ""
  });
}

const codexPromptStepDefinitions = [
  {
    id: "session-created",
    index: 0,
    label: "Session created",
    kind: "system",
    description: "Create the durable session directory."
  },
  {
    id: "worktree",
    index: 1,
    label: "Worktree",
    kind: "command",
    description: "Prepare the isolated session worktree."
  },
  {
    id: "prompt",
    index: 2,
    label: "Prompt",
    kind: "input",
    description: "Capture the developer request."
  },
  {
    id: "issue",
    index: 3,
    label: "Issue",
    kind: "codex_output",
    description: "Ask Codex to create the GitHub issue."
  },
  {
    id: "issue-created",
    index: 4,
    label: "Issue created",
    kind: "automatic",
    description: "Create the GitHub issue."
  },
  {
    id: "plan_made",
    index: 5,
    label: "Plan made",
    kind: "codex_output",
    description: "Ask Codex to create an implementation plan."
  }
];
const codexPromptSessionPayload = {
  ok: true,
  sessionId: codexPromptSessionId,
  status: "waiting_for_user",
  currentStep: "issue",
  completedSteps: ["session-created", "worktree", "dependencies_installed", "prompt"],
  stepDefinitions: codexPromptStepDefinitions,
  currentStepAction: {
    stepId: "issue",
    kind: "codex_output",
    automation: { mode: "codex_output_prompt" },
    buttonLabel: "Finalise issue",
    description: "Codex should create the issue and return the issue URL.",
    input: {
      fields: [
        {
          extract: "issue_title",
          formatHint: "text",
          type: "text",
          name: "issueTitle",
          label: "Issue title",
          required: true
        },
        {
          extract: "issue_text",
          formatHint: "markdown",
          multiline: true,
          type: "text",
          name: "issue",
          label: "Issue body",
          required: true
        }
      ],
      type: "object"
    }
  },
  codex: {
    mode: "inject_prompt",
    promptField: "prompt",
    responseContract: {
      fields: [
        {
          extract: "issue_title",
          field: "issueTitle",
          formatHint: "text",
          label: "Issue title",
          required: true
        },
        {
          extract: "issue_text",
          field: "issue",
          formatHint: "markdown",
          label: "Issue body",
          multiline: true,
          required: true
        }
      ],
      kind: "fields",
      missingMarkerBehavior: "manual_or_resend",
      required: true
    }
  },
  prompt: codexPromptText,
  receipts: [],
  issueTitle: "",
  issueText: "",
  errors: [],
  issueUrl: "",
  prUrl: "",
  transcriptLog: "",
  worktree: sessionWorktreePath(codexPromptSessionId),
  worktreeReady: true
};
const secondCodexPromptSessionPayload = {
  ...codexPromptSessionPayload,
  sessionId: secondCodexPromptSessionId,
  prompt: secondCodexPromptText,
  worktree: sessionWorktreePath(secondCodexPromptSessionId)
};
const thirdCodexPromptSessionPayload = {
  ...codexPromptSessionPayload,
  sessionId: thirdCodexPromptSessionId,
  prompt: thirdCodexPromptText,
  worktree: sessionWorktreePath(thirdCodexPromptSessionId)
};
const nonCodexStepSessionPayload = {
  ...codexPromptSessionPayload,
  sessionId: nonCodexStepSessionId,
  currentStep: "prompt",
  completedSteps: ["session-created", "worktree", "dependencies_installed"],
  currentStepAction: {
    stepId: "prompt",
    kind: "input",
    buttonLabel: "Save prompt",
    description: "Capture the developer request.",
    input: {
      type: "text",
      name: "prompt",
      label: "Request",
      multiline: true,
      required: true
    }
  },
  codex: null,
  prompt: "",
  worktree: sessionWorktreePath(nonCodexStepSessionId)
};
const codexIssueDraftedPayload = {
  ...codexPromptSessionPayload,
  completedSteps: [...codexPromptSessionPayload.completedSteps, "issue"],
  codex: null,
  currentStep: "issue-created",
  currentStepAction: {
    stepId: "issue-created",
    kind: "automatic",
    automation: { mode: "immediate" },
    buttonLabel: "Create issue",
    description: "Create the GitHub issue with gh.",
    input: {
      type: "none"
    },
    requiresExplicitRun: false
  },
  issueTitle: "Add session UI",
  issueText: "Make sessions clearer.",
  prompt: "",
  status: "running"
};
const codexIssueCreatedPayload = {
  ...codexIssueDraftedPayload,
  completedSteps: [...codexIssueDraftedPayload.completedSteps, "issue-created"],
  currentStep: "plan_made",
  currentStepAction: {
    stepId: "plan_made",
    kind: "codex_output",
    automation: { mode: "codex_output_prompt" },
    buttonLabel: "Save plan",
    description: "Save the approved implementation plan.",
    input: {
      extract: "plan",
      formatHint: "markdown",
      label: "Approved plan",
      multiline: true,
      name: "plan",
      required: true,
      type: "text"
    }
  },
  codex: {
    mode: "inject_prompt",
    promptActionLabel: "Get Codex to create plan",
    promptIntroText: "Codex will create an implementation plan based on the issue.",
    promptField: "prompt",
    responseContract: {
      fields: [
        {
          extract: "plan",
          field: "plan",
          formatHint: "markdown",
          label: "Plan",
          multiline: true,
          required: true
        }
      ],
      kind: "fields",
      missingMarkerBehavior: "manual_or_resend",
      required: true
    }
  },
  issueUrl: "https://github.com/merc/example-target-app/issues/123",
  status: "running"
};
const codexPlanPromptPayload = {
  ...codexIssueCreatedPayload,
  prompt: codexPlanPromptText,
  status: "waiting_for_user"
};
const deepUiSkipSessionId = "2026-05-12_02-06-43";
const deepUiPromptSessionId = "2026-05-12_02-06-44";
const deepUiSkipStepDefinitions = [
  {
    id: "deep_ui_check_run",
    index: 12,
    label: "Deep UI check run",
    kind: "codex_prompt",
    description: "Run or skip the focused UI quality pass before review."
  },
  {
    id: "review_prompt_rendered",
    index: 13,
    displayGroupId: "review_deslop",
    displayGroupLabel: "Review/deslop",
    label: "Review/deslop",
    kind: "codex_prompt",
    description: "Start the review pass."
  },
  {
    id: "automated_checks_run",
    index: 14,
    label: "Automated checks",
    kind: "codex_prompt",
    description: "Run checks after review/deslop."
  }
];
const deepUiSkipSessionPayload = {
  ok: true,
  sessionId: deepUiSkipSessionId,
  status: "running",
  currentStep: "deep_ui_check_run",
  completedSteps: [],
  stepDefinitions: deepUiSkipStepDefinitions,
  currentStepAction: {
    buttonLabel: "Run Deep UI check",
    conditional: true,
    description: "Run or skip the focused UI quality pass before review.",
    input: {
      type: "none"
    },
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    label: "Run Deep UI check",
    requiresExplicitRun: false,
    skipReason: "uiImpact is none.",
    stepId: "deep_ui_check_run"
  },
  codex: null,
  prompt: "",
  receipts: [],
  issueTitle: "Add health endpoint",
  issueText: "Add a server-only health endpoint.",
  issueUrl: "https://github.com/merc/example-target-app/issues/124",
  planText: "Add the endpoint.",
  errors: [],
  prUrl: "",
  transcriptLog: "",
  uiChecks: [],
  worktree: sessionWorktreePath(deepUiSkipSessionId),
  worktreeReady: true
};
const deepUiSkippedSessionPayload = {
  ...deepUiSkipSessionPayload,
  currentStep: "review_prompt_rendered",
  completedSteps: [
    ...deepUiSkipSessionPayload.completedSteps,
    "deep_ui_check_run"
  ],
  currentStepAction: {
    buttonLabel: "Run deslop",
    description: "Start the review pass.",
    input: {
      type: "none"
    },
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    label: "Run deslop",
    requiresExplicitRun: false,
    stepId: "review_prompt_rendered"
  },
  uiChecks: [
    {
      ok: true,
      phase: "pre_review",
      reason: "uiImpact is none.",
      status: "skipped",
      stepId: "deep_ui_check_run",
      uiImpact: "none"
    }
  ]
};
const deepUiPromptedSessionPayload = {
  ...deepUiSkipSessionPayload,
  sessionId: deepUiPromptSessionId,
  codex: {
    autoInject: true,
    mode: "inject_prompt",
    promptActionLabel: "Run Deep UI check",
    promptField: "prompt"
  },
  completedSteps: [
    "session_created",
    "worktree_created",
    "dependencies_installed",
    "issue_prompt_rendered",
    "issue_drafted",
    "issue_created",
    "issue_details_gathered",
    "plan_made",
    "plan_executed"
  ],
  currentStepAction: {
    ...deepUiSkipSessionPayload.currentStepAction,
    buttonLabel: "Go to next step",
    skipReason: ""
  },
  prompt: "Deep UI quality check prompt for this session.",
  uiImpact: "definite",
  worktree: sessionWorktreePath(deepUiPromptSessionId)
};
const planExecutionRejectSessionId = "2026-05-12_02-06-46";
const planExecutionRejectStepDefinitions = [
  {
    id: "plan_made",
    index: 8,
    label: "Plan made",
    kind: "codex_output",
    description: "Codex writes an implementation plan from the issue."
  },
  {
    id: "plan_executed",
    index: 9,
    label: "Plan executed",
    kind: "codex_prompt",
    description: "Codex has the execution prompt. Studio advances when Codex finishes."
  },
  {
    id: "deep_ui_check_run",
    index: 10,
    label: "Deep UI check run",
    kind: "codex_prompt",
    description: "Run or skip the focused UI quality pass before review."
  }
];
const planExecutionRejectPayload = {
  ok: true,
  sessionId: planExecutionRejectSessionId,
  status: "running",
  currentStep: "plan_executed",
  completedSteps: [
    "session_created",
    "worktree_created",
    "dependencies_installed",
    "issue_prompt_rendered",
    "issue_drafted",
    "issue_created",
    "issue_details_gathered",
    "plan_made"
  ],
  stepDefinitions: planExecutionRejectStepDefinitions,
  currentStepAction: {
    buttonLabel: "Go to next step",
    description: "Codex has the execution prompt. Review the result, then use Go to next step when ready.",
    input: { type: "none" },
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    label: "Go to next step",
    requiresExplicitRun: false,
    stepId: "plan_executed"
  },
  codex: {
    autoInject: true,
    mode: "inject_prompt",
    promptActionLabel: "Get Codex to execute plan",
    promptField: "prompt",
    responseContract: {
      completionBehavior: "manual_advance",
      kind: "completion_marker",
      marker: "jskit_step_result",
      missingMarkerBehavior: "resend",
      required: true,
      stepField: "step"
    }
  },
  prompt: [
    "Execute the approved implementation plan.",
    "",
    "[jskit_step_result]",
    "status: complete",
    "step: plan_executed",
    "summary: Short summary of what changed and what was checked.",
    "[/jskit_step_result]"
  ].join("\n"),
  errors: [],
  issueTitle: "Add victory file",
  issueText: "Add a victory file.",
  issueUrl: "https://github.com/merc/example-target-app/issues/127",
  prUrl: "",
  transcriptLog: "",
  worktree: sessionWorktreePath(planExecutionRejectSessionId),
  worktreeReady: true
};
const reviewDeslopSessionId = "2026-05-12_02-06-45";
const reviewDeslopStepDefinitions = [
  {
    id: "review_prompt_rendered",
    index: 13,
    displayGroupId: "review_deslop",
    displayGroupLabel: "Review/deslop",
    label: "Review/deslop",
    kind: "codex_prompt",
    description: "Run the review/deslop pass."
  },
  {
    id: "review_changes_accepted",
    index: 14,
    displayGroupId: "review_deslop",
    displayGroupLabel: "Review/deslop",
    label: "Review/deslop",
    kind: "user_check",
    description: "Accept a review/deslop pass or request another one.",
    submitOptions: {
      reviewFindingsRemaining: false
    }
  },
  {
    id: "automated_checks_run",
    index: 15,
    label: "Automated checks",
    kind: "codex_prompt",
    description: "Run checks after review/deslop."
  }
];
const reviewDeslopAcceptedPayload = {
  ok: true,
  sessionId: reviewDeslopSessionId,
  status: "running",
  currentStep: "review_changes_accepted",
  completedSteps: ["review_prompt_rendered"],
  stepDefinitions: reviewDeslopStepDefinitions,
  currentStepAction: {
    buttonLabel: "I am done",
    description: "Accept a review/deslop pass or request another one.",
    input: { type: "none" },
    kind: "user_check",
    label: "I am done",
    requiresExplicitRun: false,
    submitOptions: {
      reviewFindingsRemaining: false
    },
    stepId: "review_changes_accepted",
    utilityActions: [
      {
        id: "session_diff",
        kind: "diff",
        label: "Review changes"
      }
    ]
  },
  codex: null,
  prompt: "",
  reviewPasses: [
    {
      commit: "",
      maxPasses: 0,
      pass: "001",
      status: "accepted"
    }
  ],
  issueTitle: "Clean up UI",
  issueText: "Run a review/deslop pass.",
  issueUrl: "https://github.com/merc/example-target-app/issues/126",
  errors: [],
  prUrl: "",
  transcriptLog: "",
  worktree: sessionWorktreePath(reviewDeslopSessionId),
  worktreeReady: true
};
const reviewDeslopNextPromptPayload = {
  ...reviewDeslopAcceptedPayload,
  currentStep: "review_prompt_rendered",
  completedSteps: ["review_prompt_rendered", "review_changes_accepted"],
  currentStepAction: {
    buttonLabel: "Run deslop",
    description: "Run the review/deslop pass.",
    input: { type: "none" },
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    label: "Run deslop",
    requiresExplicitRun: false,
    stepId: "review_prompt_rendered"
  },
  reviewPasses: [
    ...reviewDeslopAcceptedPayload.reviewPasses,
    {
      maxPasses: 0,
      pass: "002",
      status: "pending"
    }
  ]
};
const reviewDeslopUnexpectedAdvancedPayload = {
  ...reviewDeslopNextPromptPayload,
  currentStep: "automated_checks_run",
  currentStepAction: {
    buttonLabel: "Run automated checks",
    input: { type: "none" },
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    label: "Run automated checks",
    stepId: "automated_checks_run"
  }
};
const userCheckSessionId = "2026-05-12_03-07-44";
const userCheckStepDefinitions = [
  {
    id: "user_check_completed",
    index: 21,
    label: "User check",
    kind: "user_check",
    description: "Record whether the user's manual check passed."
  },
  {
    id: "plan_made",
    index: 7,
    label: "Plan made",
    kind: "codex_output",
    description: "Codex writes an implementation plan for the active cycle; cycle 001 plans from the issue, later cycles plan from user rework notes."
  }
];
const userCheckAction = {
  alternateActions: [],
  buttonLabel: "Save user check",
  description: "Record whether the user's manual check passed.",
  input: {
    label: "User check result",
    name: "userCheck",
    options: [
      { label: "Passed", value: "passed" },
      { label: "Failed", value: "failed" }
    ],
    required: true,
    type: "choice"
  },
  kind: "user_check",
  label: "Save user check",
  requiresExplicitRun: false,
  stepId: "user_check_completed",
  utilityActions: [
    {
      id: "session_app_test",
      kind: "app_test",
      label: "Test app"
    }
  ]
};
const userCheckSessionPayload = {
  ok: true,
  sessionId: userCheckSessionId,
  status: "running",
  currentStep: "user_check_completed",
  completedSteps: ["session_created"],
  stepDefinitions: userCheckStepDefinitions,
  currentStepAction: userCheckAction,
  codex: null,
  prompt: "",
  receipts: [],
  issueTitle: "Add health endpoint",
  issueText: "Add a server-only health endpoint.",
  issueUrl: "https://github.com/merc/example-target-app/issues/125",
  planText: "Add the endpoint.",
  errors: [],
  prUrl: "",
  transcriptLog: "",
  worktree: sessionWorktreePath(userCheckSessionId),
  worktreeReady: false
};
const failedUserCheckSessionPayload = {
  ...userCheckSessionPayload,
  ok: false,
  status: "blocked",
  errors: [
    {
      code: "user_check_failed",
      message: "User check failed. Provide rework notes to start a new plan cycle.",
      repairCommand: `jskit session ${userCheckSessionId} step --user-check failed --rework-notes -`
    }
  ],
  currentStepAction: {
    ...userCheckAction,
    alternateActions: [
      {
        id: "return_to_plan_made",
        input: {
          formatHint: "markdown",
          label: "What needs to be reworked?",
          multiline: true,
          name: "reworkNotes",
          required: true,
          type: "text"
        },
        label: "Return to Plan made",
        presentation: "exclusive",
        requiredErrorCode: "user_check_failed",
        submitOptions: {
          userCheck: "failed"
        },
        targetStep: "plan_made"
      }
    ]
  }
};
const reworkStartedSessionPayload = {
  ...userCheckSessionPayload,
  activeCycle: "002",
  cycles: [
    {
      cycle: "001",
      label: "cycle_001",
      status: "failed",
      userCheckResult: "failed"
    },
    {
      cycle: "002",
      label: "cycle_002",
      reworkRequest: "The health endpoint returns the wrong status code.",
      status: "active",
      userCheckResult: ""
    }
  ],
  currentStep: "plan_made",
  planText: "",
  status: "running",
  currentStepAction: {
    buttonLabel: "Get Codex to create revised plan",
    description: "Codex writes a revised implementation plan from the user's rework notes for this cycle.",
    input: {
      extract: "plan",
      formatHint: "markdown",
      label: "Approved plan",
      multiline: true,
      name: "plan",
      required: true,
      type: "text"
    },
    kind: "codex_output",
    automation: { mode: "codex_output_prompt" },
    label: "Get Codex to create revised plan",
    stepId: "plan_made"
  },
  codex: {
    mode: "inject_prompt",
    promptActionLabel: "Get Codex to create revised plan",
    promptIntroText: "Codex will create a revised implementation plan based on the rework notes.",
    responseContract: {
      fields: [
        {
          extract: "plan",
          field: "plan",
          formatHint: "markdown",
          label: "Plan",
          multiline: true,
          required: true
        }
      ],
      kind: "fields",
      missingMarkerBehavior: "manual_or_resend",
      required: true
    }
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
    .join("\n")
    .concat("\n");
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

function mockCodexThreadIdForSession(sessionId: string) {
  const suffix = String(sessionId || "")
    .replace(/\D/gu, "")
    .padEnd(12, "0")
    .slice(-12);
  return `019e1575-2458-7b93-bf9d-${suffix}`;
}

async function mockCodexTerminalWebSocket(page, {
  initialOutputBySessionId,
  terminalInputs
}: {
  initialOutputBySessionId: Record<string, string>;
  terminalInputs: Record<string, string[]> | string[];
}) {
  await page.exposeFunction("__recordStudioCodexTerminalInput", ({ sessionId, data }: {
    data: string;
    sessionId: string;
  }) => {
    if (Array.isArray(terminalInputs)) {
      terminalInputs.push(String(data || ""));
      return;
    }
    const terminalInputMap = terminalInputs as Record<string, string[]>;
    terminalInputMap[sessionId] ||= [];
    terminalInputMap[sessionId].push(String(data || ""));
  });
  await page.addInitScript((options) => {
    const inputsBySessionId: Record<string, string[]> = {};
    const socketsBySessionId: Record<string, any[]> = {};
    const studioWindow = window as unknown as {
      __studioFailCodexTerminal: (input: { error?: string; sessionId: string }) => void;
      __recordStudioCodexTerminalInput: (input: { data: string; sessionId: string }) => void;
      __studioPushCodexTerminalOutput: (input: { output: string; sessionId: string }) => void;
      WebSocket: typeof WebSocket;
    };
    function sessionThreadId(sessionId) {
      const suffix = String(sessionId || "")
        .replace(/\D/gu, "")
        .padEnd(12, "0")
        .slice(-12);
      return `019e1575-2458-7b93-bf9d-${suffix}`;
    }
    class MockStudioWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState: number;
      sessionId: string;
      terminalSessionId: string;
      url: string;

      constructor(url) {
        super();
        this.url = String(url || "");
        this.readyState = MockStudioWebSocket.CONNECTING;
        const match = /\/issue-sessions\/([^/]+)\/codex-terminal\/([^/]+)\/ws/u.exec(new URL(this.url).pathname);
        this.sessionId = match ? decodeURIComponent(match[1]) : "";
        this.terminalSessionId = match ? decodeURIComponent(match[2]) : "";
        inputsBySessionId[this.sessionId] ||= [];
        socketsBySessionId[this.sessionId] ||= [];
        socketsBySessionId[this.sessionId].push(this);
        window.setTimeout(() => {
          this.readyState = MockStudioWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.__emit({
            type: "snapshot",
            session: {
              ok: true,
              id: this.terminalSessionId,
              status: "running",
              commandPreview: "codex",
              output: options.initialOutputBySessionId[this.sessionId] || "Codex ready.",
              needsThreadCapture: true,
              threadProbe: options.codexThreadProbe
            }
          });
        }, 0);
      }

      send(rawMessage) {
        const message = JSON.parse(String(rawMessage || "{}"));
        if (message.type !== "input") {
          return;
        }
        const data = String(message.data || "");
        inputsBySessionId[this.sessionId].push(data);
        studioWindow.__recordStudioCodexTerminalInput({
          data,
          sessionId: this.sessionId
        });
        if (data === "\r" && inputsBySessionId[this.sessionId].includes(options.codexThreadCommand)) {
          this.__emit({
            chunk: `\n${options.codexThreadProbe}\n${options.codexThreadIdBySessionId[this.sessionId] || sessionThreadId(this.sessionId)}\n`,
            type: "output"
          });
        }
      }

      close() {
        this.readyState = MockStudioWebSocket.CLOSED;
        socketsBySessionId[this.sessionId] = (socketsBySessionId[this.sessionId] || [])
          .filter((socket) => socket !== this);
        this.dispatchEvent(new CloseEvent("close"));
      }

      __emit(message) {
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify(message)
        }));
      }
    }
    studioWindow.__studioPushCodexTerminalOutput = ({ sessionId, output }) => {
      for (const socket of socketsBySessionId[sessionId] || []) {
        socket.__emit({
          chunk: String(output || ""),
          type: "output"
        });
      }
    };
    studioWindow.__studioFailCodexTerminal = ({ sessionId, error }) => {
      for (const socket of [...socketsBySessionId[sessionId] || []]) {
        socket.__emit({
          error: String(error || "Terminal session not found."),
          type: "error"
        });
        socket.close();
      }
    };
    studioWindow.WebSocket = MockStudioWebSocket as unknown as typeof WebSocket;
  }, {
    codexThreadCommand,
    codexThreadIdBySessionId: {
      [codexPromptSessionId]: codexThreadId
    },
    codexThreadProbe,
    initialOutputBySessionId
  });
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
  await mockCurrentAppInspection(page);
}

async function mockCurrentAppInspection(page) {
  await page.route("**/api/studio/current-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentAppPayload)
    });
  });
  await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        limits: {
          maxOpenSessions: 3,
          openSessionCount: 0
        },
        ok: true,
        sessions: [],
        stepDefinitions: []
      })
    });
  });
  await mockNpmScripts(page);
}

async function mockNpmScripts(page, {
  terminalInputs = [],
  terminalStarts = []
}: {
  terminalInputs?: string[];
  terminalStarts?: string[];
} = {}) {
  let currentPayload = JSON.parse(JSON.stringify(npmScriptsPayload));

  await page.exposeFunction("__recordStudioNpmTerminalInput", ({ data }: { data: string }) => {
    terminalInputs.push(String(data || ""));
  });
  await page.addInitScript(() => {
    const studioWindow = window as unknown as {
      __recordStudioNpmTerminalInput: (input: { data: string }) => void;
      WebSocket: typeof WebSocket;
    };
    const OriginalWebSocket = studioWindow.WebSocket;

    class MockStudioWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState: number;
      terminalSessionId: string;
      url: string;

      constructor(url) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url).pathname;
        const match = /\/npm-script-terminal\/([^/]+)\/ws/u.exec(pathname);
        if (!match) {
          return new OriginalWebSocket(url);
        }
        this.readyState = MockStudioWebSocket.CONNECTING;
        this.terminalSessionId = decodeURIComponent(match[1]);
        window.setTimeout(() => {
          this.readyState = MockStudioWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.__emit({
            type: "snapshot",
            session: {
              ok: true,
              id: this.terminalSessionId,
              status: "running",
              commandPreview: `npm run ${this.terminalSessionId.replace(/^npm-term-/u, "")}`,
              output: `Started ${this.terminalSessionId}.`
            }
          });
        }, 0);
      }

      send(rawMessage) {
        const message = JSON.parse(String(rawMessage || "{}"));
        if (message.type === "input") {
          studioWindow.__recordStudioNpmTerminalInput({
            data: String(message.data || "")
          });
        }
      }

      close() {
        this.readyState = MockStudioWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }

      __emit(message) {
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify(message)
        }));
      }
    }
    studioWindow.WebSocket = MockStudioWebSocket as unknown as typeof WebSocket;
  });

  function applyStars(scriptNames: string[]) {
    const stars = new Set(scriptNames);
    currentPayload = {
      ...currentPayload,
      config: {
        exists: true,
        path: ".jskit/config/starred_npm_scripts",
        source: "config"
      },
      starredScriptNames: scriptNames,
      scripts: currentPayload.scripts.map((script) => ({
        ...script,
        starred: stars.has(script.name)
      }))
    };
  }

  await page.route("**/api/studio/current-app/npm-scripts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentPayload)
    });
  });
  await page.route("**/api/studio/current-app/npm-scripts/starred", async (route) => {
    if (route.request().method() === "DELETE") {
      currentPayload = JSON.parse(JSON.stringify(npmScriptsPayload));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentPayload)
      });
      return;
    }
    applyStars(route.request().postDataJSON().scriptNames || []);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentPayload)
    });
  });
  await page.route("**/api/studio/current-app/npm-script-terminal", async (route) => {
    const scriptName = String(route.request().postDataJSON().scriptName || "");
    terminalStarts.push(scriptName);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: `npm-term-${scriptName}`,
        status: "running",
        commandPreview: `npm run ${scriptName}`,
        output: ""
      })
    });
  });
  await page.route("**/api/studio/current-app/npm-script-terminal/*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        closed: true,
        ok: true
      })
    });
  });
}

async function mockSessionHistoryArchives(page, archiveRequests = []) {
  await page.route("**/api/studio/current-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentAppPayload)
    });
  });
  await page.route("**/api/studio/current-app/issue-sessions**", async (route) => {
    const url = new URL(route.request().url());
    const archive = url.searchParams.get("archive") || "active";
    archiveRequests.push(archive);
    const sessions = archive === "completed"
      ? [completedArchiveSession]
      : archive === "abandoned" ? [abandonedArchiveSession] : [];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        limits: {
          maxOpenSessions: 3,
          openSessionCount: 0
        },
        ok: true,
        sessions,
        stepDefinitions: []
      })
    });
  });
  await mockNpmScripts(page);
}

async function mockCodexPromptHandoffRoute(page, sessionId: string) {
  await page.route(`**/api/studio/current-app/issue-sessions/${sessionId}/codex-prompt-handoff`, async (route) => {
    const payload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        codexPromptHandoffOutputStart: Number(payload.outputStart || 0),
        codexPromptHandoffSignature: payload.signature || "",
        ok: true
      })
    });
  });
}

async function mockCodexPromptSession(page, { stepPayloads = [], terminalInputs = [] } = {}) {
  let terminalOutput = "Codex ready.";
  let issueTitle = codexIssueDraftedPayload.issueTitle;
  let issueText = codexIssueDraftedPayload.issueText;
  let stepRequestCount = 0;
  await mockCodexTerminalWebSocket(page, {
    initialOutputBySessionId: {
      [codexPromptSessionId]: terminalOutput
    },
    terminalInputs
  });
  await page.route("**/api/studio/current-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentAppPayload)
    });
  });
  await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        limits: {
          maxOpenSessions: 3,
          openSessionCount: 1
        },
        ok: true,
        sessions: [codexPromptSessionPayload],
        stepDefinitions: codexPromptStepDefinitions
      })
    });
  });
  await mockNpmScripts(page);
  await page.route(`**/api/studio/current-app/issue-sessions/${codexPromptSessionId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(codexPromptSessionPayload)
    });
  });
  await page.route(`**/api/studio/current-app/issue-sessions/${codexPromptSessionId}/step`, async (route) => {
    const payload = route.request().postDataJSON();
    stepPayloads.push(payload);
    stepRequestCount += 1;
    if (stepRequestCount === 1) {
      issueTitle = String(payload.issueTitle || "");
      issueText = String(payload.issue || "");
    }
    const draftedPayload = {
      ...codexIssueDraftedPayload,
      issueTitle,
      issueText
    };
    const createdPayload = {
      ...codexIssueCreatedPayload,
      issueTitle,
      issueText
    };
    const planPromptPayload = {
      ...codexPlanPromptPayload,
      issueTitle,
      issueText
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        stepRequestCount === 1
          ? draftedPayload
          : stepRequestCount === 2 ? createdPayload : planPromptPayload
      )
    });
  });
  await page.route(`**/api/studio/current-app/issue-sessions/${codexPromptSessionId}/codex-terminal`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: "term-1",
        status: "running",
        commandPreview: "codex",
        output: terminalOutput,
        needsThreadCapture: true,
        threadProbe: codexThreadProbe
      })
    });
  });
  await page.route(`**/api/studio/current-app/issue-sessions/${codexPromptSessionId}/codex-thread`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        codexThreadId: route.request().postDataJSON().threadId,
        ok: true
      })
    });
  });
  await mockCodexPromptHandoffRoute(page, codexPromptSessionId);
  return {
    async setTerminalOutput(output) {
      terminalOutput = String(output || "");
      await page.evaluate(({ output: nextOutput, sessionId }) => {
        (window as unknown as {
          __studioPushCodexTerminalOutput: (input: { output: string; sessionId: string }) => void;
        }).__studioPushCodexTerminalOutput({
          output: nextOutput,
          sessionId
        });
      }, {
        output: terminalOutput,
        sessionId: codexPromptSessionId
      });
    },
    stepPayloads,
    terminalInputs
  };
}

function isOpenMockSession(session) {
  return !["abandoned", "finished"].includes(String(session.status || ""));
}

async function mockCodexPromptSessions(page, sessionPayloads) {
  let visibleSessionPayloads = [...sessionPayloads];
  const terminalStarts = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, 0]));
  const terminalDeletes = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, 0]));
  const terminalInputs = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, []])) as Record<string, string[]>;
  const payloadsBySessionId = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, session]));
  await mockCodexTerminalWebSocket(page, {
    initialOutputBySessionId: Object.fromEntries(sessionPayloads.map((session) => [
      session.sessionId,
      `Codex ready for ${session.sessionId}.`
    ])),
    terminalInputs
  });

  await page.route("**/api/studio/current-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentAppPayload)
    });
  });
  await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        limits: {
          maxOpenSessions: 3,
          openSessionCount: visibleSessionPayloads.filter(isOpenMockSession).length
        },
        ok: true,
        sessions: visibleSessionPayloads,
        stepDefinitions: codexPromptStepDefinitions
      })
    });
  });
  await mockNpmScripts(page);

  for (const sessionId of Object.keys(payloadsBySessionId)) {
    await page.route(`**/api/studio/current-app/issue-sessions/${sessionId}`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(payloadsBySessionId[sessionId])
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${sessionId}/abandon`, async (route) => {
      terminalDeletes[sessionId] += 1;
      payloadsBySessionId[sessionId] = {
        ...payloadsBySessionId[sessionId],
        codex: null,
        currentStep: "",
        status: "abandoned"
      };
      visibleSessionPayloads = visibleSessionPayloads.filter((session) => session.sessionId !== sessionId);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(payloadsBySessionId[sessionId])
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${sessionId}/codex-terminal`, async (route) => {
      terminalStarts[sessionId] += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          id: `term-${sessionId}`,
          status: "running",
          commandPreview: "codex",
          output: `Codex ready for ${sessionId}.`,
          needsThreadCapture: true,
          threadProbe: codexThreadProbe
        })
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${sessionId}/codex-thread`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          codexThreadId: route.request().postDataJSON().threadId,
          ok: true
        })
      });
    });
    await mockCodexPromptHandoffRoute(page, sessionId);
    await page.route(
      `**/api/studio/current-app/issue-sessions/${sessionId}/codex-terminal/term-${sessionId}`,
      async (route) => {
        if (route.request().method() === "DELETE") {
          terminalDeletes[sessionId] += 1;
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              closed: true,
              ok: true
            })
          });
          return;
        }
        await route.fulfill({
          contentType: "application/json",
          status: 410,
          body: JSON.stringify({
            ok: false,
            error: "HTTP terminal read fallback is not available in tests."
          })
        });
      }
    );
  }

  return {
    terminalDeletes,
    terminalInputs,
    terminalStarts
  };
}

async function mockTwoCodexPromptSessions(page) {
  return mockCodexPromptSessions(page, [
    codexPromptSessionPayload,
    secondCodexPromptSessionPayload
  ]);
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

async function expectSessionsRoute(page) {
  await expect(page.locator(".studio-issue-sessions").first()).toBeVisible();
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

async function expectSessionHistoryRoute(page, archive) {
  const tabName = archive === "abandoned" ? "Abandoned" : "Completed";

  await expect(page.getByRole("heading", { name: "Session History", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Completed", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Abandoned", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: tabName, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Completed Sessions", exact: true })).toHaveCount(0);
  await expect(page.getByText("Finished sessions keep their reports, decisions, issue links, and PR outcome."))
    .toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Abandoned Sessions", exact: true })).toHaveCount(0);
  await expect(page.getByText("Worktrees are removed; session branches remain recoverable in Git.")).toHaveCount(0);
}

test.describe("session history navigation", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} session history groups archive tabs under secondary navigation`, async ({ page }) => {
      const archiveRequests = [];
      await mockSessionHistoryArchives(page, archiveRequests);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/home/history`);

      await expect(page).toHaveURL(/\/home\/history\?tab=completed$/u);
      await expectSessionHistoryRoute(page, "completed");
      await expect(page.getByText("issue-2-session-history")).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Sessions$/u }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /^Session History$/u }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /^Completed$/u })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^Abandoned$/u })).toHaveCount(0);
      expect(archiveRequests).toContain("completed");

      await page.getByRole("tab", { name: "Abandoned", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/history\?tab=abandoned$/u);
      await expectSessionHistoryRoute(page, "abandoned");
      await expect(page.getByText("issue-2-abandoned-session")).toBeVisible();
      await expect.poll(() => archiveRequests.includes("abandoned")).toBe(true);

      await page.getByRole("tab", { name: "Completed", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/history\?tab=completed$/u);
      await expectSessionHistoryRoute(page, "completed");
      await expect.poll(() => archiveRequests.includes("completed")).toBe(true);

      await expectVisibleTapTargets(page);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("old completed and abandoned routes are not preserved as archive views", async ({ page }) => {
    const archiveRequests = [];
    await mockSessionHistoryArchives(page, archiveRequests);

    await page.goto(`${BASE_URL}/home/completed`);
    await expect(page.getByRole("heading", { name: "Completed Sessions", exact: true })).toHaveCount(0);
    await expect(page.locator(".studio-archived-sessions")).toHaveCount(0);

    await page.goto(`${BASE_URL}/home/abandoned`);
    await expect(page.getByRole("heading", { name: "Abandoned Sessions", exact: true })).toHaveCount(0);
    await expect(page.locator(".studio-archived-sessions")).toHaveCount(0);
    expect(archiveRequests).toEqual([]);
  });
});

test.describe("bootup setup tabbed doctor responsive smoke", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} default route renders the bootup tab without horizontal overflow`, async ({ page }) => {
      await mockBootstrapBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/bootup-setup`);
      await expect(page).toHaveURL(/\/bootup-setup\?tab=bootup$/u);
      await expect(page.getByRole("tab", { name: "Bootup", exact: true })).toHaveAttribute("aria-selected", "true");
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

    test(`${viewport.name} target app tab renders before current app inspection`, async ({ page }) => {
      await mockTargetAppBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/bootup-setup?tab=app-bootup`);
      await expect(page.getByRole("tab", { name: "App Bootup", exact: true })).toHaveAttribute("aria-selected", "true");
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

    test(`${viewport.name} app setup tab renders sequential stages`, async ({ page }) => {
      await mockAppSetupBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/bootup-setup?tab=app-setup`);
      await expect(page.getByRole("tab", { name: "App setup", exact: true })).toHaveAttribute("aria-selected", "true");
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

test.describe("studio startup navigation", () => {
  test("root redirects to home without running bootup doctors", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockBootstrapBlocked(page);
    await mockCurrentAppInspection(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(0);
    expect(apiRequests.count("/api/studio/bootstrap/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/target-app")).toBe(0);
    expect(apiRequests.count("/api/studio/app-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(1);
  });

  test("home loads the current app without running bootup doctors", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockTargetAppBlocked(page);
    await mockCurrentAppInspection(page);
    await page.goto(`${BASE_URL}/home`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    await expect(page.getByRole("link", { name: "Bootup/Setup", exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "NPM Scripts", exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Bootup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "App Bootup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "App Setup", exact: true })).toHaveCount(0);
    await expect(page.locator(".npm-scripts-panel")).toHaveCount(0);
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(0);
    expect(apiRequests.count("/api/studio/target-app")).toBe(0);
    expect(apiRequests.count("/api/studio/target-app/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/app-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(1);
  });

  test("npm scripts page persists stars, resets defaults, and runs one terminal", async ({ page }) => {
    const terminalInputs: string[] = [];
    const terminalStarts: string[] = [];
    await page.route("**/api/studio/current-app", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentAppPayload)
      });
    });
    await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 0
          },
          ok: true,
          sessions: [],
          stepDefinitions: []
        })
      });
    });
    await mockNpmScripts(page, {
      terminalInputs,
      terminalStarts
    });

    await page.goto(`${BASE_URL}/home/npm-scripts`);
    const panel = page.locator(".npm-scripts-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByRole("link", { name: "NPM Scripts", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "NPM Scripts", exact: true })).toHaveCount(0);

    await expect.poll(async () => {
      return panel.locator(".npm-scripts-panel__starred button[aria-label^='Run ']")
        .evaluateAll((buttons) => buttons.map((button) =>
          String(button.getAttribute("aria-label") || "").replace(/^Run /u, "")
        ));
    }).toEqual(["jskit:update", "devlinks", "build", "server", "verify"]);
    await expect(panel.getByText("vite preview")).toBeVisible();

    await panel.getByRole("button", { name: "Unstar jskit:update" }).click();
    await expect(panel.locator(".npm-scripts-panel__starred").getByRole("button", { name: "Run jskit:update" }))
      .toHaveCount(0);
    await panel.getByRole("button", { name: "Star preview" }).click();
    await expect(panel.locator(".npm-scripts-panel__starred").getByRole("button", { name: "Run preview" }))
      .toBeVisible();
    await expect(panel.locator(".npm-scripts-panel__other-scripts").getByRole("button", { name: "Run preview" }))
      .toHaveCount(0);
    await panel.getByRole("button", { name: "Reset" }).click();
    await expect(panel.locator(".npm-scripts-panel__starred").getByRole("button", { name: "Run preview" }))
      .toHaveCount(0);
    await expect(panel.locator(".npm-scripts-panel__starred").getByRole("button", { name: "Run jskit:update" }))
      .toBeVisible();

    await panel.locator(".npm-scripts-panel__starred").getByRole("button", { name: "Run build" }).click();
    await expect.poll(() => terminalStarts).toEqual(["build"]);
    const terminal = page.locator(".npm-script-terminal");
    await expect(terminal).toHaveCount(1);
    await expect(terminal).toContainText("npm run build");
    await expect(terminal.locator(".xterm-rows")).toContainText("Started npm-term-build.");
    const viewport = page.viewportSize();
    await expect.poll(async () => {
      const box = await terminal.boundingBox();
      return Boolean(
        box &&
        viewport &&
        Math.round(box.width) === viewport.width &&
        Math.round(box.height) === viewport.height
      );
    }).toBe(true);
    await terminal.getByRole("button", { name: "Ctrl-C" }).click();
    await expect.poll(() => terminalInputs).toContain("\u0003");
    await terminal.getByRole("button", { name: "Close npm script terminal" }).click();
    await expect(terminal).toHaveCount(0);

    await panel.locator(".npm-scripts-panel__starred").getByRole("button", { name: "Run server" }).click();
    await expect.poll(() => terminalStarts).toEqual(["build", "server"]);
    await expect(terminal).toHaveCount(1);
    await expect(terminal).toContainText("npm run server");
  });

  test("home stays on home even when setup checks would be blocked", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockAppSetupBlocked(page);
    await mockCurrentAppInspection(page);
    await page.goto(`${BASE_URL}/home`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(0);
    expect(apiRequests.count("/api/studio/target-app")).toBe(0);
    expect(apiRequests.count("/api/studio/app-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/app-setup/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(1);
  });

  test("root redirects to home when every bootup gate is ready", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(0);
    expect(apiRequests.count("/api/studio/target-app")).toBe(0);
    expect(apiRequests.count("/api/studio/app-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(1);
  });

  test("direct app bootup tab runs the target app doctor stream once", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockTargetAppBlocked(page);
    await page.goto(`${BASE_URL}/bootup-setup?tab=app-bootup`);
    await expect(page.getByRole("heading", { name: "App Bootup", exact: true })).toBeVisible();
    await expect(page.getByText("Target app blocked").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(1);
    expect(apiRequests.count("/api/studio/target-app")).toBe(0);
    expect(apiRequests.count("/api/studio/target-app/stream")).toBe(1);
  });

  test("direct app setup tab runs the app setup doctor stream once", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockAppSetupBlocked(page);
    await page.goto(`${BASE_URL}/bootup-setup?tab=app-setup`);
    await expect(page.getByRole("heading", { name: "App Setup", exact: true })).toBeVisible();
    await expect(page.getByText("App setup blocked").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/bootstrap")).toBe(1);
    expect(apiRequests.count("/api/studio/target-app")).toBe(1);
    expect(apiRequests.count("/api/studio/app-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/app-setup/stream")).toBe(1);
  });

  test("bootup setup tab clicks update the URL query", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/bootup-setup?tab=bootup`);
    await expect(page.getByRole("tab", { name: "Bootup", exact: true })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "App Bootup", exact: true }).click();
    await expect(page).toHaveURL(/\/bootup-setup\?tab=app-bootup$/u);
    await expect(page.getByRole("tab", { name: "App Bootup", exact: true })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "App setup", exact: true }).click();
    await expect(page).toHaveURL(/\/bootup-setup\?tab=app-setup$/u);
    await expect(page.getByRole("tab", { name: "App setup", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("ready continue moves from bootup to app bootup tab", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/bootup-setup?tab=bootup`);
    await page.getByRole("button", { name: "Continue to app bootup" }).click();
    await expect(page).toHaveURL(/\/bootup-setup\?tab=app-bootup$/u);
    await expect(page.getByRole("heading", { name: "App Bootup", exact: true })).toBeVisible();
  });

  test("ready continue moves from app bootup to app setup tab", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/bootup-setup?tab=app-bootup`);
    await page.getByRole("button", { name: "Continue to app setup" }).click();
    await expect(page).toHaveURL(/\/bootup-setup\?tab=app-setup$/u);
    await expect(page.getByRole("heading", { name: "App Setup", exact: true })).toBeVisible();
  });

  test("ready continue moves from app setup to home", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/bootup-setup?tab=app-setup`);
    await page.getByRole("link", { name: "Continue to home" }).click();
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
  });

  test("old bootup routes do not redirect to the new bootup setup page", async ({ page }) => {
    for (const oldRoute of ["/bootup", "/app-bootup", "/app-setup"]) {
      await page.goto(`${BASE_URL}${oldRoute}`);
      await expect(page).not.toHaveURL(/\/bootup-setup/u);
    }
  });

  test("active session title follows the selected session without adding a details fact", async ({ page }) => {
    await mockCodexPromptSessions(page, [
      {
        ...codexPromptSessionPayload,
        issueText: "First active session body.",
        issueTitle: "First active session"
      },
      {
        ...secondCodexPromptSessionPayload,
        issueText: "Second active session body.",
        issueTitle: "Second active session"
      }
    ]);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await expect(page.locator(".studio-home-shell-title")).toHaveText("Second active session");
    await expect(
      page.locator(".studio-issue-sessions__facts .studio-issue-sessions__fact-label").filter({ hasText: /^Title$/u })
    ).toHaveCount(0);

    await page.locator(".studio-issue-sessions__tab-chip").filter({ hasText: "01-02-39" }).click();
    await expect(page.locator(".studio-home-shell-title")).toHaveText("First active session");

    await page.route(/\/api\/studio\/current-app\/issue-sessions\?archive=/u, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 2
          },
          ok: true,
          sessions: [],
          stepDefinitions: []
        })
      });
    });
    await page.goto(`${BASE_URL}/home/history`);
    await expect(page.getByRole("heading", { name: "Session History" })).toBeVisible();
    await expect(page.locator(".studio-home-shell-title")).toHaveCount(0);
  });

  test("active session title updates after accepted Codex issue output", async ({ page }) => {
    const stepPayloads: unknown[] = [];
    const codexSession = await mockCodexPromptSession(page, {
      stepPayloads
    });

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await expect(page.locator(".studio-home-shell-title")).toHaveText("Session 05-12_01-02-39");

    await codexSession.setTerminalOutput([
      "Codex ready.",
      "[issue_title]",
      "Add session UI",
      "[/issue_title]",
      "[issue_text]",
      "Make sessions clearer.",
      "[/issue_text]"
    ].join("\n"));

    const finaliseIssueButton = page.getByRole("button", { name: "Finalise issue" });
    await expect(finaliseIssueButton).toBeEnabled();
    await page.getByLabel("Issue title from Codex").fill("Edited session UI");
    await finaliseIssueButton.click();

    await expect.poll(() => stepPayloads.length).toBe(2);
    await expect(page.locator(".studio-home-shell-title")).toHaveText("Edited session UI");
  });

  test("codex issue step injects the prompt, finalises the draft, then creates the issue automatically", async ({ page }) => {
    const stepPayloads: unknown[] = [];
    const terminalInputs: string[] = [];
    const codexSession = await mockCodexPromptSession(page, {
      stepPayloads,
      terminalInputs
    });

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    const submitPromptButton = page.getByRole("button", { name: "Submit prompt to Codex" });
    await expect(submitPromptButton).toBeVisible();
    await expect(page.locator(".xterm-rows").first()).toContainText("Codex ready.");
    const terminalHost = page.locator(".codex-terminal__host").first();
    await terminalHost.click();
    await expect(terminalHost).toHaveCSS("border-color", "rgb(78, 161, 255)");
    await submitPromptButton.click();

    await expect.poll(() => terminalInputs.length).toBe(7);
    expect(terminalInputs.slice(0, 6)).toEqual(codexShellSubmitSequence);
    expect(terminalInputs[6]).toContain(codexPromptText);
    await expect(submitPromptButton).toHaveCount(0);
    await expect(page.getByText("Submit prompt to Codex requested.")).toBeVisible();

    await codexSession.setTerminalOutput([
      "Codex ready.",
      "[issue_title]",
      "Add session UI",
      "[/issue_title]"
    ].join("\n"));

    const finaliseIssueButton = page.getByRole("button", { name: "Finalise issue" });
    await expect(finaliseIssueButton).toBeVisible();
    await expect(finaliseIssueButton).toBeDisabled();
    const issueTitleField = page.getByLabel("Issue title from Codex");
    const issueBodyField = page.getByLabel("Issue body from Codex");
    await expect(issueTitleField).toHaveValue("Add session UI");
    await expect(issueBodyField).toHaveValue("");

    await codexSession.setTerminalOutput([
      "Codex ready.",
      "[issue_title]",
      "Add session UI",
      "[/issue_title]",
      "[issue_text]",
      "Make sessions clearer.",
      "[/issue_text]"
    ].join("\n"));

    await expect(finaliseIssueButton).toBeEnabled();
    await expect(issueTitleField).toHaveValue("Add session UI");
    await expect(issueBodyField).toHaveValue("Make sessions clearer.");
    await issueTitleField.fill("Edited session UI");
    await issueBodyField.fill("Make the issue sharper.");
    await finaliseIssueButton.click();

    await expect.poll(() => stepPayloads.length).toBe(1);
    expect(stepPayloads[0]).toEqual({
      issue: "Make the issue sharper.",
      issueTitle: "Edited session UI"
    });
    await expect.poll(() => stepPayloads.length).toBe(2);
    expect(stepPayloads[1]).toEqual({});
    await expect(page.getByRole("button", { name: "Create issue" })).toHaveCount(0);

    await expect(page.getByText("Done: Issue created")).toBeVisible();
    await expect(page.getByText("Goal: Plan made")).toBeVisible();
  });

  test("codex output editors stay hidden until parsed output exists", async ({ page }) => {
    const stepPayloads: unknown[] = [];
    const terminalInputs: string[] = [];
    const codexSession = await mockCodexPromptSession(page, {
      stepPayloads,
      terminalInputs
    });

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);

    const issueTitleField = page.getByLabel("Issue title from Codex");
    const issueBodyField = page.getByLabel("Issue body from Codex");
    const finaliseIssueButton = page.getByRole("button", { name: "Finalise issue" });
    await expect(issueTitleField).toHaveCount(0);
    await expect(issueBodyField).toHaveCount(0);
    await expect(finaliseIssueButton).toHaveCount(0);

    await codexSession.setTerminalOutput("Codex ready.\nThinking without tagged issue output.");
    await expect(issueTitleField).toHaveCount(0);
    await expect(issueBodyField).toHaveCount(0);
    await expect(finaliseIssueButton).toHaveCount(0);

    await codexSession.setTerminalOutput([
      "Codex ready.",
      "[issue_title]",
      "Add session UI",
      "[/issue_title]",
      "[issue_text]",
      "Make sessions clearer.",
      "[/issue_text]"
    ].join("\n"));
    await expect(issueTitleField).toBeVisible();
    await expect(issueBodyField).toBeVisible();
    await expect(finaliseIssueButton).toBeEnabled();
    await finaliseIssueButton.click();

    await expect.poll(() => stepPayloads.length).toBeGreaterThanOrEqual(2);

    const planField = page.getByLabel("Plan from Codex");
    const savePlanButton = page.getByRole("button", { name: "Save plan" });
    await expect(planField).toHaveCount(0);
    await expect(savePlanButton).toHaveCount(0);
    const planPromptButton = page.getByRole("button", { name: "Get Codex to create plan" });
    await expect(planPromptButton).toBeVisible();

    await codexSession.setTerminalOutput("Codex ready.\nThinking without tagged plan output.");
    await expect(planField).toHaveCount(0);
    await expect(savePlanButton).toHaveCount(0);
    await planPromptButton.click();
    await expect.poll(() => stepPayloads.length).toBe(3);

    await codexSession.setTerminalOutput([
      "Codex ready.",
      "[plan]",
      "1. Inspect the existing session UI.",
      "2. Tighten the labels.",
      "[/plan]"
    ].join("\n"));
    await expect(planField).toBeVisible();
    await expect(planField).toHaveValue("1. Inspect the existing session UI.\n2. Tighten the labels.");
    await expect(savePlanButton).toBeEnabled();
  });

  test("plan prompt generation injects the returned prompt on the first click", async ({ page }) => {
    const stepPayloads: unknown[] = [];
    const terminalInputs: string[] = [];
    const codexSession = await mockCodexPromptSession(page, {
      stepPayloads,
      terminalInputs
    });

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await expect(page.locator(".xterm-rows").first()).toContainText("Codex ready.");
    await codexSession.setTerminalOutput([
      "Codex ready.",
      "[issue_title]",
      "Add session UI",
      "[/issue_title]",
      "[issue_text]",
      "Make sessions clearer.",
      "[/issue_text]"
    ].join("\n"));

    await page.getByRole("button", { name: "Finalise issue" }).click();
    await expect.poll(() => stepPayloads.length).toBe(1);
    await expect.poll(() => stepPayloads.length).toBe(2);

    const planPromptButton = page.getByRole("button", { name: "Get Codex to create plan" });
    await expect(planPromptButton).toBeVisible();
    await planPromptButton.click();
    await expect.poll(() => stepPayloads.length).toBe(3);
    expect(stepPayloads[2]).toEqual({});
    await expect(planPromptButton).toHaveCount(0);
    await expect(page.getByText("Get Codex to create plan requested.")).toBeVisible();
    await expect.poll(() => terminalInputs.join("")).toContain(codexPlanPromptText);
  });

  test("next Codex prompt step injects after saving a Codex output step", async ({ page }) => {
    const executionPrompt = "Execute the approved implementation plan after saving the plan.";
    let activeSession = codexPlanPromptPayload;
    const stepPayloads: Record<string, unknown>[] = [];
    const terminalInputs: Record<string, string[]> = {
      [codexPromptSessionId]: []
    };
    await mockCodexTerminalWebSocket(page, {
      initialOutputBySessionId: {
        [codexPromptSessionId]: "Codex ready."
      },
      terminalInputs
    });
    await mockStudioReady(page);
    await page.route("**/api/studio/current-app", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentAppPayload)
      });
    });
    await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 1
          },
          ok: true,
          sessions: [activeSession],
          stepDefinitions: planExecutionRejectStepDefinitions
        })
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${codexPromptSessionId}`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${codexPromptSessionId}/step`, async (route) => {
      stepPayloads.push(route.request().postDataJSON());
      activeSession = {
        ...planExecutionRejectPayload,
        sessionId: codexPromptSessionId,
        prompt: executionPrompt,
        worktree: sessionWorktreePath(codexPromptSessionId)
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${codexPromptSessionId}/codex-terminal`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          commandPreview: "codex",
          id: `term-${codexPromptSessionId}`,
          needsThreadCapture: false,
          ok: true,
          output: "Codex ready.",
          status: "running"
        })
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${codexPromptSessionId}/codex-thread`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          codexThreadId,
          ok: true
        })
      });
    });
    await mockCodexPromptHandoffRoute(page, codexPromptSessionId);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await page.getByRole("button", { name: "Get Codex to create plan" }).click();
    await expect.poll(() => terminalInputs[codexPromptSessionId].join(""))
      .toContain(codexPlanPromptText);

    await page.evaluate(({ output, sessionId }) => {
      (window as unknown as {
        __studioPushCodexTerminalOutput: (input: { output: string; sessionId: string }) => void;
      }).__studioPushCodexTerminalOutput({
        output,
        sessionId
      });
    }, {
      output: [
        "Codex ready.",
        "[plan]",
        "Implement the issue.",
        "[/plan]"
      ].join("\n"),
      sessionId: codexPromptSessionId
    });

    await page.getByRole("button", { name: "Save plan" }).click();
    await expect.poll(() => stepPayloads.length).toBe(1);
    await expect.poll(() => terminalInputs[codexPromptSessionId].join(""))
      .toContain(executionPrompt);
  });

  test("Codex prompt step is not marked requested until terminal confirms injection", async ({ page }) => {
    let terminalStartCount = 0;

    await mockStudioReady(page);
    await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 1
          },
          ok: true,
          sessions: [planExecutionRejectPayload],
          stepDefinitions: planExecutionRejectStepDefinitions
        })
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(planExecutionRejectPayload)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}/codex-terminal`, async (route) => {
      terminalStartCount += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          error: "Terminal stream failed to connect.",
          ok: false
        })
      });
    });

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await expect.poll(() => terminalStartCount).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Start task" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Go to next step" })).toHaveCount(0);
  });

  test("Start task Codex prompt request retries until the terminal accepts it", async ({ page }) => {
    let terminalStartCount = 0;
    const terminalInputs: Record<string, string[]> = {
      [planExecutionRejectSessionId]: []
    };
    await mockCodexTerminalWebSocket(page, {
      initialOutputBySessionId: {
        [planExecutionRejectSessionId]: "Codex ready."
      },
      terminalInputs
    });
    await mockStudioReady(page);
    await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 1
          },
          ok: true,
          sessions: [planExecutionRejectPayload],
          stepDefinitions: planExecutionRejectStepDefinitions
        })
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(planExecutionRejectPayload)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}/codex-terminal`, async (route) => {
      terminalStartCount += 1;
      if (terminalStartCount === 1) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            error: "Terminal is still starting.",
            ok: false
          })
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          commandPreview: "codex",
          id: `term-${planExecutionRejectSessionId}`,
          needsThreadCapture: false,
          ok: true,
          output: "Codex ready.",
          status: "running"
        })
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}/codex-thread`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          codexThreadId,
          ok: true
        })
      });
    });
    await mockCodexPromptHandoffRoute(page, planExecutionRejectSessionId);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await expect(page.getByRole("button", { name: "Start task" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(terminalInputs[planExecutionRejectSessionId].join(""))
      .not.toContain("Execute the approved implementation plan.");
    await page.getByRole("button", { name: "Start task" }).click();
    await expect(page.getByRole("button", { name: "Start task" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Go to next step" })).toBeDisabled();
    await expect.poll(() => terminalStartCount).toBeGreaterThan(1);
    await expect.poll(() => terminalInputs[planExecutionRejectSessionId].join(""))
      .toContain("Execute the approved implementation plan.");
  });

  test("persisted Codex prompt handoff survives reload without showing Start task", async ({ page }) => {
    const terminalInputs: Record<string, string[]> = {
      [planExecutionRejectSessionId]: []
    };
    const activeSession = {
      ...planExecutionRejectPayload,
      codexPromptHandoffOutputStart: "Codex ready.".length,
      codexPromptHandoffSignature: codexPromptSignature(planExecutionRejectPayload),
      codexThreadId,
      status: "waiting_for_user"
    };

    await mockCodexTerminalWebSocket(page, {
      initialOutputBySessionId: {
        [planExecutionRejectSessionId]: "Codex ready.\nRunning checks..."
      },
      terminalInputs
    });
    await mockStudioReady(page);
    await page.route("**/api/studio/current-app", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentAppPayload)
      });
    });
    await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 1
          },
          ok: true,
          sessions: [activeSession],
          stepDefinitions: planExecutionRejectStepDefinitions
        })
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}/codex-terminal`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          commandPreview: "codex",
          id: `term-${planExecutionRejectSessionId}`,
          needsThreadCapture: false,
          ok: true,
          output: "Codex ready.\nRunning checks...",
          status: "running"
        })
      });
    });
    await mockCodexPromptHandoffRoute(page, planExecutionRejectSessionId);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await expect(page.getByRole("button", { name: "Start task" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Go to next step" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(terminalInputs[planExecutionRejectSessionId].join(""))
      .not.toContain("Execute the approved implementation plan.");
  });

  test("conditional Deep UI checks with a JSKIT skip reason are skipped automatically", async ({ page }) => {
    let activeSession = deepUiSkipSessionPayload;
    let stepRequestCount = 0;

    await page.route("**/api/studio/current-app", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentAppPayload)
      });
    });
    await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 1
          },
          ok: true,
          sessions: [activeSession],
          stepDefinitions: deepUiSkipStepDefinitions
        })
      });
    });
    await mockNpmScripts(page);
    await page.route(`**/api/studio/current-app/issue-sessions/${deepUiSkipSessionId}`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${deepUiSkipSessionId}/step`, async (route) => {
      stepRequestCount += 1;
      activeSession = deepUiSkippedSessionPayload;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await expect.poll(() => stepRequestCount).toBe(1);

    const deepUiStep = page.locator(".studio-issue-sessions__step").filter({
      hasText: "Deep UI check run"
    });
    await expect(deepUiStep).toContainText("Done: Deep UI check run");
    await expect(deepUiStep).toContainText("Skipped");
    await expect(page.getByText("JSKIT can skip this conditional step")).toHaveCount(0);
    await expect(page.getByText("Goal: Review/deslop")).toBeVisible();
  });

  test("Deep UI prompt waits for Start task without exposing prompt copy UI", async ({ page }) => {
    const codexSessions = await mockCodexPromptSessions(page, [
      deepUiPromptedSessionPayload
    ]);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);

    const deepUiStep = page.locator(".studio-issue-sessions__step").filter({
      hasText: "Deep UI check run"
    });
    await expect(deepUiStep).toContainText("Goal: Deep UI check run");
    await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy Prompt" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start task" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(codexSessions.terminalInputs[deepUiPromptSessionId].join(""))
      .not.toContain("Deep UI quality check prompt for this session.");
    await page.getByRole("button", { name: "Start task" }).click();
    await expect.poll(() => codexSessions.terminalInputs[deepUiPromptSessionId].join(""))
      .toContain("Deep UI quality check prompt for this session.");
  });

  test("Codex completion output waits for a marker matching the current step", async ({ page }) => {
    let activeSession = planExecutionRejectPayload;
    let stepRequestCount = 0;
    const stepPayloads: Record<string, unknown>[] = [];
    const terminalInputs: Record<string, string[]> = {
      [planExecutionRejectSessionId]: []
    };

    await mockCodexTerminalWebSocket(page, {
      initialOutputBySessionId: {
        [planExecutionRejectSessionId]: "Codex ready."
      },
      terminalInputs
    });
    await page.route("**/api/studio/current-app", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentAppPayload)
      });
    });
    await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 1
          },
          ok: true,
          sessions: [activeSession],
          stepDefinitions: planExecutionRejectStepDefinitions
        })
      });
    });
    await mockNpmScripts(page);
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}/step`, async (route) => {
      stepRequestCount += 1;
      stepPayloads.push(route.request().postDataJSON());
      activeSession = {
        ...planExecutionRejectPayload,
        currentStep: "deep_ui_check_run",
        completedSteps: [
          ...planExecutionRejectPayload.completedSteps,
          "plan_executed"
        ],
        status: "running"
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}/codex-terminal`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          commandPreview: "codex",
          id: `term-${planExecutionRejectSessionId}`,
          needsThreadCapture: false,
          ok: true,
          output: "Codex ready.",
          status: "running"
        })
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${planExecutionRejectSessionId}/codex-thread`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          codexThreadId,
          ok: true
        })
      });
    });
    await mockCodexPromptHandoffRoute(page, planExecutionRejectSessionId);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await page.getByRole("button", { name: "Start task" }).click();
    await expect.poll(() => terminalInputs[planExecutionRejectSessionId].join(""))
      .toContain("Execute the approved implementation plan.");
    await page.evaluate(({ output, sessionId }) => {
      (window as unknown as {
        __studioPushCodexTerminalOutput: (input: { output: string; sessionId: string }) => void;
      }).__studioPushCodexTerminalOutput({
        output,
        sessionId
      });
    }, {
      output: [
        "",
        "\u001b[32m[jskit_step_result]\u001b[0m",
        "status: complete",
        "\u001b[33m  step: plan_executed\u001b[0m",
        "summary: Short summary of what changed and what was checked.",
        "\u001b[32m[/jskit_step_result]\u001b[0m",
        "",
        "\u001b[32m[jskit_step_result]\u001b[0m",
        "status: complete",
        "\u001b[33mstep: automated_checks_run\u001b[0m",
        "summary: Wrong step marker.",
        "\u001b[32m[/jskit_step_result]\u001b[0m",
        ""
      ].join("\n"),
      sessionId: planExecutionRejectSessionId
    });

    await page.waitForTimeout(1600);
    expect(stepRequestCount).toBe(0);
    await expect(page.getByText("Codex finished without the required step completion block.").first()).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Resend execute plan request" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Go to next step" })).toBeVisible();

    await page.evaluate(({ output, sessionId }) => {
      (window as unknown as {
        __studioPushCodexTerminalOutput: (input: { output: string; sessionId: string }) => void;
      }).__studioPushCodexTerminalOutput({
        output,
        sessionId
      });
    }, {
      output: [
        "",
        "\u001b[32m[jskit_step_result]\u001b[0m",
        "status: complete",
        "\u001b[33mstep: automated_checks_run\u001b[0m",
        "summary: Wrong step marker.",
        "\u001b[32m[/jskit_step_result]\u001b[0m",
        "",
        "[jskit_step_result]",
        "status: complete",
        "step: plan_executed",
        "summary: Correct plan execution marker.",
        "[/jskit_step_result]"
      ].join("\n"),
      sessionId: planExecutionRejectSessionId
    });

    await page.waitForTimeout(100);
    await page.getByRole("button", { name: "Go to next step" }).click();

    await expect.poll(() => stepRequestCount).toBe(1);
    expect(String(stepPayloads[0]?.codexResult || "")).not.toContain("\u001b");
    expect(stepPayloads[0]?.codexResult).toBe([
      "[jskit_step_result]",
      "status: complete",
      "step: plan_executed",
      "summary: Correct plan execution marker.",
      "[/jskit_step_result]"
    ].join("\n"));
    expect(stepPayloads[0]?.codexResult).not.toContain("Short summary of what changed and what was checked.");
  });

  test("review/deslop go next does not run the following JSKIT step in the same click", async ({ page }) => {
    let activeSession = reviewDeslopAcceptedPayload;
    let stepRequestCount = 0;
    const terminalInputs: Record<string, string[]> = {
      [reviewDeslopSessionId]: []
    };
    await mockCodexTerminalWebSocket(page, {
      initialOutputBySessionId: {
        [reviewDeslopSessionId]: "Codex ready."
      },
      terminalInputs
    });
    await page.route("**/api/studio/current-app", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentAppPayload)
      });
    });
    await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 1
          },
          ok: true,
          sessions: [activeSession],
          stepDefinitions: reviewDeslopStepDefinitions
        })
      });
    });
    await mockNpmScripts(page);
    await page.route(`**/api/studio/current-app/issue-sessions/${reviewDeslopSessionId}`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${reviewDeslopSessionId}/step`, async (route) => {
      stepRequestCount += 1;
      activeSession = stepRequestCount === 1
        ? reviewDeslopNextPromptPayload
        : reviewDeslopUnexpectedAdvancedPayload;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${reviewDeslopSessionId}/codex-terminal`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          commandPreview: "codex",
          id: `term-${reviewDeslopSessionId}`,
          needsThreadCapture: false,
          ok: true,
          output: "Codex ready.",
          status: "running"
        })
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${reviewDeslopSessionId}/codex-thread`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          codexThreadId,
          ok: true
        })
      });
    });
    await mockCodexPromptHandoffRoute(page, reviewDeslopSessionId);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await page.getByRole("button", { name: "Go to next step" }).click();

    await expect.poll(() => stepRequestCount).toBe(1);
    await page.waitForTimeout(100);
    expect(stepRequestCount).toBe(1);
    const reviewStep = page.locator(".studio-issue-sessions__step").filter({
      hasText: "Review/deslop"
    });
    await expect(reviewStep).toContainText("Done: Review/deslop");
    await expect(reviewStep.getByRole("button", { name: "Start task" })).toBeVisible();
  });

  test("failed user check shows rework notes form before returning to plan made", async ({ page }) => {
    let activeSession = userCheckSessionPayload;
    const stepPayloads: unknown[] = [];

    await page.route("**/api/studio/current-app", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentAppPayload)
      });
    });
    await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 1
          },
          ok: true,
          sessions: [activeSession],
          stepDefinitions: userCheckStepDefinitions
        })
      });
    });
    await mockNpmScripts(page);
    await page.route(`**/api/studio/current-app/issue-sessions/${userCheckSessionId}`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${userCheckSessionId}/step`, async (route) => {
      const payload = route.request().postDataJSON();
      stepPayloads.push(payload);
      activeSession = stepPayloads.length === 1
        ? failedUserCheckSessionPayload
        : reworkStartedSessionPayload;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(activeSession)
      });
    });

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    const activeUserCheckStep = page.locator(".studio-issue-sessions__step").filter({
      hasText: "Goal: User check"
    });
    await expect(activeUserCheckStep.getByRole("button", { name: "Test app" })).toBeVisible();
    await page.getByRole("button", { name: "Failed" }).click();

    await expect.poll(() => stepPayloads.length).toBe(1);
    expect(stepPayloads[0]).toEqual({ userCheck: "failed" });
    await expect(page.getByText(
      "User check failed. Provide rework notes to start a new plan cycle.",
      { exact: true }
    ).first()).toBeVisible();
    const reworkField = page.getByLabel("What needs to be reworked?");
    await expect(reworkField).toBeVisible();
    await expect(page.getByRole("button", { name: "Return to Plan made" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Failed" })).toHaveCount(0);

    await reworkField.fill("The health endpoint returns the wrong status code.");
    await page.getByRole("button", { name: "Return to Plan made" }).click();

    await expect.poll(() => stepPayloads.length).toBe(2);
    expect(stepPayloads[1]).toEqual({
      reworkNotes: "The health endpoint returns the wrong status code.",
      userCheck: "failed"
    });
    const planMadeStep = page.locator(".studio-issue-sessions__step").filter({
      hasText: "Plan made"
    });
    await expect(planMadeStep).toContainText("Goal: Plan made");
    await expect(planMadeStep).toContainText("Rework request: The health endpoint returns the wrong status code.");
    await expect(page.getByLabel("Plan")).toHaveCount(0);
    await expect(page.getByText(
      "Codex writes a revised implementation plan from the user's rework notes for this cycle."
    )).toBeVisible();
    const userCheckStep = page.locator(".studio-issue-sessions__step").filter({
      hasText: "User check"
    });
    await expect(userCheckStep.locator(".studio-issue-sessions__step-description")).toHaveCount(0);
    await expect(userCheckStep).toHaveAttribute("title", "Record whether the user's manual check passed.");
  });

  test("codex thread capture runs even before a Codex workflow step", async ({ page }) => {
    const codexSessions = await mockCodexPromptSessions(page, [
      nonCodexStepSessionPayload
    ]);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);

    await expect.poll(() => codexSessions.terminalStarts[nonCodexStepSessionId]).toBe(1);
    await expect.poll(() => codexSessions.terminalInputs[nonCodexStepSessionId].length).toBe(6);
    expect(codexSessions.terminalInputs[nonCodexStepSessionId]).toEqual(codexShellSubmitSequence);
  });

  test("codex terminal recovers when the server loses the terminal session", async ({ page }) => {
    const codexSessions = await mockCodexPromptSessions(page, [
      codexPromptSessionPayload
    ]);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await expect.poll(() => codexSessions.terminalStarts[codexPromptSessionId]).toBe(1);

    await page.evaluate((sessionId) => {
      (window as unknown as {
        __studioFailCodexTerminal: (input: { sessionId: string }) => void;
      }).__studioFailCodexTerminal({ sessionId });
    }, codexPromptSessionId);

    await expect.poll(() => codexSessions.terminalStarts[codexPromptSessionId]).toBe(2);
    await expect(page.getByText("Terminal session not found.")).toHaveCount(0);
    await expect(page.locator(".xterm-rows").first()).toContainText(`Codex ready for ${codexPromptSessionId}.`);

    await page.locator(".codex-terminal__host").first().click();
    await page.keyboard.type("after restart");
    await page.waitForTimeout(500);
    expect(codexSessions.terminalInputs[codexPromptSessionId].join("")).toContain("after restart");
  });

  test("switching sessions keeps each Codex terminal alive", async ({ page }) => {
    const codexSessions = await mockTwoCodexPromptSessions(page);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);

    await expect.poll(() => codexSessions.terminalStarts[codexPromptSessionId]).toBe(1);
    await expect.poll(() => codexSessions.terminalInputs[codexPromptSessionId].length).toBe(6);
    expect(codexSessions.terminalInputs[codexPromptSessionId]).toEqual(codexShellSubmitSequence);

    await page.locator(".studio-issue-sessions__tab-chip").filter({ hasText: "01-03-40" }).click();
    await expect(page.getByText("01-03-40").first()).toBeVisible();
    await expect.poll(() => codexSessions.terminalStarts[secondCodexPromptSessionId]).toBe(1);
    await expect.poll(() => codexSessions.terminalInputs[secondCodexPromptSessionId].length).toBe(6);
    expect(codexSessions.terminalInputs[secondCodexPromptSessionId]).toEqual(codexShellSubmitSequence);

    await page.locator(".studio-issue-sessions__tab-chip").filter({ hasText: "01-02-39" }).click();
    await expect(page.getByText("01-02-39").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Restart Codex" })).toHaveCount(0);
    await page.locator(".codex-terminal__host").first().click();
    await page.keyboard.type("still alive");
    await page.waitForTimeout(500);
    expect(codexSessions.terminalStarts[codexPromptSessionId]).toBe(1);
    expect(codexSessions.terminalStarts[secondCodexPromptSessionId]).toBe(1);
    expect(codexSessions.terminalDeletes[codexPromptSessionId]).toBe(0);
    expect(codexSessions.terminalDeletes[secondCodexPromptSessionId]).toBe(0);
    expect(codexSessions.terminalInputs[codexPromptSessionId].join("")).toContain("still alive");
  });

  test("session creation is disabled after three active sessions", async ({ page }) => {
    await mockCodexPromptSessions(page, [
      codexPromptSessionPayload,
      secondCodexPromptSessionPayload,
      thirdCodexPromptSessionPayload
    ]);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await expect(page.getByRole("button", { name: "New Session" })).toHaveCount(0);
  });

  test("rewinds from an expanded completed issue-session step", async ({ page }) => {
    const sessionId = "2026-05-12_01-06-43";
    const stepDefinitions = [
      { id: "session_created", index: 0, label: "Session created", kind: "system", description: "Create the durable session directory." },
      { id: "worktree_created", index: 1, label: "Worktree created", kind: "command", description: "Prepare the isolated session worktree." },
      { id: "dependencies_installed", index: 2, label: "Dependencies installed", kind: "automatic", description: "Install dependencies in the session worktree." },
      { id: "issue_prompt_rendered", index: 3, label: "Initial issue prompt", kind: "human_input", description: "Capture the developer request." },
      { id: "issue_drafted", index: 4, label: "Issue drafted", kind: "codex_output", description: "Ask Codex to create the GitHub issue." },
      { id: "issue_created", index: 5, label: "Issue created", kind: "automatic", description: "Create the GitHub issue." },
      { id: "issue_details_gathered", index: 6, label: "Issue details gathered", kind: "codex_output", description: "Save confirmed issue details." },
      { id: "plan_made", index: 7, label: "Plan made", kind: "codex_output", repeatable: true, repeatableGroupId: "rework_cycle", repeatableGroupLabel: "Rework cycle", description: "Ask Codex to create an implementation plan." },
      { id: "plan_executed", index: 8, label: "Plan executed", kind: "codex_prompt", repeatable: true, repeatableGroupId: "rework_cycle", repeatableGroupLabel: "Rework cycle", description: "Send the plan to Codex for implementation." }
    ];
    let sessionPayload = {
      ok: true,
      sessionId,
      activeCycle: "002",
      cycles: [
        { cycle: "001", label: "cycle_001", status: "failed", userCheckResult: "failed" },
        { cycle: "002", label: "cycle_002", reworkRequest: "Fix the result.", status: "active", userCheckResult: "" }
      ],
      status: "running",
      currentStep: "plan_executed",
      completedSteps: [
        "session_created",
        "worktree_created",
        "dependencies_installed",
        "issue_prompt_rendered",
        "issue_drafted",
        "issue_created",
        "issue_details_gathered",
        "plan_made"
      ],
      stepDefinitions,
      currentStepAction: {
        buttonLabel: "Get Codex to execute plan",
        input: { type: "none" },
        kind: "codex_prompt",
        stepId: "plan_executed"
      },
      codex: null,
      prompt: "",
      receipts: [],
      issueTitle: "Add rewind",
      issueText: "Add destructive rewind.",
      issueUrl: "https://github.com/merc/example-target-app/issues/127",
      worktree: sessionWorktreePath(sessionId),
      worktreeReady: true
    };
    await page.route("**/api/studio/current-app", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(currentAppPayload) });
    });
    await page.route("**/api/studio/current-app/issue-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: { maxOpenSessions: 3, openSessionCount: 1 },
          ok: true,
          sessions: [sessionPayload],
          stepDefinitions
        })
      });
    });
    await mockNpmScripts(page);
    await page.route(`**/api/studio/current-app/issue-sessions/${sessionId}`, async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(sessionPayload) });
    });
    await page.route(`**/api/studio/current-app/issue-sessions/${sessionId}/rewind`, async (route) => {
      const requestBody = route.request().postDataJSON();
      sessionPayload = {
        ...sessionPayload,
        activeCycle: "001",
        cycles: [{ cycle: "001", label: "cycle_001", status: "active", userCheckResult: "" }],
        currentStep: requestBody.stepId,
        completedSteps: [
          "session_created",
          "worktree_created",
          "dependencies_installed",
          "issue_prompt_rendered",
          "issue_drafted",
          "issue_created",
          "issue_details_gathered"
        ],
        currentStepAction: {
          buttonLabel: "Save plan",
          input: { name: "plan", type: "text" },
          kind: "codex_output",
          stepId: "plan_made"
        }
      };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(sessionPayload) });
    });

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);

    const planStep = page.locator(".studio-issue-sessions__step").filter({ hasText: "Plan made" });
    await expect(planStep.getByRole("button", { name: /^Rewind to /u })).toHaveCount(0);
    await planStep.getByRole("button", { name: "Toggle completed step details" }).click();
    await expect(planStep.getByRole("button", { name: "Rewind to Plan made" })).toBeVisible();

    const worktreeStep = page.locator(".studio-issue-sessions__step").filter({ hasText: "Worktree created" });
    await worktreeStep.getByRole("button", { name: "Toggle completed step details" }).click();
    await expect(worktreeStep.getByRole("button", { name: /^Rewind to /u })).toHaveCount(0);

    await planStep.getByRole("button", { name: "Rewind to Plan made" }).click();
    await expect(page.getByRole("dialog").getByText("all loop and rework history")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Rewind" }).click();
    await expect(page.locator(".studio-issue-sessions__step").filter({ hasText: "Goal: Plan made" })).toBeVisible();
  });

  test("abandoning a session closes its terminal and removes it from the visible list", async ({ page }) => {
    const codexSessions = await mockTwoCodexPromptSessions(page);

    await page.goto(`${BASE_URL}/home`);
    await expectSessionsRoute(page);
    await expect.poll(() => codexSessions.terminalStarts[codexPromptSessionId]).toBe(1);

    await page.getByRole("button", { name: "Abandon selected session" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Abandon" }).click();
    await expect.poll(() => codexSessions.terminalDeletes[codexPromptSessionId]).toBe(1);
    await expect(page.getByRole("button", { name: /01-02-39/u })).toHaveCount(0);
    await expect(page.getByText("01-03-40").first()).toBeVisible();
  });
});

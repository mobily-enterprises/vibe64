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
  return [
    session?.sessionId || "",
    session?.currentStep || "",
    session?.prompt || ""
  ].join(":::");
}

const codexPromptStepDefinitions = [
  {
    id: "session_created",
    index: 0,
    label: "Session created",
    kind: "automatic",
    description: "Create the durable session directory."
  },
  {
    id: "worktree_created",
    index: 1,
    label: "Worktree created",
    kind: "automatic",
    description: "Prepare the isolated session worktree."
  },
  {
    id: "dependencies_installed",
    index: 2,
    label: "Dependencies installed",
    kind: "automatic",
    description: "Install dependencies in the session worktree."
  },
  {
    id: "issue_prompt_rendered",
    index: 3,
    label: "Initial issue prompt",
    kind: "human_input",
    description: "Capture the developer request."
  },
  {
    id: "issue_drafted",
    index: 4,
    label: "Issue drafted",
    kind: "codex_prompt",
    description: "Ask Codex to draft issue.md."
  },
  {
    id: "issue_created",
    index: 5,
    label: "Issue created",
    kind: "automatic",
    description: "Create the GitHub issue."
  },
  {
    id: "plan_made",
    index: 6,
    label: "Plan made",
    kind: "codex_prompt",
    description: "Ask Codex to create an implementation plan in the terminal."
  }
];
const codexPromptSessionPayload = {
  ok: true,
  sessionId: codexPromptSessionId,
  status: "waiting_for_user",
  currentStep: "issue_drafted",
  completedSteps: ["session_created", "worktree_created", "dependencies_installed", "issue_prompt_rendered"],
  stepDefinitions: codexPromptStepDefinitions,
  currentStepAction: {
    stepId: "issue_drafted",
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    buttonLabel: "Record issue draft",
    description: "Codex writes issue.md and issue_title; continue after review.",
    input: { type: "none" }
  },
  codex: {
    autoInject: true,
    mode: "inject_prompt",
    promptField: "prompt",
    promptActionLabel: "Start issue draft"
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
  completedSteps: [...codexPromptSessionPayload.completedSteps, "issue_drafted"],
  codex: null,
  currentStep: "issue_created",
  currentStepAction: {
    stepId: "issue_created",
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
  completedSteps: [...codexIssueDraftedPayload.completedSteps, "issue_created"],
  currentStep: "plan_made",
  currentStepAction: {
    stepId: "plan_made",
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    buttonLabel: "Record plan",
    description: "Codex writes the plan in the terminal; continue after review.",
    input: { type: "none" }
  },
  codex: {
    autoInject: true,
    mode: "inject_prompt",
    promptActionLabel: "Start plan",
    promptField: "prompt"
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
    skipReason: "User skipped Deep UI check.",
    stepId: "deep_ui_check_run"
  },
  codex: null,
  prompt: "",
  receipts: [],
  issueTitle: "Add health endpoint",
  issueText: "Add a server-only health endpoint.",
  issueUrl: "https://github.com/merc/example-target-app/issues/124",
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
      reason: "User skipped Deep UI check.",
      status: "skipped",
      stepId: "deep_ui_check_run"
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
    "plan_made",
    "plan_executed"
  ],
  currentStepAction: {
    ...deepUiSkipSessionPayload.currentStepAction,
    buttonLabel: "Go to next step",
    skipReason: ""
  },
  prompt: "Deep UI quality check prompt for this session.",
  worktree: sessionWorktreePath(deepUiPromptSessionId)
};
const planExecutionRejectSessionId = "2026-05-12_02-06-46";
const planExecutionRejectStepDefinitions = [
  {
    id: "plan_made",
    index: 6,
    label: "Plan made",
    kind: "codex_prompt",
    description: "Codex writes an implementation plan in the terminal."
  },
  {
    id: "plan_executed",
    index: 7,
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
    promptField: "prompt"
  },
  prompt: [
    "Execute the approved implementation plan.",
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
};

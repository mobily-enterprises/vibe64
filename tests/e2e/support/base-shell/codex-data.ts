const codexPromptText = "Create the GitHub issue for the requested Studio session UI.";
const codexPlanPromptText = "Create an implementation plan for the approved GitHub issue.";
const codexPromptSessionId = "2026-05-12_01-02-39";
const secondCodexPromptText = "Create another GitHub issue while the first terminal keeps running.";
const secondCodexPromptSessionId = "2026-05-12_01-03-40";
const thirdCodexPromptText = "Create a third GitHub issue while two terminals keep running.";
const thirdCodexPromptSessionId = "2026-05-12_01-04-41";
const nonCodexStepSessionId = "2026-05-12_01-05-42";
const sessionSourcePath = (sessionId: string) =>
  `/workspace/example-target-app/.jskit/sessions/active/${sessionId}/source`;
const codexPromptStepDefinitions = [
  {
    id: "session_created",
    index: 0,
    label: "Session created",
    kind: "automatic",
    description: "Create the durable session directory."
  },
  {
    id: "source_created",
    index: 1,
    label: "Session clone created",
    kind: "automatic",
    description: "Prepare the isolated session clone."
  },
  {
    id: "dependencies_installed",
    index: 2,
    label: "Dependencies installed",
    kind: "automatic",
    description: "Install dependencies in the session clone."
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
    id: "plan_and_execute",
    index: 6,
    label: "Plan and execute",
    kind: "codex_prompt",
    description: "Ask Codex to create and execute the implementation plan in the terminal."
  }
];
const codexPromptSessionPayload = {
  ok: true,
  sessionId: codexPromptSessionId,
  status: "waiting_for_user",
  currentStep: "issue_drafted",
  completedSteps: ["session_created", "source_created", "dependencies_installed", "issue_prompt_rendered"],
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
  source: sessionSourcePath(codexPromptSessionId),
  sourceReady: true
};
const secondCodexPromptSessionPayload = {
  ...codexPromptSessionPayload,
  sessionId: secondCodexPromptSessionId,
  prompt: secondCodexPromptText,
  source: sessionSourcePath(secondCodexPromptSessionId)
};
const thirdCodexPromptSessionPayload = {
  ...codexPromptSessionPayload,
  sessionId: thirdCodexPromptSessionId,
  prompt: thirdCodexPromptText,
  source: sessionSourcePath(thirdCodexPromptSessionId)
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
  source: sessionSourcePath(nonCodexStepSessionId)
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
  currentStep: "plan_and_execute",
  currentStepAction: {
    stepId: "plan_and_execute",
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
    id: "review_and_validate",
    index: 14,
    label: "Validate project",
    kind: "command",
    description: "Update code index and run checks after review/deslop."
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
  source: sessionSourcePath(deepUiSkipSessionId),
  sourceReady: true
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
    "source_created",
    "dependencies_installed",
    "issue_prompt_rendered",
    "issue_drafted",
    "issue_created",
    "plan_and_execute"
  ],
  currentStepAction: {
    ...deepUiSkipSessionPayload.currentStepAction,
    buttonLabel: "Go to next step",
    skipReason: ""
  },
  prompt: "Deep UI quality check prompt for this session.",
  source: sessionSourcePath(deepUiPromptSessionId)
};
const planExecutionRejectSessionId = "2026-05-12_02-06-46";
const planExecutionRejectStepDefinitions = [
  {
    id: "plan_and_execute",
    index: 6,
    label: "Plan and execute",
    kind: "codex_prompt",
    description: "Codex writes and executes the implementation plan in the terminal."
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
  currentStep: "plan_and_execute",
  completedSteps: [
    "session_created",
    "source_created",
    "dependencies_installed",
    "issue_prompt_rendered",
    "issue_drafted",
    "issue_created"
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
    stepId: "plan_and_execute"
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
  source: sessionSourcePath(planExecutionRejectSessionId),
  sourceReady: true
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
    id: "review_and_validate",
    index: 15,
    label: "Validate project",
    kind: "command",
    description: "Update code index and run checks after review/deslop."
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
  source: sessionSourcePath(reviewDeslopSessionId),
  sourceReady: true
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
  currentStep: "review_and_validate",
  currentStepAction: {
    buttonLabel: "Update code index",
    input: { type: "none" },
    kind: "command",
    label: "Update code index",
    stepId: "review_and_validate"
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
};

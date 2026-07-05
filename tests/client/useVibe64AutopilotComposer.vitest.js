import { nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";

import {
  useVibe64AutopilotComposer
} from "../../src/composables/useVibe64AutopilotComposer.js";

function conversationControl(overrides = {}) {
  return {
    enabled: true,
    id: "talk_to_codex",
    input: {
      answerChoiceSugar: {
        fieldName: "conversationRequest",
        kind: "answer_choices",
        source: "latest_assistant_message"
      },
      questionSugar: {
        fieldName: "conversationRequest",
        kind: "numbered_questions",
        source: "latest_assistant_message"
      }
    },
    inputFields: [
      {
        kind: "textarea",
        label: "Message",
        name: "conversationRequest",
        required: true,
        value: ""
      }
    ],
    label: "Send",
    style: "primary",
    ...overrides
  };
}

describe("useVibe64AutopilotComposer", () => {
  it("selects the primary input control and hides it from workflow controls", async () => {
    const controls = ref([
      conversationControl(),
      {
        enabled: true,
        id: "retry",
        label: "Retry"
      }
    ]);
    const composer = useVibe64AutopilotComposer({
      controls,
      conversationLog: ref({}),
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual(["conversationRequest"]);

    await nextTick();

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual(["conversationRequest"]);
    expect(composer.screenControls.value.map((control) => control.id)).toEqual(["retry"]);
  });

  it("selects a newly available primary input control before the next render tick", async () => {
    const controls = ref([]);
    const composer = useVibe64AutopilotComposer({
      controls,
      conversationLog: ref({}),
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    expect(composer.selectedControl.value).toBeNull();

    controls.value = [
      conversationControl(),
      {
        enabled: true,
        id: "retry",
        label: "Retry"
      }
    ];

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    expect(composer.screenControls.value.map((control) => control.id)).toEqual(["retry"]);

    await nextTick();

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
  });

  it("reselects the default input control after local selection state clears", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([
        conversationControl()
      ]),
      conversationLog: ref({}),
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();
    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");

    composer.clearSelectedControl();
    await nextTick();

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    composer.updateSelectedControlValue("conversationRequest", "Next prompt after turn completion.");
    expect(composer.canSubmitSelectedControl.value).toBe(true);
  });

  it("reselects the default input control when controls resync without local selection", async () => {
    const controls = ref([
      conversationControl(),
      {
        enabled: true,
        id: "retry",
        label: "Retry"
      }
    ]);
    const composer = useVibe64AutopilotComposer({
      controls,
      conversationLog: ref({}),
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();
    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");

    composer.selectedControl.value = null;
    controls.value = [
      ...controls.value
    ];
    await nextTick();

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    composer.updateSelectedControlValue("conversationRequest", "Recovered after controls refreshed.");
    expect(composer.canSubmitSelectedControl.value).toBe(true);
  });

  it("selects the only enabled input control when no primary intent is provided", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([
        {
          enabled: true,
          id: "open_diff",
          label: "Diff"
        },
        conversationControl({
          id: "request_review_tweak",
          label: "Tweak"
        })
      ]),
      conversationLog: ref({}),
      primaryIntentId: ref(""),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControl.value?.id).toBe("request_review_tweak");
    expect(composer.screenControls.value.map((control) => control.id)).toEqual(["open_diff"]);
  });

  it("does not auto-open action fallback controls", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([
        conversationControl({
          autoOpen: false,
          id: "reject_issue_draft",
          label: "Send improvement request"
        })
      ]),
      conversationLog: ref({}),
      primaryIntentId: ref(""),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControl.value).toBeNull();
    expect(composer.screenControls.value.map((control) => control.id)).toEqual(["reject_issue_draft"]);

    await composer.activateControl(composer.screenControls.value[0]);

    expect(composer.selectedControl.value?.id).toBe("reject_issue_draft");
    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual(["conversationRequest"]);
  });

  it("does not guess a default when multiple enabled input controls are available", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([
        conversationControl({
          id: "request_review_tweak",
          label: "Tweak"
        }),
        conversationControl({
          id: "reject",
          label: "Reject"
        })
      ]),
      conversationLog: ref({}),
      primaryIntentId: ref(""),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControl.value).toBeNull();
    expect(composer.screenControls.value.map((control) => control.id)).toEqual([
      "request_review_tweak",
      "reject"
    ]);
  });

  it("does not open a secondary improvement input control by default", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([
        {
          enabled: true,
          id: "continue_step",
          label: "Use this description",
          style: "primary"
        },
        conversationControl({
          id: "reject_issue_draft",
          label: "Send improvement request",
          style: "secondary"
        })
      ]),
      conversationLog: ref({}),
      primaryIntentId: ref(""),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControl.value).toBeNull();
    expect(composer.screenControls.value.map((control) => control.id)).toEqual([
      "continue_step",
      "reject_issue_draft"
    ]);

    await composer.activateControl(composer.screenControls.value[1]);

    expect(composer.selectedControl.value?.id).toBe("reject_issue_draft");
    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual(["conversationRequest"]);
  });

  it("clears a consumed secondary improvement draft after the submitted text appears", async () => {
    const conversationLog = ref({
      turns: []
    });
    const controls = ref([
      {
        enabled: true,
        id: "continue_step",
        label: "Use this description",
        style: "primary"
      },
      {
        enabled: true,
        id: "reject_issue_draft",
        inputFields: [
          {
            kind: "textarea",
            label: "What should change?",
            name: "feedback",
            required: true,
            value: ""
          }
        ],
        label: "Send improvement request",
        style: "secondary"
      }
    ]);
    const composer = useVibe64AutopilotComposer({
      controls,
      conversationLog,
      primaryIntentId: ref(""),
      running: ref(false)
    });

    await nextTick();
    await composer.activateControl(composer.screenControls.value[1]);
    composer.updateSelectedControlValue("feedback", "Make the acceptance criteria stricter.");

    expect(composer.selectedControl.value?.id).toBe("reject_issue_draft");
    expect(composer.canSubmitSelectedControl.value).toBe(true);

    conversationLog.value = {
      turns: [
        {
          turnId: "000001",
          user: {
            text: "Make the acceptance criteria stricter."
          }
        }
      ]
    };
    await nextTick();

    expect(composer.selectedControl.value).toBeNull();
    expect(composer.screenControls.value.map((control) => control.id)).toEqual([
      "continue_step",
      "reject_issue_draft"
    ]);
  });

  it("closes a secondary improvement input after a successful submission", async () => {
    const submitted = [];
    const composer = useVibe64AutopilotComposer({
      controls: ref([
        {
          enabled: true,
          id: "continue_step",
          label: "Use this description",
          style: "primary"
        },
        {
          enabled: true,
          id: "reject_issue_draft",
          inputFields: [
            {
              kind: "textarea",
              label: "What should change?",
              name: "feedback",
              required: true,
              value: ""
            }
          ],
          label: "Send improvement request",
          style: "secondary"
        }
      ]),
      conversationLog: ref({}),
      onRunControl: async (control, options) => {
        submitted.push({
          controlId: control.id,
          fields: options.fields
        });
        return true;
      },
      primaryIntentId: ref(""),
      running: ref(false)
    });

    await nextTick();
    await composer.activateControl(composer.screenControls.value[1]);
    composer.updateSelectedControlValue("feedback", "Make the acceptance criteria stricter.");

    expect(await composer.submitSelectedControl()).toBe(true);

    expect(submitted).toEqual([
      {
        controlId: "reject_issue_draft",
        fields: {
          feedback: "Make the acceptance criteria stricter."
        }
      }
    ]);
    expect(composer.selectedControl.value).toBeNull();
    expect(composer.screenControls.value.map((control) => control.id)).toEqual([
      "continue_step",
      "reject_issue_draft"
    ]);
  });

  it("does not select a disabled input control by default", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([
        conversationControl({
          enabled: false,
          id: "request_review_tweak",
          label: "Tweak"
        })
      ]),
      conversationLog: ref({}),
      primaryIntentId: ref(""),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControl.value).toBeNull();
    expect(composer.screenControls.value.map((control) => control.id)).toEqual(["request_review_tweak"]);
  });

  it("keeps the primary input control visible when it is temporarily disabled", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([
        conversationControl({
          enabled: false
        }),
        {
          enabled: true,
          id: "next_step",
          label: "Next step"
        }
      ]),
      conversationLog: ref({}),
      isControlDisabled: (control) => control.enabled !== true,
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    expect(composer.canSubmitSelectedControl.value).toBe(false);
    expect(composer.screenControls.value.map((control) => control.id)).toEqual(["next_step"]);
  });

  it("submits numbered Codex questions as one conversationRequest field", async () => {
    let submitted = null;
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog: ref({
        turns: [
          {
            assistant: {
              text: [
                "[1] Which file should change?",
                "[2] What should it contain?"
              ].join("\n")
            }
          }
        ]
      }),
      onRunControl: async (_control, options) => {
        submitted = options;
        return true;
      },
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual([
      "__ui_question_1",
      "__ui_question_2"
    ]);
    expect(composer.selectedControlUsesLatestAssistantQuestions.value).toBe(true);

    composer.updateSelectedControlValue("__ui_question_1", "src/App.vue");
    composer.updateSelectedControlValue("__ui_question_2", "Add the banner");

    expect(await composer.submitSelectedControl()).toBe(true);
    expect(submitted.fields).toEqual({
      conversationRequest: "[1] src/App.vue\n[2] Add the banner"
    });
  });

  it("submits a clicked Codex answer choice as one conversationRequest field", async () => {
    let submitted = null;
    let optimistic = null;
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog: ref({
        turns: [
          {
            assistant: {
              text: [
                "Will people sign in with accounts, or can anyone use the app without logging in?",
                "",
                "Possible answers:",
                "- Yes, users: I want people to sign in and have accounts.",
                "- No, no users: I do not want login for this app."
              ].join("\n")
            }
          }
        ]
      }),
      onDraftSubmissionStart: (payload) => {
        optimistic = payload;
        return "optimistic-choice";
      },
      onRunControl: async (_control, options) => {
        submitted = options;
        return true;
      },
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControlUsesLatestAssistantAnswerChoices.value).toBe(true);
    expect(composer.selectedControlFields.value).toEqual([
      expect.objectContaining({
        choices: [
          {
            label: "Yes, users",
            value: "I want people to sign in and have accounts."
          },
          {
            label: "No, no users",
            value: "I do not want login for this app."
          }
        ],
        kind: "answer_choices",
        name: "__ui_answer_choice"
      })
    ]);

    expect(await composer.submitSelectedAnswerChoice({
      label: "Yes, users",
      value: "I want people to sign in and have accounts."
    })).toBe(true);

    expect(submitted.fields).toEqual({
      conversationRequest: "I want people to sign in and have accounts."
    });
    expect(submitted).not.toHaveProperty("displayFields");
    expect(optimistic.fields).toEqual({
      conversationRequest: "I want people to sign in and have accounts."
    });
    expect(submitted.fields).not.toHaveProperty("__ui_answer_choice");
  });

  it("falls back from Codex answer choices to normal free text", async () => {
    let submitted = null;
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog: ref({
        turns: [
          {
            assistant: {
              text: [
                "Will people sign in with accounts?",
                "",
                "Possible answers:",
                "- Yes, users: I want people to sign in and have accounts.",
                "- No, no users: I do not want login for this app."
              ].join("\n")
            }
          }
        ]
      }),
      onRunControl: async (_control, options) => {
        submitted = options;
        return true;
      },
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControlFields.value.map((field) => field.kind)).toEqual(["answer_choices"]);
    expect(composer.useFreeTextForAnswerChoice()).toBe(true);
    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual(["conversationRequest"]);

    composer.updateSelectedControlValue("conversationRequest", "Ask me differently.");
    expect(await composer.submitSelectedControl()).toBe(true);

    expect(submitted.fields).toEqual({
      conversationRequest: "Ask me differently."
    });
  });

  it("renders numbered-question batches before trailing answer-choice hints", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog: ref({
        turns: [
          {
            assistant: {
              text: [
                "[1] Should people sign in?",
                "[2] Should this include AI?",
                "",
                "Possible answers:",
                "- Yes: Yes.",
                "- No: No."
              ].join("\n")
            }
          }
        ]
      }),
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual([
      "__ui_question_1",
      "__ui_question_2"
    ]);
    expect(composer.selectedControlFields.value.map((field) => field.kind)).toEqual(["text", "text"]);
  });

  it("reads numbered Codex questions from ordered messages in a combined conversation turn", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog: ref({
        turns: [
          {
            assistant: {
              text: [
                "[1] What should the app be called?",
                "[2] Should people sign in?",
                "[3] Will each customer need a private area?"
              ].join("\n")
            },
            messages: [
              {
                role: "user",
                text: "Let's talk about my new project."
              },
              {
                role: "thinking",
                text: "Clarifying setup details."
              },
              {
                role: "assistant",
                text: [
                  "[1] What should the app be called?",
                  "[2] Should people sign in?",
                  "[3] Will each customer need a private area?"
                ].join("\n")
              }
            ],
            user: {
              text: "Let's talk about my new project."
            }
          }
        ]
      }),
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual([
      "__ui_question_1",
      "__ui_question_2",
      "__ui_question_3"
    ]);
    expect(composer.selectedControlFields.value.map((field) => field.kind)).toEqual(["text", "text", "text"]);
  });

  it("keeps latest-assistant question ownership while the assistant message is not parseable yet", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog: ref({}),
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControlUsesLatestAssistantQuestions.value).toBe(true);
    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual(["conversationRequest"]);
  });

  it("clears the submitted input immediately while a turn is running", async () => {
    const controls = ref([conversationControl()]);
    const running = ref(false);
    let resolveRun = null;
    const runPromise = new Promise((resolve) => {
      resolveRun = resolve;
    });
    const composer = useVibe64AutopilotComposer({
      controls,
      conversationLog: ref({}),
      onRunControl: async () => {
        running.value = true;
        controls.value = [];
        return await runPromise;
      },
      primaryIntentId: ref("talk_to_codex"),
      running
    });

    await nextTick();
    composer.updateSelectedControlValue("conversationRequest", "Explain the app.");

    const submitPromise = composer.submitSelectedControl();
    await nextTick();

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    expect(composer.selectedControlValues.value.conversationRequest).toBe("");
    expect(composer.canSubmitSelectedControl.value).toBe(false);

    composer.updateSelectedControlValue("conversationRequest", "Next question.");
    expect(composer.selectedControlValues.value.conversationRequest).toBe("Next question.");

    resolveRun(true);
    expect(await submitPromise).toBe(true);

    running.value = false;
    await nextTick();

    expect(composer.selectedControl.value).toBeNull();
  });

  it("allows the selected control to submit while running only through an explicit predicate", async () => {
    const submitted = [];
    const composer = useVibe64AutopilotComposer({
      canSubmitWhileRunning: (control) => control?.id === "talk_to_codex",
      controls: ref([conversationControl()]),
      conversationLog: ref({}),
      onRunControl: async (_control, options) => {
        submitted.push(options.fields);
        return true;
      },
      primaryIntentId: ref("talk_to_codex"),
      running: ref(true)
    });

    await nextTick();
    composer.updateSelectedControlValue("conversationRequest", "Keep going.");

    expect(composer.canSubmitSelectedControl.value).toBe(true);
    expect(await composer.submitSelectedControl()).toBe(true);
    expect(submitted).toEqual([
      {
        conversationRequest: "Keep going."
      }
    ]);
  });

  it("clears a remote draft when the same text appears as a submitted conversation turn", async () => {
    const conversationLog = ref({
      turns: []
    });
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog,
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();
    composer.restoreControlDraft(conversationControl(), {
      conversationRequest: "This is a test"
    });

    expect(composer.selectedControlValues.value.conversationRequest).toBe("This is a test");
    expect(composer.canSubmitSelectedControl.value).toBe(true);

    conversationLog.value = {
      turns: [
        {
          turnId: "000001",
          user: {
            text: "This is a test"
          }
        }
      ]
    };
    await nextTick();

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    expect(composer.selectedControlValues.value.conversationRequest).toBe("");
    expect(composer.canSubmitSelectedControl.value).toBe(false);
  });

  it("clears a consumed numbered-question draft after its submitted conversationRequest appears", async () => {
    const conversationLog = ref({
      turns: [
        {
          assistant: {
            text: "[1] Which file?\n[2] What change?"
          }
        }
      ]
    });
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog,
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();
    composer.updateSelectedControlValue("conversationRequest", "[1] src/App.vue\n[2] Add the banner");

    expect(composer.canSubmitSelectedControl.value).toBe(true);

    conversationLog.value = {
      turns: [
        {
          assistant: {
            text: "[1] Which file?\n[2] What change?"
          },
          turnId: "000001"
        },
        {
          turnId: "000002",
          user: {
            text: "[1] src/App.vue\n[2] Add the banner"
          }
        }
      ]
    };
    await nextTick();

    expect(composer.selectedControlValues.value).toEqual({
      conversationRequest: ""
    });
    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual(["conversationRequest"]);
    expect(composer.canSubmitSelectedControl.value).toBe(false);
  });

  it("does not render latest assistant questions after a later user answer", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog: ref([
        {
          assistant: {
            text: "[1] Which file?\n[2] What change?"
          },
          turnId: "000001"
        },
        {
          turnId: "000002",
          user: {
            text: "[1] src/App.vue\n[2] Add the banner"
          }
        }
      ]),
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual(["conversationRequest"]);
    expect(composer.selectedControlValues.value.conversationRequest).toBe("");
    expect(composer.canSubmitSelectedControl.value).toBe(false);
  });

  it("keeps an unrelated local draft when another submitted turn arrives", async () => {
    const conversationLog = ref({
      turns: []
    });
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog,
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();
    composer.updateSelectedControlValue("conversationRequest", "My local edit");

    conversationLog.value = {
      turns: [
        {
          turnId: "000001",
          user: {
            text: "Submitted elsewhere"
          }
        }
      ]
    };
    await nextTick();

    expect(composer.selectedControlValues.value.conversationRequest).toBe("My local edit");
    expect(composer.canSubmitSelectedControl.value).toBe(true);
  });

  it("leaves an optimistically submitted failed draft out of the input", async () => {
    const rejected = vi.fn();
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog: ref({}),
      onDraftSubmissionRejected: rejected,
      onDraftSubmissionStart: () => "optimistic-1",
      onRunControl: async () => false,
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();
    composer.updateSelectedControlValue("conversationRequest", "Try this.");

    expect(await composer.submitSelectedControl()).toBe(false);

    expect(rejected).toHaveBeenCalledWith("optimistic-1", expect.objectContaining({
      fields: {
        conversationRequest: "Try this."
      }
    }));
    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    expect(composer.selectedControlValues.value.conversationRequest).toBe("");
  });

  it("restores the draft when a non-optimistic submission is rejected", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog: ref({}),
      onRunControl: async () => false,
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();
    composer.updateSelectedControlValue("conversationRequest", "Keep this.");

    expect(await composer.submitSelectedControl()).toBe(false);

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    expect(composer.selectedControlValues.value.conversationRequest).toBe("Keep this.");
  });

  it("adds attachment references to submitted fields without changing the visible input value", async () => {
    let submitted = null;
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl()]),
      conversationLog: ref({}),
      onRunControl: async (_control, options) => {
        submitted = options;
        return true;
      },
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();
    composer.updateSelectedControlValue("conversationRequest", "Please read this.");

    expect(await composer.submitSelectedControl({
      attachmentFields: {
        conversationRequest: [
          {
            containerPath: "/studio-attachments/session/file.pdf",
            fileName: "file.pdf",
            size: 2048
          }
        ]
      }
    })).toBe(true);

    expect(submitted.fields.conversationRequest).toBe([
      "Please read this.",
      "",
      "Attached files for Codex:",
      "- file.pdf (2.0 KB): /studio-attachments/session/file.pdf"
    ].join("\n"));
    expect(submitted.displayFields.conversationRequest).toBe([
      "Please read this.",
      "",
      "file.pdf"
    ].join("\n"));
  });

  it("submits private values while keeping draft and display fields public", async () => {
    let submitted = null;
    let optimistic = null;
    const composer = useVibe64AutopilotComposer({
      controls: ref([
        conversationControl({
          input: null,
          inputFields: [
            {
              kind: "password",
              label: "API key",
              name: "apiKey",
              privacy: "private",
              required: true,
              value: ""
            },
            {
              kind: "text",
              label: "Environment",
              name: "environment",
              required: true,
              value: ""
            }
          ]
        })
      ]),
      conversationLog: ref({}),
      onDraftSubmissionStart: (payload) => {
        optimistic = payload;
        return "optimistic-private";
      },
      onRunControl: async (_control, options) => {
        submitted = options;
        return true;
      },
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();
    composer.updateSelectedControlValue("apiKey", "sk-client-secret");
    composer.updateSelectedControlValue("environment", "staging");

    expect(composer.selectedControlDisplayValues.value).toEqual({
      environment: "staging"
    });
    expect(await composer.submitSelectedControl()).toBe(true);

    expect(submitted.fields).toEqual({
      apiKey: "sk-client-secret",
      environment: "staging"
    });
    expect(submitted.displayFields).toEqual({
      environment: "staging"
    });
    expect(optimistic.fields).toEqual({
      environment: "staging"
    });
    expect(JSON.stringify(optimistic)).not.toContain("sk-client-secret");
  });

  it("does not infer numbered question behavior without server input metadata", async () => {
    const composer = useVibe64AutopilotComposer({
      controls: ref([conversationControl({
        input: null
      })]),
      conversationLog: ref({
        turns: [
          {
            assistant: {
              text: "[1] First?\n[2] Second?"
            }
          }
        ]
      }),
      primaryIntentId: ref("talk_to_codex"),
      running: ref(false)
    });

    await nextTick();

    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual(["conversationRequest"]);
    expect(composer.selectedControlUsesLatestAssistantQuestions.value).toBe(false);
    expect(composer.selectedControlUsesLatestAssistantAnswerChoices.value).toBe(false);
  });
});

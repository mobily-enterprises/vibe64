import { nextTick, ref } from "vue";
import { describe, expect, it } from "vitest";

import {
  useVibe64AutopilotComposer
} from "../../src/composables/useVibe64AutopilotComposer.js";

function conversationControl(overrides = {}) {
  return {
    enabled: true,
    id: "talk_to_codex",
    input: {
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

    await nextTick();

    expect(composer.selectedControl.value?.id).toBe("talk_to_codex");
    expect(composer.selectedControlFields.value.map((field) => field.name)).toEqual(["conversationRequest"]);
    expect(composer.screenControls.value.map((control) => control.id)).toEqual(["retry"]);
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

    composer.updateSelectedControlValue("__ui_question_1", "src/App.vue");
    composer.updateSelectedControlValue("__ui_question_2", "Add the banner");

    expect(await composer.submitSelectedControl()).toBe(true);
    expect(submitted.fields).toEqual({
      conversationRequest: "[1] src/App.vue\n[2] Add the banner"
    });
    expect(submitted.fields).not.toHaveProperty("__ui_question_1");
    expect(submitted.fields).not.toHaveProperty("__ui_question_2");
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
  });
});

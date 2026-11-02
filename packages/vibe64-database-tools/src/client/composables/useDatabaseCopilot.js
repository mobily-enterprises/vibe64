import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { useAssistantConversation } from "@jskit-ai/assistant-runtime/client";
import { computed } from "vue";

/**
 * The database copilot's conversation, bound to the session's bounded assistant command. Each question carries the
 * table in view: the Data view's table, or the table selected in the Overview or ERD diagram. An answer's last query
 * result replaces the Data result only when the question was about the table Data still shows.
 * @param {{
 *   activeView: import("vue").Ref<string>,
 *   assistantCommand: Record<string, any>,
 *   assistantEndpoint: import("vue").ComputedRef<string>,
 *   diagramSelections: { overview: string, erd: string },
 *   queryResult: import("vue").Ref<Record<string, any> | null>,
 *   rememberSelectedTableState: () => void,
 *   schema: import("vue").ComputedRef<Record<string, any>>,
 *   selectedTableName: import("vue").Ref<string>,
 *   sessionId: () => string,
 *   state: import("vue").ComputedRef<Record<string, any> | null>
 * }} options
 */
function useDatabaseCopilot({
  activeView,
  assistantCommand,
  assistantEndpoint,
  diagramSelections,
  queryResult,
  rememberSelectedTableState,
  schema,
  selectedTableName,
  sessionId,
  state
}) {
  const assistantConfigured = computed(() => Boolean(state.value?.assistant?.available));
  const assistantStatusLabel = computed(() => {
    const assistant = state.value?.assistant;
    if (!assistantConfigured.value) return "Unavailable";
    return vibe64AssistantSelectionLabel({ engineId: assistant.engineId, modelId: assistant.model, variantId: assistant.variantId });
  });
  const assistantUnavailableCopy = computed(() => {
    return state.value?.assistant?.message || "Ask the owner to choose an Explain & check model in Models. Database browsing and editing work without AI.";
  });
  const assistantTableName = computed(() => {
    const name = activeView.value === "data" ? selectedTableName.value : diagramSelections[activeView.value];
    return schema.value.tables.some((table) => table.qualifiedName === name) ? name : "";
  });

  const assistantBinding = useAssistantConversation({
    boundedTask: {
      command: assistantCommand,
      endpoint: assistantEndpoint,
      scope: sessionId,
      input: messages => ({ messages: messages.map(({ content: text, role, table }) => ({ content: text, role, table })) }),
      result: result => ({ content: result.answer, intent: result.intent, role: "assistant", sql: result.sql }),
      onResult(result, { message: { table } }) {
        const lastQuery = result.queries?.at(-1)?.result;
        if (lastQuery && activeView.value === "data" && table === selectedTableName.value) {
          queryResult.value = lastQuery;
          rememberSelectedTableState();
        }
      }
    },
    active: assistantConfigured,
    data: () => ({ table: assistantTableName.value }),
    presentation: computed(() => ({
      assistantLabel: "Copilot", visible: true, variant: "task",
      submitOnEnter: false, submitOnModifierEnter: true,
      placeholder: assistantTableName.value ? "Ask about this table…" : "Ask about this database…",
      ariaLabel: "Message database copilot",
      submitAriaLabel: "Ask database copilot"
    }))
  });

  return {
    assistantAdapter: assistantBinding.adapter,
    assistantBinding,
    assistantConfigured,
    assistantStatusLabel,
    assistantTableName,
    assistantUnavailableCopy
  };
}

export { useDatabaseCopilot };

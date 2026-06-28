import { computed, reactive, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  mdiChevronDown,
  mdiTools
} from "@mdi/js";
import {
  useVibe64FixCodexDialog
} from "@/composables/useVibe64FixCodexDialog.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  useStoredSelection
} from "@/composables/useStoredSelection.js";
import {
  vibe64ProjectQueryScope
} from "@/lib/vibe64ProjectScope.js";
import {
  VIBE64_TOOLS_ENDPOINT
} from "@/lib/vibe64SessionApi.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  VIBE64_API_SUFFIX,
  selectedSessionStorageKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  VIBE64_PROJECT_CHANGED_EVENT
} from "@/lib/studioGateApi.js";

const vibe64ProjectToolsEmits = [
  "global-codex-open",
  "global-codex-update"
];
const vibe64ProjectToolsProps = {
  displayMode: {
    default: "menu",
    type: String
  }
};

function useVibe64ProjectTools(props, emit) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
  const sessionSelection = useStoredSelection({
    storageKey: computed(() => selectedSessionStorageKey(projectSlug.value))
  });
  const selectedSessionId = sessionSelection.selectedId;
  const menuOpen = ref(false);
  const selectedTool = ref(null);
  const parametersDialogOpen = ref(false);
  const confirmationDialogOpen = ref(false);
  const terminalDialogOpen = ref(false);
  const terminalTool = ref(null);
  const terminalStartKey = ref("");
  const runParameters = ref({});
  const parameterValues = reactive({});
  const {
    fixDialogOpen,
    fixJob,
    fixTerminal,
    openFixCodexDialog
  } = useVibe64FixCodexDialog();
  const sourceSelectionInput = computed(() => {
    const sessionId = String(selectedSessionId.value || "").trim();
    return sessionId ? { sessionId } : {};
  });
  const toolsResource = useEndpointResource({
    fallbackLoadError: "Project tools could not load.",
    path: VIBE64_TOOLS_ENDPOINT,
    queryKey: computed(() => [
      "vibe64",
      ...vibe64ProjectQueryScope(projectSlug.value),
      "project-tools",
      selectedSessionId.value || "project"
    ]),
    readQuery: sourceSelectionInput,
    refreshOnPull: true,
    requestRecoveryLabel: "Project tools",
    realtime: {
      event: VIBE64_PROJECT_CHANGED_EVENT
    }
  });
  const runPromptToolCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/tools",
    buildCommandOptions: (_model, { context }) => ({
      method: "POST",
      path: `${VIBE64_TOOLS_ENDPOINT}/${encodeURIComponent(context.toolId || "")}/run`
    }),
    buildRawPayload: (_model, { context }) => ({
      parameters: context.parameters || {},
      ...sourceSelectionInputFromContext(context)
    }),
    fallbackRunError: "Project tool could not run.",
    messages: {
      error: "Project tool could not run.",
      success: "Project tool ran."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.project-tools.run",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const selectedToolParameters = computed(() => (
    Array.isArray(selectedTool.value?.parameters) ? selectedTool.value.parameters : []
  ));
  const displayMode = computed(() => props.displayMode === "panel" ? "panel" : "menu");
  const vibe64ApiPath = computed(() => paths.api(VIBE64_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const menuMode = computed(() => displayMode.value === "menu");
  const loading = computed(() => toolsResource.isFetching.value);
  const tools = computed(() => Array.isArray(toolsResource.data.value?.tools) ? toolsResource.data.value.tools : []);
  const runActionInput = computed(() => ({
    parameters: runParameters.value,
    ...sourceSelectionInput.value
  }));
  const handleFixRequested = openFixCodexDialog;

  return {
    confirmationDialogOpen,
    confirmRun,
    displayMode,
    fixDialogOpen,
    fixJob,
    fixTerminal,
    handleFixRequested,
    loading,
    mdiChevronDown,
    mdiTools,
    menuMode,
    menuOpen,
    parameterValues,
    parametersDialogOpen,
    refreshTools,
    runActionInput,
    selectedTool,
    selectedToolParameters,
    selectTool,
    submitParameters,
    terminalDialogOpen,
    terminalStartKey,
    terminalTool,
    vibe64ApiPath,
    tools
  };

  async function refreshTools() {
    if (loading.value) {
      return;
    }
    await toolsResource.reload();
  }

  function resetParameterValues(tool = {}) {
    for (const key of Object.keys(parameterValues)) {
      delete parameterValues[key];
    }
    for (const parameter of Array.isArray(tool.parameters) ? tool.parameters : []) {
      parameterValues[parameter.id] = parameter.defaultValue ?? "";
    }
  }

  function selectTool(tool = {}) {
    if (tool.enabled !== true) {
      return;
    }
    selectedTool.value = tool;
    resetParameterValues(tool);
    menuOpen.value = false;
    if (selectedToolParameters.value.length) {
      parametersDialogOpen.value = true;
      return;
    }
    queueRun({});
  }

  function submitParameters() {
    parametersDialogOpen.value = false;
    queueRun({ ...parameterValues });
  }

  function queueRun(parameters = {}) {
    runParameters.value = parameters;
    if (selectedTool.value?.requiresConfirmation) {
      confirmationDialogOpen.value = true;
      return;
    }
    void runSelectedTool();
  }

  function confirmRun() {
    confirmationDialogOpen.value = false;
    void runSelectedTool();
  }

  async function runSelectedTool() {
    const tool = selectedTool.value;
    if (!tool?.id) {
      return;
    }
    if (tool.type === "prompt") {
      const response = await runPromptToolCommand.run({
        parameters: runParameters.value,
        ...sourceSelectionInput.value,
        toolId: tool.id
      });
      if (response?.ok !== false) {
        emit("global-codex-update", response);
        emit("global-codex-open");
      }
      return;
    }
    terminalTool.value = tool;
    terminalStartKey.value = `${tool.id}:${Date.now()}`;
    terminalDialogOpen.value = true;
  }
}

function sourceSelectionInputFromContext(context = {}) {
  const sessionId = String(context.sessionId || "").trim();
  const sourcePath = String(context.sourcePath || "").trim();
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(sourcePath ? { sourcePath } : {})
  };
}

export {
  sourceSelectionInputFromContext,
  useVibe64ProjectTools,
  vibe64ProjectToolsEmits,
  vibe64ProjectToolsProps
};

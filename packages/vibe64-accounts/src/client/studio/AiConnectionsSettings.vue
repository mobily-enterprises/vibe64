<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDisplay } from "vuetify";
import CodexProviderConnections from "./CodexProviderConnections.vue";
import ModelRoutingForm from "./ModelRoutingForm.vue";
import ProviderAccountsSetup from "./ProviderAccountsSetup.vue";
import { useCodexProviderConnections } from "../composables/useCodexProviderConnections.js";
import { useVibe64Accounts } from "../composables/useVibe64Accounts.js";
import {
  AI_CONNECTIONS_ENDPOINT
} from "../lib/accountsGateApi.js";
import {
  mdiAccountCircleOutline,
  mdiArrowLeft,
  mdiCheck,
  mdiClose,
  mdiCreditCardOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiLockOutline,
  mdiMagnify,
  mdiOpenInNew,
  mdiPlus,
  mdiRefresh,
  mdiRobotOutline,
  mdiShieldCheckOutline,
  mdiStopCircleOutline
} from "@mdi/js";

import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { useAiConnections } from "../composables/useAiConnections.js";
import FreeAiSelector from "./FreeAiSelector.vue";
import { REGULAR_ZAI_STARTER } from "./freeAiStarters.js";

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PROVIDER_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const props = defineProps({
  endpoint: { type: String, default: AI_CONNECTIONS_ENDPOINT },
  isOwner: {
    default: false,
    type: Boolean
  },
  onboarding: {
    default: false,
    type: Boolean
  }
});

const emit = defineEmits(["changed", "connected", "busy"]);
const route = useRoute();
const router = useRouter();
const { smAndDown } = useDisplay();
const addAiOpen = ref(false);
const nativeSetupOpen = ref(false);
const nativeSetupProviderId = ref("codex");
const nativeSetupActivator = ref(null);
const editorActivator = ref(null);
const nativeRemoving = ref(false);
const onboardingSelector = ref(null);
const zeroStateSelector = ref(null);
const providerPickerOpen = ref(false);
const providerPickerPending = ref(false);
const providerSearch = ref("");
const catalogProviderId = ref("");
const preparedChoice = ref(null);
const preparingProviderId = ref("");
const catalogPreparationError = ref("");
const editorOpen = ref(false);
const routingOpen = ref(false);
const routingSaving = ref(false);
const editorRoutingPending = ref(false);
const editorRoutingSetupError = ref("");
const nativeRoutingReady = ref(false);
const editorOrigin = ref("direct");
const editorStarter = ref(null);
const editorStarterSurface = ref("");
const editorProviderId = ref("");
const editorProviderRevision = ref("");
const editorLabel = ref("");
const editorApiKey = ref("");
const editorApiKeyVisible = ref(false);
const editorError = ref("");
const removeOpen = ref(false);
const removeTarget = ref(null);
const modelAccessConfirmOpen = ref(false);
const modelAccessTarget = ref(null);
const refreshingAll = ref(false);
let hydratedRequestIdentity = "";
let providerPreparationId = 0;
let zenProgressDisposed = false;
let zenProgressTimer = null;

const nativeAccounts = useVibe64Accounts();
const codexProviders = useCodexProviderConnections({ enabled: computed(() => props.isOwner) });
const codexModelProviderId = ref("openai");
const codexProviderSaving = ref(false);

const {
  catalogEngine,
  catalogLoadError,
  catalogProvider,
  connections,
  isInitialLoading,
  loadError,
  reload,
  reloadCatalog,
  reloadRegistry,
  removeConnection,
  removingProviderId,
  registryIsFetching,
  registryIsInitialLoading,
  registryLoadError,
  registryProviders,
  saveConnection,
  savingProviderId,
  updateModelAccess,
  updatingModelAccessProviderId
} = useAiConnections({
  endpoint: props.endpoint,
  catalogProviderId,
  enabled: computed(() => props.isOwner)
});

function queryText(value) {
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

const pendingProvider = computed(() => {
  const id = queryText(route.query.providerId);
  const providerRevision = queryText(route.query.providerRevision);
  if (!PROVIDER_ID_PATTERN.test(id) || !PROVIDER_REVISION_PATTERN.test(providerRevision)) {
    return null;
  }
  return {
    id,
    label: queryText(route.query.providerLabel) || id,
    providerRevision
  };
});
const codexAccount = computed(() => {
  const rows = Array.isArray(nativeAccounts.status.value?.accounts)
    ? nativeAccounts.status.value.accounts
    : [];
  return rows.find((account) => String(account?.id || "") === "codex") || null;
});
const codexConnected = computed(() => codexAccount.value?.connected === true);
const claudeAccount = computed(() => nativeAccounts.status.value?.accounts?.find((account) => account.id === "claude") || null);
const claudeConnected = computed(() => claudeAccount.value?.connected === true);
const nativeSetupAccount = computed(() => nativeSetupProviderId.value === "claude" ? claudeAccount.value : codexAccount.value);
const nativeSetupConnected = computed(() => nativeSetupAccount.value?.connected === true);
const nativeSetupDetails = computed(() => nativeSetupProviderId.value === "claude" ? {
  label: "Claude Code",
  authLabel: "Sign in with Claude",
  authMode: "browser",
  deviceAuth: false,
  message: "Connect your Claude subscription. Sign in in your browser, then paste the authorization code here."
} : {
  label: "Codex",
  authLabel: "Login with ChatGPT",
  authMode: "device",
  deviceAuth: true,
  message: "Choose ChatGPT login or an OpenAI API key."
});
const nativeChoices = computed(() => [
  { id: "codex", label: "Codex", connected: codexConnected.value, description: "GPT, DeepSeek or GLM. Connect your account or API key." },
  { id: "codex-glm", label: "GLM Coding Plan", description: "Use your Z.AI Coding Plan with Codex. Connect your plan key to use GLM 5.3." },
  { id: "claude", label: "Claude Code", connected: claudeConnected.value, description: "Sign in through Claude Code to use your own Claude plan. Available to the account owner." }
].filter((choice) => choice.id === "codex" || !choice.connected));
const nativeSetupRows = computed(() => [{
  ...(nativeSetupAccount.value || { connected: false, id: nativeSetupProviderId.value, status: "missing" }),
  ...nativeSetupDetails.value,
  label: nativeSetupAccount.value?.username || `${nativeSetupDetails.value.label} account`,
  username: "",
  message: nativeSetupConnected.value ? "Connected" : nativeSetupDetails.value.message
}]);
const configuredAiRows = computed(() => [
  ...(codexConnected.value ? [{
    accessLabel: "Account-wide",
    billingLabel: codexAccount.value?.username || "Codex account",
    engineLabel: "Codex - GPT",
    id: "codex",
    kind: "codex",
    keyHint: "Connected",
    managementUrl: "",
    modelLabel: "Available for Codex sessions",
    providerLabel: ""
  }] : []),
  ...(claudeConnected.value ? [{
    accessLabel: "Personal use",
    billingLabel: claudeAccount.value?.username || "Claude account",
    engineLabel: "Claude Code",
    id: "claude",
    kind: "claude",
    keyHint: "Connected",
    managementUrl: "https://claude.ai/settings/billing",
    modelLabel: "Choose model roles in Model routing",
    providerLabel: "Anthropic"
  }] : []),
  ...codexProviders.connections.value.filter((connection) => connection.status !== "not_connected").map((connection) => {
    const provider = curatedCodexProvider(connection.id);
    return {
      ...connection,
      kind: "codex-provider",
      engineLabel: `Codex - ${provider.label}`,
      providerLabel: "",
      billingLabel: provider.description,
      accessLabel: provider.ownerOnly ? "Personal use" : "Workspace use",
      keyHint: connection.connected ? "Connected" : "Reconnect required",
      modelLabel: provider.models.map(({ label }) => label).join(" · ")
    };
  }),
  ...connections.value.map((connection) => ({
    ...connection,
    engineLabel: "OpenCode",
    kind: "opencode",
    modelLabel: connection.builtIn
      ? "Big Pickle is included and ready"
      : connection.id === "zai"
        ? "GLM-4.7 Flash is ready for new sessions"
        : connection.id === "opencode"
          ? "Zen key ready; choose model access below"
        : "Choose model roles in Model routing",
    providerLabel: connection.productLabel || connection.label
  }))
]);
const zaiConnection = computed(() => connections.value.find((connection) => (
  connection.id === "zai" && connection.connected === true
)) || null);
const aiStatusLoaded = computed(() => Boolean(
  nativeAccounts.status.value && Array.isArray(nativeAccounts.status.value.accounts)
));
const nativeLoadError = computed(() => String(nativeAccounts.loadError.value || codexProviders.loadError.value || ""));
const accountsInitialLoading = computed(() => Boolean(
  isInitialLoading.value || codexProviders.resource.isInitialLoading.value || (!aiStatusLoaded.value && nativeAccounts.isLoading.value)
));
const configuredProviderIds = computed(() => new Set(connections.value.map((connection) => (
  String(connection.id || "")
))));
const availableProviders = computed(() => registryProviders.value.filter((provider) => (
  !configuredProviderIds.value.has(String(provider?.id || ""))
)));
const filteredProviders = computed(() => {
  const search = providerSearch.value.trim().toLocaleLowerCase();
  if (!search) return availableProviders.value;
  return availableProviders.value.filter((provider) => (
    `${provider?.label || ""}\n${provider?.id || ""}\n${provider?.description || ""}`
      .toLocaleLowerCase()
      .includes(search)
  ));
});
const providerPickerLoading = computed(() => Boolean(
  providerPickerPending.value ||
  registryIsInitialLoading.value ||
  (registryIsFetching.value && !registryProviders.value.length)
));
const existingEditorConnection = computed(() => connections.value.find((connection) => (
  connection.id === editorProviderId.value
)) || null);
const editorConnectionPolicy = computed(() => (
  catalogProvider.value?.id === editorProviderId.value
    ? catalogProvider.value.connectionPolicy || null
    : null
));
const editorRouteExplanation = computed(() => {
  const policy = editorConnectionPolicy.value;
  if (!policy) return "";
  const access = policy.accessLabel === "Workspace use"
    ? "Authorized workspace members may use this connection."
    : "Only the Vibe64 owner may use this connection; members can suggest main-chat messages for approval.";
  const replacement = existingEditorConnection.value?.builtIn
    ? " Adding a Zen key keeps Big Pickle as the default and lets you check or enable Zen's current models."
    : existingEditorConnection.value
      ? " Saving a replacement restarts active assistant runtimes with the new key."
      : "";
  const routeNote = String(policy.routeNote || "").trim();
  return `${policy.billingLabel}. ${routeNote ? `${routeNote} ` : ""}${access}${replacement}`;
});
const editorCatalogModelCount = computed(() => (
  catalogProvider.value?.id === editorProviderId.value
    ? Number(catalogEngine.value?.page?.total || catalogProvider.value?.models?.length || 0)
    : 0
));
const editorPreparing = computed(() => preparingProviderId.value === editorProviderId.value);
const editorSaving = computed(() => savingProviderId.value === editorProviderId.value);
const editorVerificationCopy = computed(() => {
  if (editorPreparing.value) {
    return "Loading the current OpenCode provider details. You can paste the key now; verification becomes available when they are ready.";
  }
  if (editorProviderId.value === "zai") {
    return editorSaving.value
      ? "Checking this key with one tiny GLM-4.7 Flash request on Z.AI's regular API before saving…"
      : "Vibe64 verifies this key with one tiny GLM-4.7 Flash request on Z.AI's regular API before storing it in a host-private file.";
  }
  if (editorProviderId.value === "zai-coding-plan") {
    return editorSaving.value
      ? "Checking this key through Z.AI's Personal Coding Plan route before saving…"
      : "Vibe64 verifies this key through Z.AI's Personal Coding Plan route before storing it in a host-private file.";
  }
  return editorSaving.value
    ? `Checking access with one tiny ${editorLabel.value || "provider"} test request before saving. First use can take up to 30 seconds…`
    : "Vibe64 checks the key and runs a tiny test request before storing it in a host-private file.";
});
const editorCanSave = computed(() => Boolean(
  editorProviderId.value &&
  PROVIDER_REVISION_PATTERN.test(editorProviderRevision.value) &&
  editorConnectionPolicy.value &&
  editorApiKey.value.trim() &&
  !editorError.value &&
  !editorPreparing.value &&
  !editorSaving.value
));
const editorBackLabel = computed(() => (
  ["add", "provider-picker", "starter"].includes(editorOrigin.value) ? "Back" : "Cancel"
));
const editorEyebrow = computed(() => {
  if (existingEditorConnection.value) return "Manage AI";
  if (editorProviderId.value === "zai" && editorStarter.value) return "Recommended free AI";
  if (editorStarter.value) return "Free AI setup";
  return "Add AI";
});
const editorTitle = computed(() => {
  if (existingEditorConnection.value?.builtIn) return "Add a Zen API key";
  if (existingEditorConnection.value) {
    if (editorProviderId.value === "zai") return "Update regular Z.AI API key";
    if (editorProviderId.value === "zai-coding-plan") return "Update Z.AI Personal Coding Plan key";
    return "Replace provider key";
  }
  if (editorProviderId.value === "zai") return "Connect regular Z.AI API";
  if (editorProviderId.value === "zai-coding-plan") return "Connect Z.AI Personal Coding Plan";
  if (editorStarter.value) return `Connect ${editorStarter.value.label}`;
  return `Connect ${editorLabel.value || "provider"}`;
});
const removeRunning = computed(() => codexProviders.busy.value || (
  ["codex", "claude"].includes(removeTarget.value?.kind)
    ? nativeRemoving.value
    : removingProviderId.value === String(removeTarget.value?.id || "")
));
const modelAccessRunning = computed(() => (
  updatingModelAccessProviderId.value === String(modelAccessTarget.value?.id || "")
));
const zenCheckRunning = computed(() => connections.value.some((connection) => (
  connection.id === "opencode" &&
  ["starting", "running", "cancelling"].includes(connection.modelAccess?.check?.status)
)));

function zenCheck(account = {}) {
  return account.modelAccess?.check || {};
}

function zenCheckIsRunning(account = {}) {
  return ["starting", "running", "cancelling"].includes(zenCheck(account).status);
}

function zenCheckProgress(account = {}) {
  const check = zenCheck(account);
  return check.total > 0 ? Math.min(100, (check.checked / check.total) * 100) : 0;
}

function zenAccessTitle(account = {}) {
  const mode = account.modelAccess?.mode;
  const check = zenCheck(account);
  if (zenCheckIsRunning(account)) return check.status === "cancelling" ? "Stopping model check…" : "Checking Zen models…";
  if (mode === "all") return "All current Zen models enabled";
  if (mode === "verified") return `${Number(check.enabled || 0)} additional Zen models enabled`;
  return "Big Pickle only";
}

function zenCheckSummary(account = {}) {
  const check = zenCheck(account);
  if (!check.status) return "";
  if (zenCheckIsRunning(account)) {
    const progress = check.total > 0 ? `${check.checked} of ${check.total} checked` : "Reading the current Zen catalogue";
    const current = check.currentModelId ? ` · Now checking ${check.currentModelId}` : "";
    return `${progress}${current}`;
  }
  const unchecked = Math.max(0, Number(check.total || 0) - Number(check.checked || 0));
  const result = `${Number(check.enabled || 0)} enabled · ${Number(check.rejected || 0)} rejected · ${Number(check.retryable || 0)} could not be confirmed · ${unchecked} unchecked`;
  return check.message ? `${result}. ${check.message}` : result;
}

function scheduleZenProgressRefresh() {
  if (zenProgressDisposed || zenProgressTimer || !zenCheckRunning.value) return;
  zenProgressTimer = setTimeout(async () => {
    zenProgressTimer = null;
    try {
      await reload();
    } finally {
      scheduleZenProgressRefresh();
    }
  }, 2_000);
}

function providerUnavailableReason(provider = {}) {
  if (provider.apiKeyCompatible === false) {
    return "Requires provider-specific account details";
  }
  if (!String(provider.defaultModelId || "").trim()) {
    return "No usable default model is currently available";
  }
  return "";
}

async function openProviderPicker() {
  const requestAlreadyPending = providerPickerPending.value;
  providerPickerPending.value = true;
  addAiOpen.value = false;
  providerPickerOpen.value = true;
  if (requestAlreadyPending) return;
  try {
    await reloadRegistry();
  } catch {
    // The resource owns its stable retry state.
  } finally {
    providerPickerPending.value = false;
  }
}

function chooseAiType(type = "") {
  if (type === "codex" || type === "codex-glm") {
    codexModelProviderId.value = type === "codex-glm" ? "zai-coding-plan" : "openai";
  }
  if (["codex", "codex-glm", "claude"].includes(type)) {
    nativeSetupProviderId.value = type === "codex-glm" ? "codex" : type;
    nativeSetupActivator.value = document.activeElement;
    addAiOpen.value = false;
    nativeSetupOpen.value = true;
    return;
  }
  if (type === "opencode") {
    void openProviderPicker();
  }
}

function backFromNativeSetup() {
  nativeSetupOpen.value = false;
  if (!nativeSetupConnected.value) addAiOpen.value = true;
}

async function refreshAllAccounts() {
  if (refreshingAll.value) return;
  refreshingAll.value = true;
  try {
    await Promise.allSettled([
      reload(),
      nativeAccounts.refresh(),
      codexProviders.resource.reload()
    ]);
  } finally {
    refreshingAll.value = false;
  }
}

function connectStarterProvider(starter = {}, surface = "inline") {
  editorStarterSurface.value = surface;
  void chooseProvider(starter, {
    origin: surface === "recommendation" ? "direct" : "starter",
    starter
  });
}

async function chooseProvider(choice = {}, {
  origin = "direct",
  preserveInput = false,
  starter = null
} = {}) {
  const id = String(choice.id || "");
  if (!id || preparingProviderId.value) return;
  if (!preserveInput) editorActivator.value = document.activeElement;
  preparedChoice.value = choice;
  const preparationId = ++providerPreparationId;
  preparingProviderId.value = id;
  catalogPreparationError.value = "";
  catalogProviderId.value = id;
  editorOrigin.value = origin;
  editorStarter.value = starter;
  editorProviderId.value = id;
  editorProviderRevision.value = "";
  editorLabel.value = String(starter?.label || choice.connection?.label || choice.label || id);
  if (!preserveInput) {
    editorApiKey.value = "";
    editorApiKeyVisible.value = false;
    editorError.value = "";
  }
  providerPickerOpen.value = false;
  editorOpen.value = true;
  await nextTick();

  let catalogFailed = false;
  try {
    await reloadCatalog();
  } catch {
    catalogFailed = true;
  }
  if (
    preparationId !== providerPreparationId ||
    !editorOpen.value ||
    editorProviderId.value !== id
  ) {
    return;
  }
  const provider = catalogProvider.value;
  if (
    catalogFailed ||
    catalogLoadError.value ||
    provider?.id !== id ||
    !PROVIDER_REVISION_PATTERN.test(String(provider.definitionRevision || ""))
  ) {
    catalogPreparationError.value = String(
      catalogLoadError.value || "The live OpenCode catalog did not return this provider."
    );
    preparingProviderId.value = "";
    return;
  }
  editorProviderRevision.value = provider.definitionRevision;
  if (!starter) editorLabel.value = String(provider.label || choice.label || id);
  preparingProviderId.value = "";
}

function retryPreparedProvider() {
  if (preparedChoice.value) {
    void chooseProvider(preparedChoice.value, {
      origin: editorOrigin.value,
      preserveInput: true,
      starter: editorStarter.value
    });
  }
}

function resetEditor() {
  providerPreparationId += 1;
  editorOpen.value = false;
  catalogProviderId.value = "";
  preparedChoice.value = null;
  preparingProviderId.value = "";
  catalogPreparationError.value = "";
  editorOrigin.value = "direct";
  editorStarter.value = null;
  editorStarterSurface.value = "";
  editorProviderId.value = "";
  editorProviderRevision.value = "";
  editorLabel.value = "";
  editorApiKey.value = "";
  editorApiKeyVisible.value = false;
  editorError.value = "";
}

async function closeEditor() {
  if (editorSaving.value) return;
  const origin = editorOrigin.value;
  const providerId = editorProviderId.value;
  const starterSurface = editorStarterSurface.value;
  resetEditor();
  if (origin === "starter") {
    await nextTick();
    const selector = starterSurface === "onboarding"
      ? onboardingSelector.value
      : zeroStateSelector.value;
    selector?.focusOption(providerId);
  } else if (origin === "provider-picker") {
    providerPickerOpen.value = true;
  } else if (origin === "add") {
    addAiOpen.value = true;
  }
}

async function clearProviderQuery() {
  const query = { ...route.query };
  delete query.providerId;
  delete query.providerLabel;
  delete query.providerRevision;
  await router.replace({ query });
}

async function saveEditor() {
  if (!editorCanSave.value) {
    if (!editorApiKey.value.trim()) editorError.value = "Enter the provider API key.";
    return;
  }
  let response = null;
  try {
    response = await saveConnection({
      apiKey: editorApiKey.value,
      label: editorLabel.value,
      providerId: editorProviderId.value,
      providerRevision: editorProviderRevision.value
    });
  } catch (error) {
    editorError.value = String(error?.fieldErrors?.apiKey || "");
    return;
  }
  if (response?.ok !== false) {
    editorRoutingSetupError.value = response?.routing?.ok === false ? response.routing.error : "";
    editorApiKey.value = "";
    editorApiKeyVisible.value = false;
    editorRoutingPending.value = true;
    await clearProviderQuery();
    emit("changed");
  }
}

function finishConnectionRouting() {
  editorRoutingPending.value = false;
  resetEditor();
  emit("connected");
}

watch(nativeSetupConnected, (connected, previous) => {
  if (connected && previous === false && nativeSetupOpen.value) nativeRoutingReady.value = true;
});
watch(nativeSetupOpen, (open) => { if (!open) nativeRoutingReady.value = false; });

function requestRemove(connection = {}) {
  if (connection.removable === false) return;
  removeTarget.value = connection;
  removeOpen.value = true;
}

function requestModelAccess(connection = {}, unlocked = false) {
  if (!connection.modelAccess?.configurable || updatingModelAccessProviderId.value) return;
  modelAccessTarget.value = connection;
  if (unlocked === true) {
    modelAccessConfirmOpen.value = true;
    return;
  }
  void applyModelAccess(false);
}

async function confirmModelAccessUnlock() {
  modelAccessConfirmOpen.value = false;
  await applyModelAccess(true);
}

async function applyModelAccess(unlocked) {
  const providerId = String(modelAccessTarget.value?.id || "");
  if (!providerId || updatingModelAccessProviderId.value) return null;
  try {
    const response = await updateModelAccess(
      providerId,
      unlocked === true ? "enable-all" : "disable-additional"
    );
    if (response?.ok !== false) emit("changed");
    return response;
  } finally {
    if (!modelAccessConfirmOpen.value) modelAccessTarget.value = null;
  }
}

async function applyZenModelAccess(account = {}, operation = "") {
  const providerId = String(account.id || "");
  if (
    providerId !== "opencode" ||
    account.builtIn ||
    !operation ||
    updatingModelAccessProviderId.value
  ) {
    return null;
  }
  const response = await updateModelAccess(providerId, operation);
  if (response?.ok !== false) {
    emit("changed");
  }
  return response;
}

async function confirmRemove() {
  const target = removeTarget.value;
  const providerId = String(target?.id || "");
  if (!providerId || removeRunning.value) return;
  let response = null;
  try {
    if (target?.kind === "codex-provider") {
      response = await codexProviders.change({ modelProviderId: providerId, remove: true });
    } else if (["codex", "claude"].includes(target?.kind)) {
      nativeRemoving.value = true;
      response = await nativeAccounts.logout(target.kind);
      if (response?.ok !== false) await nativeAccounts.reloadLocalStatus();
    } else {
      response = await removeConnection(providerId);
    }
  } catch {
    return;
  } finally {
    nativeRemoving.value = false;
  }
  if (response?.ok !== false) {
    removeOpen.value = false;
    removeTarget.value = null;
    emit("changed");
  }
}

function manageConfiguredAi(account = {}) {
  codexModelProviderId.value = account.kind === "codex-provider" ? account.id : "openai";
  if (["codex", "claude", "codex-provider"].includes(account.kind)) {
    nativeSetupProviderId.value = account.kind === "codex-provider" ? "codex" : account.kind;
    nativeSetupActivator.value = document.activeElement;
    nativeSetupOpen.value = true;
    return;
  }
  void chooseProvider({
    connection: account,
    id: account.id,
    label: account.label
  });
}

watch([pendingProvider, () => props.isOwner], ([provider, isOwner]) => {
  if (!provider) {
    hydratedRequestIdentity = "";
    return;
  }
  if (!isOwner) return;
  const identity = `${provider.id}:${provider.providerRevision}`;
  if (hydratedRequestIdentity === identity) return;
  hydratedRequestIdentity = identity;
  void chooseProvider(provider);
}, { immediate: true });

watch(zenCheckRunning, (running) => {
  if (!running && zenProgressTimer) {
    clearTimeout(zenProgressTimer);
    zenProgressTimer = null;
  }
  if (running) scheduleZenProgressRefresh();
}, { immediate: true });

onBeforeUnmount(() => {
  zenProgressDisposed = true;
  if (zenProgressTimer) clearTimeout(zenProgressTimer);
  zenProgressTimer = null;
});

function openProvider(providerId, { providerLabel = "", providerRevision = "" } = {}) {
  if (PROVIDER_ID_PATTERN.test(providerId) && PROVIDER_REVISION_PATTERN.test(providerRevision)) {
    void chooseProvider({ id: providerId, label: providerLabel || providerId, providerRevision });
  } else if (["codex", "claude"].includes(providerId)) chooseAiType(providerId);
  else if (curatedCodexProvider(providerId)) manageConfiguredAi({ kind: "codex-provider", id: providerId });
  else if (providerId === "opencode") void openProviderPicker();
  else addAiOpen.value = true;
}
watch(() => Boolean(routingSaving.value || editorSaving.value || removeRunning.value || modelAccessRunning.value || codexProviderSaving.value),
  (busy) => emit("busy", busy));
defineExpose({ openProvider });
</script>

<template>
  <v-sheet
    :border="!onboarding"
    :class="[
      'vibe64-ai-connections',
      {
        'vibe64-ai-connections--compact': smAndDown,
        'vibe64-ai-connections--onboarding': onboarding
      }
    ]"
    rounded="xl"
  >
    <FreeAiSelector
      v-if="onboarding"
      ref="onboardingSelector"
      :connections="connections"
      :error="loadError"
      :loading="isInitialLoading"
      @retry="reload"
      @select="(choice) => connectStarterProvider(choice, 'onboarding')"
    />

    <template v-else>
      <div
        v-if="isOwner"
        class="vibe64-ai-connections__page-actions"
        aria-label="AI account actions"
      >
        <v-btn variant="tonal" :disabled="accountsInitialLoading" @click="routingOpen = true">Model routing</v-btn>
        <v-btn
          :icon="mdiRefresh"
          aria-label="Refresh AI accounts"
          :disabled="accountsInitialLoading || refreshingAll"
          type="button"
          variant="text"
          @click="refreshAllAccounts"
        />
        <v-btn
          color="primary"
          :disabled="accountsInitialLoading || Boolean(loadError)"
          :prepend-icon="mdiPlus"
          type="button"
          variant="flat"
          @click="addAiOpen = true"
        >
          Add AI
        </v-btn>
      </div>

      <v-alert
        v-if="!isOwner"
        text="Only the Vibe64 owner can add, change, or remove AI accounts. Workspace members can use connections marked Workspace use."
        title="Owner required"
        type="info"
        variant="tonal"
      />

      <template v-else>
        <div
          v-if="accountsInitialLoading"
          aria-busy="true"
          aria-label="Loading AI accounts"
          class="vibe64-ai-connections__list"
        >
          <v-skeleton-loader v-for="index in 3" :key="index" type="list-item-avatar-three-line, actions" />
        </div>

        <div v-else-if="loadError" class="vibe64-ai-connections__load-error">
          <v-alert :text="loadError" title="AI accounts could not load" type="error" variant="tonal" />
          <v-btn type="button" variant="tonal" @click="refreshAllAccounts">Try again</v-btn>
        </div>

        <template v-else>
          <v-alert
            v-if="nativeLoadError"
            :text="nativeLoadError"
            title="AI account status could not load"
            type="warning"
            variant="tonal"
          />

          <v-sheet
            v-if="!zaiConnection"
            border
            class="vibe64-ai-connections__recommendation"
            rounded="lg"
          >
            <div class="vibe64-ai-connections__recommendation-body">
              <h2 class="text-title-medium">Recommended free upgrade: GLM-4.7 Flash</h2>
              <p class="text-body-medium text-medium-emphasis">
                Big Pickle works immediately. Connect a regular Z.AI API key to make GLM-4.7 Flash—Vibe64's recommended free coding model—the default for new sessions. This uses Z.AI's regular API, not Personal Coding Plan quota.
              </p>
              <div class="vibe64-ai-connections__recommendation-actions">
                <v-btn
                  class="vibe64-ai-connections__recommendation-primary"
                  color="primary"
                  type="button"
                  variant="flat"
                  @click="connectStarterProvider(REGULAR_ZAI_STARTER, 'recommendation')"
                >
                  Connect regular Z.AI API
                </v-btn>
                <span class="text-body-small text-medium-emphasis">
                  Have a Z.AI Personal Coding Plan?
                  <v-btn
                    class="vibe64-ai-connections__recommendation-plan-action"
                    type="button"
                    variant="text"
                    @click="chooseAiType('codex-glm')"
                  >
                    Connect Coding Plan with Codex
                  </v-btn>
                </span>
              </div>
            </div>
          </v-sheet>

          <div v-if="!configuredAiRows.length" class="vibe64-ai-connections__zero-state">
            <FreeAiSelector
              ref="zeroStateSelector"
              :connections="connections"
              :error="loadError"
              @retry="reload"
              @select="(choice) => connectStarterProvider(choice, 'inline')"
            />
          </div>

          <section v-else aria-label="Configured AI accounts" class="vibe64-ai-connections__accounts">
            <v-sheet border class="vibe64-ai-connections__account-list" rounded="xl">
              <article
                v-for="account in configuredAiRows"
                :key="`${account.kind}:${account.id}`"
                class="vibe64-ai-connections__row"
              >
                <div class="vibe64-ai-connections__identity">
                  <v-avatar :color="account.kind === 'codex-provider' && !account.connected ? 'warning' : 'success'" size="44" variant="tonal">
                    <v-icon :icon="account.kind === 'codex-provider' && !account.connected ? mdiRefresh : mdiCheck" size="22" />
                  </v-avatar>
                  <span>
                    <strong>
                      <template v-if="account.kind === 'opencode' && (account.id === 'zai' || account.id === 'zai-coding-plan')">{{ account.providerLabel }}</template>
                      <template v-else-if="account.id === 'opencode' && account.builtIn">Big Pickle</template>
                      <template v-else>
                        {{ account.engineLabel }}<template v-if="account.providerLabel"> · {{ account.providerLabel }}</template>
                      </template>
                    </strong>
                    <small v-if="account.id === 'zai'">{{ account.billingLabel }}</small>
                    <small v-else-if="account.id === 'opencode' && account.builtIn">OpenCode Zen · included with Vibe64</small>
                    <small v-else>{{ account.billingLabel }}</small>
                    <small v-if="account.id === 'zai'">Free model ready for new sessions · {{ account.keyHint }}</small>
                    <small v-else-if="account.id === 'opencode' && account.builtIn">Ready for the whole workspace · {{ account.keyHint }}</small>
                    <small v-else>{{ account.modelLabel }} · {{ account.keyHint }}</small>
                  </span>
                </div>

                <div class="vibe64-ai-connections__status" aria-label="Connection status">
                  <v-chip
                    :color="account.accessLabel === 'Workspace use' ? 'primary' : undefined"
                    size="small"
                    variant="tonal"
                  >
                    {{ account.accessLabel }}
                  </v-chip>
                  <v-chip
                    v-if="account.preferred"
                    color="success"
                    size="small"
                    variant="tonal"
                  >
                    Default
                  </v-chip>
                </div>

                <div class="vibe64-ai-connections__row-actions">
                  <v-btn
                    v-if="account.managementUrl"
                    :append-icon="mdiOpenInNew"
                    :href="account.managementUrl"
                    rel="noopener noreferrer"
                    target="_blank"
                    variant="text"
                  >
                    Billing &amp; usage
                  </v-btn>
                  <v-btn type="button" variant="text" @click="manageConfiguredAi(account)">Manage</v-btn>
                  <v-btn
                    v-if="account.removable !== false"
                    color="error"
                    type="button"
                    variant="text"
                    @click="requestRemove(account)"
                  >
                    {{ account.id === 'opencode' ? "Use included Big Pickle" : "Remove" }}
                  </v-btn>
                </div>

                <v-sheet
                  v-if="account.id === 'opencode' && !account.builtIn && account.modelAccess"
                  class="vibe64-ai-connections__account-child vibe64-ai-connections__zen-access"
                  rounded="md"
                >
                  <small class="vibe64-ai-connections__account-child-label">For this connection</small>
                  <div class="vibe64-ai-connections__model-access-copy">
                    <v-avatar
                      :color="account.modelAccess.mode === 'all' ? 'warning' : 'primary'"
                      size="40"
                      variant="tonal"
                    >
                      <v-icon
                        :icon="zenCheckIsRunning(account) ? mdiRefresh : mdiShieldCheckOutline"
                        size="21"
                      />
                    </v-avatar>
                    <span>
                      <strong>{{ zenAccessTitle(account) }}</strong>
                      <small>
                        Big Pickle always remains available. Checking sends one tiny, potentially billable request to each current Zen model, one at a time.
                      </small>
                    </span>
                  </div>

                  <div v-if="zenCheck(account).status" class="vibe64-ai-connections__zen-progress" aria-live="polite">
                    <v-progress-linear
                      v-if="zenCheckIsRunning(account)"
                      color="primary"
                      :indeterminate="!zenCheck(account).total"
                      :model-value="zenCheckProgress(account)"
                      rounded
                    />
                    <small>{{ zenCheckSummary(account) }}</small>
                  </div>

                  <div class="vibe64-ai-connections__zen-actions">
                    <v-btn
                      color="primary"
                      :disabled="Boolean(updatingModelAccessProviderId) || zenCheckIsRunning(account)"
                      type="button"
                      variant="flat"
                      @click="applyZenModelAccess(account, 'check-available')"
                    >
                      <span v-if="smAndDown">Check &amp; enable models</span>
                      <span v-else>Check &amp; enable working models</span>
                    </v-btn>
                    <v-btn
                      :disabled="Boolean(updatingModelAccessProviderId) || zenCheckIsRunning(account)"
                      type="button"
                      variant="tonal"
                      @click="applyZenModelAccess(account, 'enable-all')"
                    >
                      Enable all current models
                    </v-btn>
                    <v-btn
                      :disabled="Boolean(updatingModelAccessProviderId) || zenCheckIsRunning(account)"
                      type="button"
                      variant="text"
                      @click="applyZenModelAccess(account, 'disable-additional')"
                    >
                      Use Big Pickle only
                    </v-btn>
                    <v-btn
                      v-if="zenCheckIsRunning(account)"
                      color="error"
                      :disabled="updatingModelAccessProviderId === account.id || zenCheck(account).status === 'cancelling'"
                      :prepend-icon="mdiStopCircleOutline"
                      type="button"
                      variant="text"
                      @click="applyZenModelAccess(account, 'cancel-check')"
                    >
                      {{ zenCheck(account).status === 'cancelling' ? "Stopping…" : "Cancel check" }}
                    </v-btn>
                  </div>
                </v-sheet>

                <v-sheet
                  v-if="account.id !== 'opencode' && account.modelAccess?.configurable"
                  class="vibe64-ai-connections__account-child vibe64-ai-connections__model-access"
                  :class="{ 'vibe64-ai-connections__model-access--paid': account.modelAccess.mode === 'all' }"
                  rounded="md"
                >
                  <small class="vibe64-ai-connections__account-child-label">For this connection</small>
                  <div class="vibe64-ai-connections__model-access-copy">
                    <v-avatar
                      :color="account.modelAccess.mode === 'all' ? 'warning' : 'success'"
                      size="40"
                      variant="tonal"
                    >
                      <v-icon
                        :icon="account.modelAccess.mode === 'all' ? mdiCreditCardOutline : mdiShieldCheckOutline"
                        size="21"
                      />
                    </v-avatar>
                    <span>
                      <strong>{{ account.modelAccess.mode === 'all' ? "All Z.AI models unlocked" : "Free-only model access" }}</strong>
                      <small>
                        {{ account.modelAccess.mode === 'all'
                          ? "GLM-4.7 Flash remains free; other model choices can consume Z.AI API credit."
                          : "GLM-4.7 Flash stays available. Paid Z.AI models remain visible but locked." }}
                      </small>
                    </span>
                  </div>
                  <v-switch
                    color="primary"
                    :disabled="Boolean(updatingModelAccessProviderId)"
                    hide-details
                    inset
                    :label="updatingModelAccessProviderId === account.id
                      ? (account.modelAccess.mode === 'all' ? 'Returning to free only…' : 'Unlocking paid models…')
                      : account.modelAccess.label"
                    :model-value="account.modelAccess.mode === 'all'"
                    @click.prevent="requestModelAccess(account, account.modelAccess.mode !== 'all')"
                  />
                </v-sheet>
              </article>
            </v-sheet>
          </section>

          <v-alert
            v-if="pendingProvider && !editorOpen"
            class="vibe64-ai-connections__requested"
            :text="`${pendingProvider.label} needs an API key before the requested OpenCode session can start.`"
            title="Provider setup requested"
            type="info"
            variant="tonal"
          >
            <template #append>
              <v-btn color="primary" type="button" variant="flat" @click="chooseProvider(pendingProvider)">Connect</v-btn>
            </template>
          </v-alert>

          <div class="vibe64-ai-connections__security-note">
            <v-icon :icon="mdiLockOutline" size="18" />
            <span>Provider keys are redacted after saving. Sign-ins and keys can be managed only by the Vibe64 owner.</span>
          </div>
        </template>
      </template>
    </template>

    <v-dialog v-model="addAiOpen" :fullscreen="smAndDown" max-width="46rem">
      <v-card :rounded="smAndDown ? 0 : 'xl'">
        <v-card-title class="vibe64-dialog-title">
          <span>
            <small class="vibe64-dialog-eyebrow">Add AI</small>
            <strong>How do you want to connect?</strong>
          </span>
          <v-btn :icon="mdiClose" aria-label="Close Add AI" type="button" variant="text" @click="addAiOpen = false" />
        </v-card-title>
        <v-card-text class="vibe64-add-ai__body">
          <p class="text-body-large text-medium-emphasis">
            Choose the account type first. Vibe64 will ask only for the details that connection needs.
          </p>
          <v-row align="stretch">
            <v-col v-for="choice in (aiStatusLoaded ? nativeChoices : [])" :key="choice.id" cols="12" sm="6">
              <v-card class="vibe64-add-ai__choice fill-height" rounded="xl" variant="outlined">
                <v-card-item>
                  <template #prepend>
                    <v-avatar color="secondary" rounded="lg" size="52" variant="tonal">
                      <v-icon :icon="mdiAccountCircleOutline" size="28" />
                    </v-avatar>
                  </template>
                  <v-card-title>{{ choice.label }}</v-card-title>
                  <v-card-subtitle>Connect your account</v-card-subtitle>
                </v-card-item>
                <v-card-text class="vibe64-add-ai__choice-copy text-body-medium">
                  {{ choice.description }}
                </v-card-text>
                <v-card-actions class="vibe64-add-ai__choice-actions">
                  <v-btn class="vibe64-add-ai__choice-action" block color="primary" type="button" variant="tonal" @click="chooseAiType(choice.id)">
                    Choose {{ choice.label }}
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-col>
            <v-col cols="12" :sm="nativeChoices.length ? 6 : 12">
              <v-card class="vibe64-add-ai__choice fill-height" color="primary" rounded="xl" variant="tonal">
                <v-card-item>
                  <template #prepend>
                    <v-avatar color="primary" rounded="lg" size="52" variant="flat">
                      <v-icon :icon="mdiRobotOutline" size="28" />
                    </v-avatar>
                  </template>
                  <v-card-title>OpenCode</v-card-title>
                  <v-card-subtitle>Connect a provider API key</v-card-subtitle>
                </v-card-item>
                <v-card-text class="vibe64-add-ai__choice-copy text-body-medium">
                  Choose from OpenCode’s provider catalog. Add as many providers as you need; each key stays an independent connection.
                </v-card-text>
                <v-card-actions class="vibe64-add-ai__choice-actions">
                  <v-btn class="vibe64-add-ai__choice-action" block color="primary" type="button" variant="flat" @click="chooseAiType('opencode')">
                    Choose provider
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="providerPickerOpen" :fullscreen="smAndDown" max-width="46rem" scrollable>
      <v-card :rounded="smAndDown ? 0 : 'xl'">
        <v-card-title class="vibe64-dialog-title">
          <span>
            <small class="vibe64-dialog-eyebrow">Add OpenCode AI</small>
            <strong>Choose a provider</strong>
          </span>
          <v-btn
            :icon="mdiArrowLeft"
            aria-label="Back to AI types"
            type="button"
            variant="text"
            @click="providerPickerOpen = false; addAiOpen = true"
          />
        </v-card-title>
        <v-card-text class="vibe64-provider-picker__body">
          <v-text-field
            v-model="providerSearch"
            autofocus
            clearable
            :disabled="providerPickerLoading"
            hide-details
            :prepend-inner-icon="mdiMagnify"
            label="Search OpenCode providers"
            placeholder="Try OpenAI, Anthropic, GLM…"
            variant="outlined"
          />

          <div
            v-if="providerPickerLoading"
            aria-busy="true"
            aria-label="Loading OpenCode providers"
            class="vibe64-provider-picker__list"
          >
            <v-skeleton-loader v-for="index in 6" :key="index" type="list-item-avatar-two-line" />
          </div>

          <div v-else-if="registryLoadError" class="vibe64-provider-picker__recovery">
            <v-alert
              :text="registryLoadError"
              title="OpenCode providers could not load"
              type="error"
              variant="tonal"
            />
            <v-btn color="primary" type="button" variant="tonal" @click="openProviderPicker">Try again</v-btn>
          </div>

          <v-sheet
            v-else-if="filteredProviders.length"
            border
            class="vibe64-provider-picker__list"
            rounded="xl"
          >
            <v-list lines="two">
              <v-list-item
                v-for="provider in filteredProviders"
                :key="provider.id"
                class="vibe64-provider-picker__item"
                :disabled="Boolean(providerUnavailableReason(provider))"
                :subtitle="providerUnavailableReason(provider)
                  ? `${provider.id} · ${providerUnavailableReason(provider)}`
                  : `${provider.id} · ${provider.description}`"
                :title="provider.label"
                @click="chooseProvider(provider, { origin: 'provider-picker' })"
              >
                <template #prepend>
                  <v-avatar color="primary" size="44" variant="tonal">
                    <v-icon :icon="mdiRobotOutline" size="22" />
                  </v-avatar>
                </template>
                <template #append>
                  <span v-if="providerUnavailableReason(provider)" class="text-label-medium text-medium-emphasis">
                    More setup needed
                  </span>
                  <span v-else class="text-label-large text-primary">Connect</span>
                </template>
              </v-list-item>
            </v-list>
          </v-sheet>

          <v-sheet v-else class="vibe64-provider-picker__empty" color="surface-container-low" rounded="xl">
            <v-icon :icon="mdiRobotOutline" color="primary" size="36" />
            <strong>
              {{ providerSearch.trim()
                ? `No providers match “${providerSearch.trim()}”`
                : "Every OpenCode provider is already connected" }}
            </strong>
            <span class="text-body-medium text-medium-emphasis">
              {{ providerSearch.trim()
                ? "Try a provider name or its OpenCode ID."
                : "Manage an existing connection, or remove one before adding it again." }}
            </span>
          </v-sheet>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="nativeSetupOpen"
      :persistent="codexProviderSaving"
      :activator="nativeSetupActivator"
      :open-on-click="false"
      :fullscreen="smAndDown"
      max-width="42rem"
      scrollable
    >
      <v-card :rounded="smAndDown ? 0 : 'xl'">
        <v-card-text class="vibe64-codex-setup__body">
          <ModelRoutingForm v-if="nativeRoutingReady" :engine-id="nativeSetupProviderId" :connection-id="nativeSetupProviderId === 'codex' ? 'openai' : 'anthropic'" :connection-engines="[nativeSetupProviderId]" :connection-label="nativeSetupProviderId === 'codex' ? 'GPT' : 'Claude'" :setup-error="nativeSetupAccount?.routing?.ok === false ? nativeSetupAccount.routing.error : ''" @busy="codexProviderSaving = $event" @close="nativeSetupOpen = false" @saved="nativeSetupOpen = false; emit('changed')" />
          <CodexProviderConnections
            v-else-if="nativeSetupProviderId === 'codex'"
            v-model="codexModelProviderId"
            :actions-enabled="isOwner"
            show-close
            @busy="codexProviderSaving = $event"
            @close="nativeSetupOpen = false"
            @changed="codexProviders.resource.reload(); emit('changed')"
          />
          <ProviderAccountsSetup
            v-if="!nativeRoutingReady && (nativeSetupProviderId !== 'codex' || codexModelProviderId === 'openai')"
            :accounts="nativeAccounts"
            :actions-enabled="isOwner"
            actions-disabled-message="Only the Vibe64 owner can manage this connection."
            :account-rows="nativeSetupRows"
            :back-label="nativeSetupConnected ? '' : 'Back'"
            needed-label="Not connected"
            ready-label="Connected"
            :show-continue="false"
            :status-loaded="aiStatusLoaded"
            :title="nativeSetupDetails.label"
            @back="backFromNativeSetup"
          >
            <template #close>
              <v-btn
                :icon="mdiClose"
                :aria-label="`Close ${nativeSetupDetails.label} setup`"
                type="button"
                variant="text"
                @click="nativeSetupOpen = false"
              />
            </template>
          </ProviderAccountsSetup>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog
      :model-value="editorOpen"
      :activator="editorActivator"
      :open-on-click="false"
      :fullscreen="smAndDown"
      max-width="40rem"
      :persistent="editorSaving || routingSaving"
      @update:model-value="open => { if (!open && !routingSaving) editorRoutingPending ? finishConnectionRouting() : closeEditor(); }"
    >
      <v-card :rounded="smAndDown ? 0 : 'xl'">
        <v-card-title v-if="!editorRoutingPending" class="vibe64-dialog-title">
          <span>
            <small class="vibe64-dialog-eyebrow">{{ editorEyebrow }}</small>
            <strong>{{ editorTitle }}</strong>
          </span>
          <v-btn
            :icon="editorOrigin === 'direct' ? mdiClose : mdiArrowLeft"
            :aria-label="editorOrigin === 'direct' ? 'Close provider setup' : 'Back to AI choices'"
            :disabled="editorSaving"
            type="button"
            variant="text"
            @click="closeEditor"
          />
        </v-card-title>

        <v-card-text v-if="editorRoutingPending">
          <ModelRoutingForm :connection-id="editorProviderId" :connection-label="editorLabel" :connection-engines="['opencode']" :setup-error="editorRoutingSetupError" @busy="routingSaving = $event" @close="finishConnectionRouting" @saved="finishConnectionRouting" />
        </v-card-text>
        <v-card-text v-else-if="catalogPreparationError" class="vibe64-provider-editor__body">
          <v-alert
            border="start"
            :text="catalogPreparationError"
            title="Provider could not be confirmed"
            type="error"
            variant="tonal"
          />
          <div class="vibe64-provider-editor__recovery">
            <v-btn type="button" variant="text" @click="closeEditor">{{ editorBackLabel }}</v-btn>
            <v-btn color="primary" type="button" variant="tonal" @click="retryPreparedProvider">Try again</v-btn>
          </div>
        </v-card-text>

        <template v-else>
          <v-card-text
            :aria-busy="editorPreparing ? 'true' : undefined"
            class="vibe64-provider-editor__body"
          >
            <v-sheet class="vibe64-provider-editor__provider" rounded="lg">
              <v-avatar color="primary" size="44" variant="tonal">
                <v-icon :icon="mdiRobotOutline" size="24" />
              </v-avatar>
              <span>
                <strong>{{ editorLabel }}</strong>
                <small>
                  {{ editorProviderId }}<template v-if="editorCatalogModelCount"> · {{ editorCatalogModelCount }} models found</template>
                </small>
              </span>
            </v-sheet>

            <v-btn
              v-if="editorStarter"
              :append-icon="mdiOpenInNew"
              block
              color="primary"
              :href="editorStarter.accountUrl"
              rel="noopener noreferrer"
              size="large"
              target="_blank"
              variant="tonal"
            >
              {{ editorStarter.accountAction }}
            </v-btn>

            <v-sheet
              v-if="editorPreparing"
              aria-label="Loading current provider details"
              class="vibe64-provider-editor__route"
              rounded="lg"
            >
              <v-skeleton-loader type="heading, paragraph" />
            </v-sheet>

            <v-sheet v-else-if="editorConnectionPolicy" class="vibe64-provider-editor__route" rounded="lg">
              <span>
                <strong>{{ editorConnectionPolicy.routeLabel || editorConnectionPolicy.productLabel }}</strong>
                <v-chip
                  :color="editorConnectionPolicy.accessLabel === 'Workspace use' ? 'primary' : 'warning'"
                  size="x-small"
                  variant="tonal"
                >
                  {{ editorConnectionPolicy.accessLabel }}
                </v-chip>
              </span>
              <p>{{ editorRouteExplanation }}</p>
            </v-sheet>

            <v-text-field
              v-model="editorApiKey"
              autocomplete="new-password"
              :disabled="editorSaving"
              :error-messages="editorError ? [editorError] : []"
              hint="Paste the key for this provider. It will not be shown again."
              label="API key"
              persistent-hint
              :type="editorApiKeyVisible ? 'text' : 'password'"
              variant="outlined"
              @update:model-value="editorError = ''"
            >
              <template #append-inner>
                <v-btn
                  :aria-label="editorApiKeyVisible ? 'Hide API key' : 'Show API key'"
                  :disabled="editorSaving"
                  :icon="editorApiKeyVisible ? mdiEyeOffOutline : mdiEyeOutline"
                  type="button"
                  variant="text"
                  @click="editorApiKeyVisible = !editorApiKeyVisible"
                />
              </template>
            </v-text-field>

            <div aria-live="polite" class="vibe64-provider-editor__security">
              <v-icon :icon="mdiLockOutline" size="18" />
              <span>{{ editorVerificationCopy }}</span>
            </div>

            <v-alert
              v-if="!editorPreparing && (!editorProviderRevision || !editorConnectionPolicy)"
              text="Vibe64 could not confirm this provider's current OpenCode definition. Go back and try again."
              title="Provider confirmation required"
              type="warning"
              variant="tonal"
            />
          </v-card-text>
          <v-card-actions class="vibe64-provider-editor__actions">
            <v-btn :disabled="editorSaving" type="button" variant="text" @click="closeEditor">{{ editorBackLabel }}</v-btn>
            <v-btn
              :aria-busy="editorPreparing || editorSaving ? 'true' : undefined"
              color="primary"
              :disabled="!editorCanSave"
              type="button"
              variant="flat"
              @click="saveEditor"
            >
              {{ editorPreparing ? "Loading provider details…" : onboarding ? "Verify key and start Vibe64" : "Verify and connect" }}
            </v-btn>
          </v-card-actions>
        </template>
      </v-card>
    </v-dialog>

    <v-dialog v-model="routingOpen" max-width="38rem" :fullscreen="smAndDown" :persistent="routingSaving" scrollable>
      <v-card><v-card-text>
        <ModelRoutingForm v-if="routingOpen" :readonly="!isOwner" @busy="routingSaving = $event" @close="routingOpen = false" @saved="routingOpen = false; emit('changed')" />
      </v-card-text></v-card>
    </v-dialog>

    <v-dialog v-model="modelAccessConfirmOpen" max-width="31rem" persistent>
      <v-card rounded="xl">
        <v-card-item class="vibe64-ai-connections__confirm-header">
          <template #prepend>
            <v-avatar color="warning" size="44" variant="tonal">
              <v-icon :icon="mdiCreditCardOutline" size="23" />
            </v-avatar>
          </template>
          <v-card-title>{{ modelAccessTarget?.modelAccess?.label || "Unlock provider models" }}?</v-card-title>
          <v-card-subtitle class="vibe64-ai-connections__confirm-subtitle">
            GLM-4.7 Flash stays available either way.
          </v-card-subtitle>
        </v-card-item>
        <v-card-text class="text-body-medium">
          {{ modelAccessTarget?.modelAccess?.warning || "These models may consume paid provider credit." }}
        </v-card-text>
        <v-card-actions class="vibe64-ai-connections__confirm-actions">
          <v-btn :disabled="modelAccessRunning" type="button" variant="text" @click="modelAccessConfirmOpen = false; modelAccessTarget = null">
            Keep free only
          </v-btn>
          <v-btn
            color="warning"
            :disabled="modelAccessRunning"
            type="button"
            variant="flat"
            @click="confirmModelAccessUnlock"
          >
            Unlock paid models
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="removeOpen" max-width="30rem" persistent>
      <v-card rounded="xl">
        <v-card-title>
          {{ removeTarget?.id === "opencode" ? "Return to included Big Pickle" : "Remove AI connection" }}?
        </v-card-title>
        <v-card-text>
          <template v-if="removeTarget?.id === 'opencode'">
            The saved Zen key will be removed and paid or key-only Zen models will stop. Included Big Pickle remains available.
          </template>
          <template v-else>
            New and resumed turns using this AI will stop until the owner connects it again.
            Existing conversation and project history remain intact.
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="removeRunning" type="button" variant="text" @click="removeOpen = false">Cancel</v-btn>
          <v-btn
            :aria-busy="removeRunning ? 'true' : undefined"
            color="error"
            :disabled="removeRunning"
            type="button"
            variant="flat"
            @click="confirmRemove"
          >
            {{ removeTarget?.id === "opencode" ? "Use included Big Pickle" : "Remove AI" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-sheet>
</template>

<style scoped>
.vibe64-ai-connections {
  display: grid;
  gap: 1.5rem;
  padding: clamp(1rem, 3vw, 1.5rem);
}

.vibe64-ai-connections--onboarding {
  background: transparent;
}

.vibe64-ai-connections__page-actions,
.vibe64-ai-connections__identity,
.vibe64-ai-connections__status,
.vibe64-ai-connections__row-actions,
.vibe64-ai-connections__model-access,
.vibe64-ai-connections__model-access-copy,
.vibe64-ai-connections__zen-actions,
.vibe64-ai-connections__recommendation-actions,
.vibe64-ai-connections__recommendation-actions > span,
.vibe64-ai-connections__security-note,
.vibe64-dialog-title,
.vibe64-provider-editor__provider,
.vibe64-provider-editor__route > span,
.vibe64-provider-editor__security,
.vibe64-provider-editor__recovery {
  display: flex;
}

.vibe64-add-ai__body > p,
.vibe64-ai-connections__recommendation-body > p,
.vibe64-provider-editor__route p {
  margin: 0;
}

.vibe64-dialog-eyebrow {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.vibe64-ai-connections__page-actions,
.vibe64-ai-connections__status,
.vibe64-ai-connections__row-actions {
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.vibe64-ai-connections__page-actions {
  justify-content: flex-end;
}

.vibe64-ai-connections__recommendation-body {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.vibe64-ai-connections__recommendation {
  background: rgb(var(--v-theme-surface-container-low));
  padding: 1.25rem;
}

.vibe64-ai-connections__recommendation-body > p {
  overflow-wrap: anywhere;
}

.vibe64-ai-connections__recommendation-actions,
.vibe64-ai-connections__recommendation-actions > span {
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
}

.vibe64-ai-connections__recommendation-plan-action {
  max-width: 100%;
  padding-inline: 0;
  white-space: normal;
}

.vibe64-ai-connections__list,
.vibe64-ai-connections__load-error,
.vibe64-ai-connections__accounts,
.vibe64-ai-connections__zen-access,
.vibe64-ai-connections__zen-progress,
.vibe64-provider-picker__body,
.vibe64-provider-picker__empty,
.vibe64-provider-picker__recovery,
.vibe64-provider-editor__body,
.vibe64-provider-editor__provider > span:last-child {
  display: grid;
}

.vibe64-ai-connections__list,
.vibe64-ai-connections__load-error,
.vibe64-ai-connections__accounts,
.vibe64-provider-picker__body,
.vibe64-provider-picker__empty,
.vibe64-provider-picker__recovery,
.vibe64-provider-editor__body {
  gap: 1rem;
}

.vibe64-ai-connections__account-list {
  overflow: hidden;
}

.vibe64-ai-connections__row {
  align-items: center;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(15rem, 1fr) auto auto;
  min-height: 5.75rem;
  padding: 1rem;
}

.vibe64-ai-connections__row + .vibe64-ai-connections__row {
  border-top: 1px solid rgba(var(--v-theme-outline), var(--v-border-opacity));
}

.vibe64-ai-connections__identity {
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.vibe64-ai-connections__status {
  justify-content: flex-end;
}

.vibe64-ai-connections__row-actions {
  justify-content: flex-end;
}

.vibe64-ai-connections__identity > span:last-child {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.vibe64-ai-connections__identity strong,
.vibe64-ai-connections__identity small {
  overflow-wrap: anywhere;
}

.vibe64-ai-connections__identity small,
.vibe64-ai-connections__model-access small,
.vibe64-ai-connections__zen-access small,
.vibe64-provider-editor__provider small {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.vibe64-ai-connections__model-access {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.05);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-on-surface));
  flex-wrap: wrap;
  gap: 1rem;
  grid-column: 1 / -1;
  justify-content: space-between;
  padding: 0.75rem 1rem;
}

.vibe64-ai-connections__model-access--paid {
  background: rgba(var(--v-theme-warning), 0.1);
  border-color: rgba(var(--v-theme-warning), 0.2);
}

.vibe64-ai-connections__zen-access {
  background: rgba(var(--v-theme-primary), 0.05);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-on-surface));
  gap: 0.75rem;
  grid-column: 1 / -1;
  padding: 0.9rem 1rem;
}

.vibe64-ai-connections__account-child {
  border-inline-start: 0.25rem solid rgba(var(--v-theme-primary), 0.55);
  margin-inline: 3.5rem 0.5rem;
  position: relative;
}

.vibe64-ai-connections__account-child::before {
  border-block-end: 2px solid rgba(var(--v-theme-primary), 0.35);
  border-end-start-radius: 0.5rem;
  border-inline-start: 2px solid rgba(var(--v-theme-primary), 0.35);
  block-size: 2.25rem;
  content: "";
  inline-size: 1.75rem;
  inset-block-start: -1rem;
  inset-inline-start: -2rem;
  position: absolute;
}

.vibe64-ai-connections__account-child-label {
  color: rgb(var(--v-theme-primary));
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  width: 100%;
}

.vibe64-ai-connections__zen-progress {
  gap: 0.35rem;
}

.vibe64-ai-connections__zen-actions {
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
  width: 100%;
}

.vibe64-ai-connections__model-access small {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.vibe64-ai-connections__model-access-copy {
  align-items: center;
  flex: 1 1 24rem;
  gap: 0.75rem;
  min-width: 0;
}

.vibe64-ai-connections__model-access-copy > span:last-child {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.vibe64-ai-connections__model-access .v-switch {
  flex: 0 0 auto;
}

.vibe64-provider-editor__route > span {
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.vibe64-ai-connections__security-note {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.vibe64-ai-connections__security-note,
.vibe64-provider-editor__security {
  align-items: center;
  font-size: 0.8125rem;
  gap: 0.5rem;
}

.vibe64-ai-connections__zero-state {
  padding-block: 0.25rem;
}

.vibe64-dialog-title {
  align-items: center;
  gap: 1rem;
  justify-content: space-between;
  padding: 1.25rem 1.5rem 0.5rem;
}

.vibe64-dialog-title > span {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
  white-space: normal;
}

.vibe64-dialog-title strong {
  overflow-wrap: anywhere;
}

.vibe64-dialog-title > :last-child {
  flex: 0 0 auto;
}

.vibe64-add-ai__body,
.vibe64-provider-picker__body,
.vibe64-provider-editor__body {
  padding: 1rem 1.5rem 1.5rem;
}

.vibe64-add-ai__body {
  align-content: start;
  display: grid;
  gap: 1rem;
}

.vibe64-add-ai__choice {
  display: flex;
  flex-direction: column;
}

.vibe64-add-ai__choice-copy {
  flex: 1;
}

.vibe64-add-ai__choice-actions {
  padding: 0 1rem 1rem;
}

.vibe64-add-ai__choice-action {
  min-height: 3rem;
}

.vibe64-codex-setup__body {
  padding: 1.5rem;
}

.vibe64-provider-picker__list {
  border-color: rgba(var(--v-theme-outline), var(--v-border-opacity));
  overflow: hidden;
}

.vibe64-provider-picker__item {
  min-height: 4.75rem;
}

.vibe64-provider-picker__item + .vibe64-provider-picker__item {
  border-top: 1px solid rgba(var(--v-theme-outline), var(--v-border-opacity));
}

.vibe64-provider-picker__empty {
  justify-items: center;
  padding: 2.5rem 1.5rem;
  text-align: center;
}

.vibe64-provider-picker__recovery .v-btn {
  justify-self: end;
}

.vibe64-provider-editor__provider {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-outline), var(--v-border-opacity));
  gap: 0.75rem;
  padding: 0.85rem;
}

.vibe64-provider-editor__provider > span:last-child {
  gap: 0.1rem;
}

.vibe64-provider-editor__route {
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-outline), var(--v-border-opacity));
  display: grid;
  gap: 0.45rem;
  padding: 0.85rem;
}

.vibe64-provider-editor__route p {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.875rem;
  line-height: 1.45;
}

.vibe64-provider-editor__recovery {
  gap: 0.5rem;
  justify-content: flex-end;
}

.vibe64-provider-editor__actions {
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0 1.5rem 1.25rem;
}

.vibe64-ai-connections__confirm-header {
  padding: 1.25rem 1.25rem 0.5rem;
}

.vibe64-ai-connections__confirm-actions {
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0.75rem 1.25rem 1.25rem;
}

.vibe64-ai-connections__confirm-subtitle {
  overflow: visible;
  text-overflow: initial;
  white-space: normal;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__page-actions,
.vibe64-ai-connections--compact .vibe64-ai-connections__row-actions,
.vibe64-ai-connections--compact .vibe64-provider-editor__actions .v-btn {
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__page-actions {
  display: grid;
  grid-template-columns: 3rem minmax(0, 1fr);
}

.vibe64-ai-connections--compact .vibe64-ai-connections__page-actions .v-btn {
  min-width: 0;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__recommendation-actions {
  align-items: stretch;
  flex-direction: column;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__recommendation-primary {
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__recommendation-actions > span {
  align-items: flex-start;
  display: grid;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__row {
  align-items: stretch;
  grid-template-columns: minmax(0, 1fr);
}

.vibe64-ai-connections--compact .vibe64-ai-connections__identity,
.vibe64-ai-connections--compact .vibe64-ai-connections__status,
.vibe64-ai-connections--compact .vibe64-ai-connections__row-actions,
.vibe64-ai-connections--compact .vibe64-ai-connections__model-access,
.vibe64-ai-connections--compact .vibe64-ai-connections__zen-access {
  grid-column: 1;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__account-child {
  margin-inline: 1rem 0;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__account-child::before {
  inline-size: 0.75rem;
  inset-inline-start: -1rem;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__status,
.vibe64-ai-connections--compact .vibe64-ai-connections__row-actions {
  justify-content: flex-start;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__row-actions .v-btn {
  flex: 1 1 auto;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__model-access {
  align-items: stretch;
  flex-direction: column;
  flex-wrap: nowrap;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__model-access-copy {
  flex: 0 1 auto;
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__model-access .v-switch {
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__zen-actions .v-btn {
  min-width: 0;
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-provider-editor__recovery .v-btn {
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-provider-editor__actions,
.vibe64-ai-connections--compact .vibe64-provider-editor__recovery {
  align-items: stretch;
  flex-direction: column-reverse;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__confirm-actions {
  align-items: stretch;
  flex-direction: column-reverse;
}

.vibe64-ai-connections--compact .vibe64-ai-connections__confirm-actions .v-btn {
  width: 100%;
}

.vibe64-ai-connections--compact .vibe64-codex-setup__body {
  padding: 4rem 1rem 1rem;
}

@media (max-width: 600px) {
  .vibe64-ai-connections__confirm-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .vibe64-ai-connections__confirm-actions .v-btn {
    width: 100%;
  }
}
</style>

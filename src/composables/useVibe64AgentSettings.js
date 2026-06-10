import { computed, ref, watch } from "vue";
import {
  defaultVibe64AgentSettings,
  normalizeVibe64AgentSettings
} from "@local/vibe64-runtime/shared";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  useVibe64AppAuth
} from "@/composables/useVibe64AppAuth.js";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import {
  vibe64ProjectScopedStorageKey
} from "@/lib/vibe64ProjectScope.js";

const AGENT_SETTINGS_STORAGE_KEY = "vibe64:agent-settings";
const MISSING_STORAGE_VALUE = Object.freeze({
  missing: true
});

function normalizeAgentSettingsEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function agentSettingsStorageKey(baseKey = "", projectSlug = "", email = "") {
  const projectKey = vibe64ProjectScopedStorageKey(baseKey, projectSlug);
  const normalizedEmail = normalizeAgentSettingsEmail(email);
  return normalizedEmail
    ? `${projectKey}:user:${normalizedEmail}`
    : projectKey;
}

function useVibe64AgentSettings() {
  const projectSlug = useVibe64ProjectSlug();
  const auth = useVibe64AppAuth();
  const userEmail = computed(() => normalizeAgentSettingsEmail(auth?.state?.user?.email));
  const legacyStorageKey = computed(() => vibe64ProjectScopedStorageKey(
    AGENT_SETTINGS_STORAGE_KEY,
    projectSlug.value
  ));
  const storageKey = computed(() => agentSettingsStorageKey(
    AGENT_SETTINGS_STORAGE_KEY,
    projectSlug.value,
    userEmail.value
  ));
  const settings = ref(defaultVibe64AgentSettings());

  function load() {
    const stored = readLocalStorageJson(storageKey.value, MISSING_STORAGE_VALUE);
    if (stored !== MISSING_STORAGE_VALUE) {
      settings.value = normalizeVibe64AgentSettings(stored);
      return;
    }
    settings.value = normalizeVibe64AgentSettings(
      readLocalStorageJson(legacyStorageKey.value, defaultVibe64AgentSettings())
    );
  }

  function update(partial = {}) {
    settings.value = normalizeVibe64AgentSettings({
      ...settings.value,
      ...(partial && typeof partial === "object" && !Array.isArray(partial) ? partial : {})
    });
  }

  watch([storageKey, legacyStorageKey], load, {
    immediate: true
  });

  watch(settings, (value) => {
    writeLocalStorageJson(storageKey.value, normalizeVibe64AgentSettings(value));
  }, {
    deep: true
  });

  return {
    settings,
    update
  };
}

export {
  agentSettingsStorageKey,
  useVibe64AgentSettings
};

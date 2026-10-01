import { computed, ref, toValue, watch } from "vue";
import {
  VIBE64_DEFAULT_AGENT_PROVIDER_ID,
  defaultVibe64AgentSettings,
  normalizeVibe64AgentSettings
} from "@local/vibe64-runtime/shared";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import {
  vibe64ProjectScopedStorageKey
} from "@/lib/vibe64ProjectScope.js";

const AGENT_SETTINGS_STORAGE_KEY = "vibe64:agent-settings";

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

function useVibe64AgentSettings({ projectSlug: projectSlugInput } = {}) {
  const projectSlug = projectSlugInput === undefined ? useVibe64ProjectSlug() : computed(() => toValue(projectSlugInput));
  const storageKey = computed(() => agentSettingsStorageKey(
    AGENT_SETTINGS_STORAGE_KEY,
    projectSlug.value,
    ""
  ));
  const settings = ref(defaultVibe64AgentSettings());

  function load() {
    settings.value = normalizeVibe64AgentSettings(
      readLocalStorageJson(storageKey.value, defaultVibe64AgentSettings())
    );
  }

  function update(partial = {}) {
    settings.value = normalizeVibe64AgentSettings({
      ...settings.value,
      ...(partial && typeof partial === "object" && !Array.isArray(partial) ? partial : {})
    });
  }

  watch(storageKey, load, {
    immediate: true
  });

  watch(settings, (value) => {
    writeLocalStorageJson(storageKey.value, normalizeVibe64AgentSettings(value));
  }, {
    deep: true
  });

  const requestSettings = computed(() => {
    const value = settings.value;
    return value.providerId !== VIBE64_DEFAULT_AGENT_PROVIDER_ID || value.model || value.thinking ? value : null;
  });

  return {
    requestSettings,
    settings,
    update
  };
}

export {
  agentSettingsStorageKey,
  useVibe64AgentSettings
};

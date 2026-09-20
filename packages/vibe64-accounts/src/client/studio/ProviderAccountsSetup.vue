<template>
  <v-defaults-provider :defaults="{ VBtn: { minHeight: 48, rounded: 'pill' } }">
    <section class="accounts-setup">
      <header class="accounts-setup__header">
        <div class="accounts-setup__heading">
          <h1 class="text-headline-small ma-0">{{ title }}</h1>
          <slot name="close" />
        </div>
        <p v-if="lede" class="text-body-medium text-medium-emphasis ma-0">
          {{ lede }}
        </p>
        <div class="accounts-setup__header-actions">
          <v-chip
            :color="statusReady ? 'success' : undefined"
            size="small"
            variant="tonal"
          >
            {{ statusReady ? readyLabel : authBusy || authStartBusy ? "Signing in" : neededLabel }}
          </v-chip>
          <template v-for="{ account, session, authorizeStep } in setupRows" :key="account.id">
            <v-btn
              v-if="authorizeStep"
              color="primary"
              :disabled="!accountsReadyForActions"
              :prepend-icon="mdiArrowLeft"
              variant="text"
              @click="setCodexAuthStep(session, 'settings')"
            >
              Previous step
            </v-btn>
            <v-btn
              v-if="session"
              :disabled="!accountsReadyForActions || !session.id"
              variant="text"
              @click="cancelSession(session)"
            >
              Cancel login
            </v-btn>
          </template>
          <v-btn
            v-if="backLabel && !authBusy"
            color="primary"
            variant="text"
            @click="emit('back')"
          >
            {{ backLabel }}
          </v-btn>
          <v-btn
            v-if="!authBusy"
            :aria-busy="accountsLoading ? 'true' : undefined"
            color="primary"
            :disabled="accountsLoading"
            variant="text"
            :prepend-icon="mdiRefresh"
            @click="refreshStatus"
          >
            {{ accountsLoading ? "Refreshing…" : "Refresh" }}
          </v-btn>
          <v-btn
            v-if="statusReady && showContinue"
            color="primary"
            :disabled="!accountsReadyForActions"
            variant="flat"
            @click="emit('continue')"
          >
            {{ continueLabel }}
          </v-btn>
        </div>
      </header>

      <v-alert
        v-if="errorMessage"
        class="accounts-setup__notice"
        type="error"
        variant="tonal"
        border="start"
      >
        {{ errorMessage }}
      </v-alert>

      <v-alert
        v-if="!actionsEnabled && actionsDisabledMessage"
        class="accounts-setup__notice"
        type="info"
        variant="tonal"
        border="start"
      >
        {{ actionsDisabledMessage }}
      </v-alert>

      <v-skeleton-loader
        v-if="accountsLoading && accountRows.length < 1"
        type="list-item-avatar-two-line, actions"
      />

      <div class="accounts-setup__items">
        <v-sheet
          v-for="{ account, session, userCode, settingsStep, authorizeStep, statusMessage } in setupRows"
          :key="account.id"
          rounded="xl"
          :border="!session"
          :color="session ? 'transparent' : undefined"
          :class="[
            'accounts-setup__item',
            session ? 'pa-0' : 'pa-4 pa-sm-6',
            !accountsReadyForActions ? 'accounts-setup__item--busy' : ''
          ]"
        >
          <div v-if="!session" class="accounts-setup__item-main">
            <v-icon
              :icon="account.connected ? mdiCheckCircle : mdiAccountCircleOutline"
              :color="account.connected ? 'success' : 'primary'"
              size="30"
            />
            <div>
              <h2 class="text-title-medium ma-0">{{ account.label }}</h2>
              <p class="text-body-medium text-medium-emphasis ma-0">
                {{ account.message || accountStatusMessage(account) }}
              </p>
              <p
                v-if="account.username"
                class="accounts-setup__identity"
              >
                {{ account.username }}
              </p>
              <p
                v-else-if="account.previousUsername"
                class="accounts-setup__identity"
              >
                Previously linked: @{{ account.previousUsername }}
              </p>
            </div>
          </div>

          <div
            v-if="!session"
            class="accounts-setup__actions"
          >
            <div
              v-if="requiresGitIdentity(account)"
              class="accounts-setup__identity-fields"
            >
              <v-text-field
                v-model="gitIdentityInput(account).name"
                autocomplete="name"
                density="compact"
                hide-details="auto"
                label="Git user.name"
                required
                :disabled="!accountsReadyForActions"
                variant="outlined"
              />
              <v-text-field
                v-model="gitIdentityInput(account).email"
                autocomplete="email"
                density="compact"
                hide-details="auto"
                label="Git user.email"
                required
                type="email"
                :disabled="!accountsReadyForActions"
                variant="outlined"
              />
            </div>
            <v-btn
              v-if="account.id !== 'codex' || !account.connected"
              :aria-busy="primaryAuthPending(account) ? 'true' : undefined"
              class="accounts-setup__pending-action"
              color="primary"
              :variant="apiKeyFormVisible(account) ? 'text' : 'flat'"
              :disabled="!accountsReadyForActions || accountLoginDisabled(account)"
              @click="startAccountAuth(account)"
            >
              {{ primaryAuthLabel(account) }}
            </v-btn>
            <HelperModelSettings
              v-if="account.id === 'codex' && account.connected"
              :disabled="!accountsReadyForActions"
            />
            <v-btn
              v-if="account.connected"
              :aria-busy="logoutAccountId === account.id ? 'true' : undefined"
              color="error"
              variant="text"
              :disabled="!accountsReadyForActions || authBusy || authStartBusy || logoutAccountId === account.id || !account.connected"
              @click="logoutAccount(account.id)"
            >
              {{ logoutAccountId === account.id ? "Disconnecting…" : "Disconnect" }}
            </v-btn>
            <v-btn
              v-if="accountSupportsApiKeyAuth(account)"
              color="primary"
              variant="tonal"
              :disabled="!accountsReadyForActions || authBusy || authStartBusy"
              @click="toggleApiKeyForm(account)"
            >
              Use OpenAI API key
            </v-btn>
            <div
              v-if="accountSupportsApiKeyAuth(account) && apiKeyFormVisible(account)"
              class="accounts-setup__api-key-form"
            >
              <v-text-field
                v-model="apiKeyInput(account).value"
                autocomplete="off"
                density="compact"
                hide-details="auto"
                label="OpenAI API key"
                required
                type="password"
                :disabled="!accountsReadyForActions || authStartBusy"
                variant="outlined"
              />
              <v-btn
                :aria-busy="primaryAuthPending(account) ? 'true' : undefined"
                class="accounts-setup__pending-action"
                color="primary"
                variant="flat"
                :disabled="!accountsReadyForActions || apiKeyLoginDisabled(account)"
                @click="startAccountApiKeyAuth(account)"
              >
                {{ primaryAuthPending(account) ? "Starting login…" : "Login with API key" }}
              </v-btn>
            </div>
          </div>

          <div
            v-if="session"
            class="accounts-setup__session"
          >
            <ol
              v-if="settingsStep || authorizeStep"
              aria-label="Connect Codex"
              class="accounts-setup__steps pa-0 mt-0 mb-2"
            >
              <li
                :aria-current="settingsStep ? 'step' : undefined"
                class="d-flex align-center ga-2 text-label-large"
              >
                <v-avatar
                  color="primary"
                  size="28"
                  :variant="settingsStep ? 'flat' : 'tonal'"
                >
                  1
                </v-avatar>
                Prepare
              </li>
              <li class="accounts-setup__step-divider" aria-hidden="true"><v-divider /></li>
              <li
                :aria-current="authorizeStep ? 'step' : undefined"
                class="d-flex align-center ga-2 text-label-large"
              >
                <v-avatar
                  :color="authorizeStep ? 'primary' : undefined"
                  size="28"
                  :variant="authorizeStep ? 'flat' : 'tonal'"
                >
                  2
                </v-avatar>
                Connect
              </li>
            </ol>

            <div
              v-if="settingsStep"
              class="accounts-setup__instruction-copy"
            >
              <h2 class="text-title-large ma-0">Allow sign-in with a code</h2>
              <p class="text-body-medium text-medium-emphasis ma-0">
                In ChatGPT’s Security settings, turn on “Enable device code authorization for Codex”.
              </p>
              <div class="accounts-setup__settings-actions">
                <v-btn
                  class="accounts-setup__settings-action"
                  color="primary"
                  :href="CHATGPT_SECURITY_SETTINGS_URL"
                  :append-icon="mdiOpenInNew"
                  rel="noopener"
                  target="_blank"
                  variant="tonal"
                >
                  Open ChatGPT settings
                </v-btn>
                <v-btn
                  class="accounts-setup__settings-action"
                  color="primary"
                  :disabled="!accountsReadyForActions"
                  variant="flat"
                  @click="setCodexAuthStep(session, 'authorize')"
                >
                  It’s enabled — continue
                </v-btn>
              </div>
              <v-expansion-panels variant="accordion" flat>
                <v-expansion-panel bg-color="transparent" rounded="lg">
                  <v-expansion-panel-title min-height="48" class="text-body-medium px-0">
                    Where is this setting?
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <img
                      alt="ChatGPT Security settings with device code authorization for Codex enabled"
                      class="accounts-setup__reference-image"
                      :src="codexDeviceSettingsImage"
                    >
                    <p class="text-body-small text-medium-emphasis mt-3 mb-0">
                      If your workspace manages this setting, ask a workspace admin to enable it.
                    </p>
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>
            </div>

            <div v-else class="accounts-setup__instruction-copy">
              <v-sheet
                v-if="userCode || authorizeStep"
                class="accounts-setup__code-block pa-4"
                color="surface-light"
                rounded="lg"
              >
                <p class="text-label-large text-medium-emphasis ma-0">One-time code</p>
                <div class="accounts-setup__code-row">
                  <p
                    v-if="userCode"
                    class="accounts-setup__code text-headline-large"
                  >
                    {{ userCode }}
                  </p>
                  <p v-else-if="session?.status === 'failed'" class="text-body-medium ma-0">Code unavailable</p>
                  <v-skeleton-loader v-else aria-label="Waiting for your one-time code" height="48" type="heading" />
                  <v-btn
                    aria-label="Copy one-time code"
                    color="primary"
                    :disabled="!accountsReadyForActions || !userCode"
                    :icon="mdiContentCopy"
                    size="48"
                    title="Copy one-time code"
                    variant="tonal"
                    @click="copyAuthCode(session)"
                  />
                </div>
                <p class="accounts-setup__copy-status text-body-small text-medium-emphasis ma-0" role="status">
                  <template v-if="authCopyStatus[session.id]">{{ authCopyStatus[session.id] }}</template>
                  <template v-else-if="userCode">Copy this code before continuing.</template>
                  <template v-else-if="session.status === 'failed'">Cancel this attempt to try again.</template>
                  <template v-else>Your code will appear here.</template>
                </p>
              </v-sheet>
              <v-btn
                v-if="authorizeStep || session?.authUrl"
                class="accounts-setup__authorize-action"
                color="primary"
                :disabled="!accountsReadyForActions || !session?.authUrl || (authorizeStep && !userCode)"
                :append-icon="mdiOpenInNew"
                variant="flat"
                @click="openAuthUrl(session)"
              >
                {{ authorizeStep ? "Continue to ChatGPT" : "Continue in browser" }}
              </v-btn>
              <p v-if="statusMessage" class="text-body-medium text-medium-emphasis ma-0" role="status">
                {{ statusMessage }}
              </p>
              <v-expansion-panels
                v-if="authorizeStep"
                variant="accordion"
                flat
              >
                <v-expansion-panel bg-color="transparent" rounded="lg">
                  <v-expansion-panel-title min-height="48" class="text-body-medium px-0">
                    What will I see in ChatGPT?
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <img
                      alt="Codex device authorization page with one-time code entry fields"
                      class="accounts-setup__reference-image"
                      :src="codexDeviceAuthorizeImage"
                    >
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>
            </div>

            <div
              v-if="authTerminalVisible(session)"
              class="accounts-setup__terminal"
            >
              <Vibe64Terminal
                :collapsible="true"
                :command-preview="authTerminal.terminalCommandPreview"
                :error="authTerminalError(session)"
                :expanded="authTerminalExpanded"
                mobile-takeover
                presentation="inline"
                :show-close="false"
                show-copy
                surface-class="bg-surface-light"
                :stage="authTerminalStage"
                :status="authTerminal.terminalStatus"
                subtitle="Use this only if the login asks for terminal input."
                :terminal="authTerminal"
                :title="authTerminalTitle"
                :visible="true"
                @update:expanded="updateAuthTerminalExpanded"
              />
            </div>
          </div>
        </v-sheet>
      </div>
    </section>
  </v-defaults-provider>
</template>

<script setup>
import { computed } from "vue";
import HelperModelSettings from "./HelperModelSettings.vue";
import {
  mdiAccountCircleOutline,
  mdiArrowLeft,
  mdiCheckCircle,
  mdiContentCopy,
  mdiOpenInNew,
  mdiRefresh
} from "@mdi/js";
import codexDeviceAuthorizeImage from "/src/assets/codex-device-code-authorize.png";
import codexDeviceSettingsImage from "/src/assets/codex-device-code-settings.png";
import Vibe64Terminal from "/src/components/studio/Vibe64Terminal.vue";
import {
  useProviderAccountsSetup
} from "../composables/useProviderAccountsSetup.js";

const props = defineProps({
  accounts: {
    required: true,
    type: Object
  },
  actionsDisabledMessage: {
    default: "",
    type: String
  },
  actionsEnabled: {
    default: true,
    type: Boolean
  },
  accountRows: {
    default: () => [],
    type: Array
  },
  backLabel: {
    default: "",
    type: String
  },
  continueLabel: {
    default: "Continue",
    type: String
  },
  lede: {
    default: "",
    type: String
  },
  neededLabel: {
    default: "Accounts needed",
    type: String
  },
  readyLabel: {
    default: "Accounts ready",
    type: String
  },
  showContinue: {
    default: true,
    type: Boolean
  },
  statusLoaded: {
    default: true,
    type: Boolean
  },
  title: {
    default: "Accounts",
    type: String
  }
});

const emit = defineEmits(["back", "continue"]);

const {
  CHATGPT_SECURITY_SETTINGS_URL,
  accountActiveSession,
  accountLoginDisabled,
  accountRows,
  accountStatusMessage,
  accountSupportsApiKeyAuth,
  accountsLoading,
  accountsReadyForActions,
  apiKeyFormVisible,
  apiKeyInput,
  apiKeyLoginDisabled,
  authSessionUserCode,
  authBusy,
  authStartBusy,
  authCopyStatus,
  authTerminal,
  authTerminalExpanded,
  authTerminalError,
  authTerminalStage,
  authTerminalTitle,
  authTerminalVisible,
  cancelSession,
  codexAuthorizeStepVisible,
  codexSettingsStepVisible,
  copyAuthCode,
  errorMessage,
  gitIdentityInput,
  logoutAccount,
  logoutAccountId,
  openAuthUrl,
  primaryAuthLabel,
  primaryAuthPending,
  requiresGitIdentity,
  refreshStatus,
  sessionStatusMessage,
  setCodexAuthStep,
  startAccountApiKeyAuth,
  startAccountAuth,
  statusReady,
  toggleApiKeyForm,
  updateAuthTerminalExpanded
} = useProviderAccountsSetup(props);

const setupRows = computed(() => accountRows.value.map((account) => {
  const session = accountActiveSession(account);
  return {
    account,
    session,
    userCode: session ? authSessionUserCode(session) : "",
    statusMessage: session ? sessionStatusMessage(session) : "",
    settingsStep: codexSettingsStepVisible(session),
    authorizeStep: codexAuthorizeStepVisible(session)
  };
}));
</script>

<style scoped>
.accounts-setup {
  display: grid;
  gap: 1.5rem;
  width: 100%;
}

.accounts-setup__header,
.accounts-setup__notice,
.accounts-setup__items {
  margin-inline: auto;
  max-width: 68rem;
  min-width: 0;
  width: 100%;
}

.accounts-setup__header,
.accounts-setup__items {
  display: grid;
  gap: 0.75rem;
}

.accounts-setup__heading,
.accounts-setup__header-actions,
.accounts-setup__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.accounts-setup__heading {
  flex-wrap: nowrap;
  justify-content: space-between;
}

.accounts-setup__identity-fields {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr));
  width: 100%;
}

.accounts-setup__api-key-form {
  align-items: start;
  display: grid;
  flex-basis: 100%;
  gap: 0.75rem;
  max-width: 42rem;
}

.accounts-setup__identity {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-weight: 500;
  margin-top: 0.25rem;
  overflow-wrap: anywhere;
}

.accounts-setup__item {
  display: grid;
  gap: 1.5rem;
  min-width: 0;
}

.accounts-setup__item-main {
  align-items: start;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr);
}

.accounts-setup__session,
.accounts-setup__instruction-copy {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.accounts-setup__steps {
  align-items: center;
  display: flex;
  gap: 1rem;
  list-style: none;
}

.accounts-setup__steps li {
  flex-shrink: 0;
}

.accounts-setup__steps .accounts-setup__step-divider {
  flex: 1;
}

.accounts-setup__steps [aria-current="step"] {
  color: rgb(var(--v-theme-primary));
}

.accounts-setup__code-block {
  container-type: inline-size;
  display: grid;
  gap: 0.5rem;
}

.accounts-setup__code-row {
  align-items: center;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: minmax(0, 1fr) auto;
}

.accounts-setup__code {
  /* Fit the full provider code beside its copy action, including in a narrow dialog. */
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: clamp(1rem, 7cqi, 2rem) !important;
  letter-spacing: 0.04em !important;
  margin: 0;
  white-space: nowrap;
}

.accounts-setup__copy-status {
  min-height: 1.25rem;
}

.accounts-setup__settings-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.accounts-setup__settings-action {
  max-width: 100%;
}

.accounts-setup__authorize-action {
  width: 100%;
}

.accounts-setup__reference-image {
  display: block;
  height: auto;
  max-width: 100%;
}

.accounts-setup__terminal {
  min-width: 0;
}

.accounts-setup__pending-action {
  min-inline-size: 9rem;
}
</style>

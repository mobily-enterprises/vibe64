<template>
  <section class="smtp-login-setup">
    <header class="smtp-login-setup__header">
      <div>
        <p class="smtp-login-setup__kicker">Email delivery</p>
        <h2>{{ title }}</h2>
        <p class="smtp-login-setup__lede">{{ lede }}</p>
      </div>
      <div class="smtp-login-setup__header-actions">
        <v-chip
          :color="smtpReady ? 'success' : 'warning'"
          variant="tonal"
        >
          {{ smtpReady ? "Connection ready" : "Connection needed" }}
        </v-chip>
        <v-btn
          :disabled="appAuth.isLoading"
          :loading="appAuth.isLoading"
          :prepend-icon="mdiRefresh"
          type="button"
          variant="outlined"
          @click="refresh"
        >
          Refresh
        </v-btn>
      </div>
    </header>

    <v-alert
      v-if="appAuth.loadError"
      border="start"
      type="error"
      variant="tonal"
    >
      {{ appAuth.loadError }}
    </v-alert>
    <v-alert
      v-if="message"
      border="start"
      :type="messageType"
      variant="tonal"
    >
      {{ message }}
    </v-alert>

    <v-sheet
      border
      class="smtp-login-setup__panel"
      rounded="lg"
    >
      <div class="smtp-login-setup__status">
        <v-icon
          :color="smtpReady ? 'success' : 'warning'"
          :icon="smtpReady ? mdiCheckCircle : mdiAlertCircleOutline"
          size="32"
        />
        <div>
          <h3>{{ smtpStatusTitle }}</h3>
          <p>{{ statusText }}</p>
        </div>
      </div>

      <div class="smtp-login-setup__grid">
        <v-text-field
          v-model="form.smtpHost"
          autocomplete="off"
          hide-details="auto"
          label="SMTP host"
          variant="outlined"
        />
        <v-text-field
          v-model="form.smtpPort"
          autocomplete="off"
          hide-details="auto"
          label="SMTP port"
          variant="outlined"
        />
        <v-text-field
          v-model="form.smtpUser"
          autocomplete="username"
          hide-details="auto"
          label="SMTP username"
          variant="outlined"
        />
        <v-text-field
          v-model="form.smtpPassword"
          autocomplete="off"
          hide-details="auto"
          :placeholder="passwordPlaceholder"
          label="SMTP password"
          type="password"
          variant="outlined"
        />
        <v-text-field
          v-model="form.fromEmail"
          autocomplete="email"
          hide-details="auto"
          label="Sender email"
          type="email"
          variant="outlined"
        />
        <v-text-field
          v-model="form.fromName"
          autocomplete="off"
          hide-details="auto"
          label="Sender name"
          variant="outlined"
        />
      </div>

      <div class="smtp-login-setup__actions">
        <v-btn
          color="primary"
          :disabled="saveDisabled"
          :loading="saveBusy"
          :prepend-icon="mdiContentSave"
          type="button"
          variant="flat"
          @click="save"
        >
          Save SMTP login
        </v-btn>
        <v-btn
          color="warning"
          :disabled="removeDisabled"
          :loading="removeBusy"
          type="button"
          variant="tonal"
          @click="remove"
        >
          Remove saved login
        </v-btn>
      </div>
    </v-sheet>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiContentSave,
  mdiRefresh
} from "@mdi/js";

import {
  useManagedAppAuth
} from "../composables/useManagedAppAuth.js";

defineProps({
  lede: {
    type: String,
    default: "Save the SMTP login Vibe64 uses when it configures managed Supabase Auth email delivery."
  },
  title: {
    type: String,
    default: "SMTP Login"
  }
});

const appAuth = useManagedAppAuth();
const operationMessage = ref("");
const operationMessageType = ref("info");
const form = reactive({
  fromEmail: "",
  fromName: "",
  smtpHost: "",
  smtpPassword: "",
  smtpPort: "587",
  smtpUser: ""
});

const status = computed(() => appAuth.status || {});
const smtp = computed(() => status.value.smtp || {});
const smtpReady = computed(() => smtp.value.ready === true);
const passwordSaved = computed(() => smtp.value.passwordPresent === true);
const smtpSaved = computed(() => {
  return Boolean(
    smtp.value.fromEmail ||
    smtp.value.fromName ||
    smtp.value.host ||
    smtp.value.passwordPresent ||
    smtp.value.port ||
    smtp.value.username
  );
});
const saveBusy = computed(() => appAuth.saveSmtpLoginCommand?.isRunning === true);
const removeBusy = computed(() => appAuth.disconnectSmtpLoginCommand?.isRunning === true);
const passwordPlaceholder = computed(() => passwordSaved.value ? "Saved password" : "");
const message = computed(() => operationMessage.value || appAuth.saveSmtpLoginCommand?.message || appAuth.disconnectSmtpLoginCommand?.message || "");
const messageType = computed(() => {
  if (operationMessage.value) {
    return operationMessageType.value;
  }
  return appAuth.saveSmtpLoginCommand?.messageType === "error" ||
    appAuth.disconnectSmtpLoginCommand?.messageType === "error"
    ? "error"
    : "info";
});
const saveDisabled = computed(() => {
  return saveBusy.value ||
    !form.smtpHost.trim() ||
    !form.smtpPort.trim() ||
    !form.smtpUser.trim() ||
    (!form.smtpPassword.trim() && !passwordSaved.value) ||
    !form.fromEmail.trim();
});
const removeDisabled = computed(() => removeBusy.value || !smtpSaved.value);
const smtpStatusTitle = computed(() => {
  if (smtpReady.value) {
    return "SMTP login is saved";
  }
  return smtpSaved.value ? "SMTP login is incomplete" : "SMTP login is missing";
});
const statusText = computed(() => {
  if (smtpReady.value) {
    return "Managed Supabase setup and sync will apply these SMTP settings to the shared dev and prod Auth projects.";
  }
  if (smtpSaved.value) {
    return "Some SMTP login details are saved, but required fields are still missing.";
  }
  return "Supabase free projects need a real SMTP login for reliable login and password emails.";
});

watch(
  smtp,
  (nextSmtp) => {
    form.fromEmail = nextSmtp.fromEmail || "";
    form.fromName = nextSmtp.fromName || "";
    form.smtpHost = nextSmtp.host || "";
    form.smtpPassword = "";
    form.smtpPort = nextSmtp.port || "587";
    form.smtpUser = nextSmtp.username || "";
  },
  {
    immediate: true
  }
);

async function refresh() {
  operationMessage.value = "";
  await appAuth.refresh();
}

async function save() {
  if (saveDisabled.value) {
    return;
  }
  operationMessage.value = "";
  const result = await appAuth.saveSmtpLogin({
    fromEmail: form.fromEmail,
    fromName: form.fromName,
    smtpHost: form.smtpHost,
    smtpPassword: form.smtpPassword,
    smtpPort: form.smtpPort,
    smtpUser: form.smtpUser
  });
  if (result?.ok !== false) {
    form.smtpPassword = "";
    if (result?.syncError?.message) {
      operationMessage.value = `SMTP login saved, but Supabase sync failed: ${result.syncError.message}`;
      operationMessageType.value = "error";
    } else if (result?.sync?.smtpConfigured) {
      operationMessage.value = "SMTP login saved and synced to managed Supabase projects.";
      operationMessageType.value = "info";
    } else {
      operationMessage.value = "SMTP login saved.";
      operationMessageType.value = "info";
    }
  }
}

async function remove() {
  if (removeDisabled.value) {
    return;
  }
  operationMessage.value = "";
  const result = await appAuth.disconnectSmtpLogin();
  if (result?.ok !== false) {
    form.smtpPassword = "";
    operationMessage.value = "Saved SMTP login removed from Vibe64.";
    operationMessageType.value = "info";
  }
}
</script>

<style scoped>
.smtp-login-setup {
  display: grid;
  gap: 1rem;
}

.smtp-login-setup__header {
  align-items: start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.smtp-login-setup__header-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: flex-end;
}

.smtp-login-setup__kicker {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.75rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.1;
  margin: 0 0 0.25rem;
  text-transform: uppercase;
}

.smtp-login-setup h2,
.smtp-login-setup h3 {
  letter-spacing: 0;
  margin: 0;
}

.smtp-login-setup h2 {
  font-size: 1.24rem;
  font-weight: 760;
  line-height: 1.2;
}

.smtp-login-setup h3 {
  font-size: 1rem;
  font-weight: 740;
  line-height: 1.25;
}

.smtp-login-setup p {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.88rem;
  line-height: 1.42;
  margin: 0;
}

.smtp-login-setup__panel {
  display: grid;
  gap: 1rem;
  padding: 1rem;
}

.smtp-login-setup__status {
  align-items: start;
  display: flex;
  gap: 0.8rem;
}

.smtp-login-setup__grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.smtp-login-setup__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

@media (max-width: 760px) {
  .smtp-login-setup__header,
  .smtp-login-setup__grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

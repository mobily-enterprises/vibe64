<script setup>
import { computed, onMounted, ref } from "vue";
import {
  mdiAccountAlertOutline,
  mdiAccountCheckOutline,
  mdiClose,
  mdiGithub,
  mdiRefresh
} from "@mdi/js";
import {
  inviteProjectAccess,
  readProjectAccess
} from "@/lib/vibe64ProjectApi.js";

const props = defineProps({
  project: {
    default: () => ({}),
    type: Object
  }
});

const emit = defineEmits(["close"]);

const loading = ref(true);
const refreshing = ref(false);
const actionBusy = ref("");
const error = ref("");
const status = ref(null);

const repositoryName = computed(() => (
  status.value?.repository?.fullName ||
  props.project?.githubRepository?.fullName ||
  ""
));
const users = computed(() => Array.isArray(status.value?.users) ? status.value.users : []);
const canManageAccess = computed(() => status.value?.currentUserCanManageAccess === true);
const tenantCountLabel = computed(() => {
  const limit = status.value?.userLimit;
  return limit ? `${users.value.length} / ${limit}` : String(users.value.length);
});

onMounted(() => {
  void loadAccess();
});

async function loadAccess({
  quiet = false
} = {}) {
  if (quiet) {
    refreshing.value = true;
  } else {
    loading.value = true;
  }
  error.value = "";
  try {
    const response = await readProjectAccess(props.project?.slug || "");
    if (response.ok === false) {
      throw new Error(response.errors?.[0]?.message || response.error || "Project access could not load.");
    }
    status.value = response;
  } catch (loadError) {
    error.value = String(loadError?.message || loadError || "Project access could not load.");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function inviteUser(row = {}) {
  const email = String(row.email || "").trim();
  if (!email) {
    return;
  }
  actionBusy.value = email;
  error.value = "";
  try {
    const response = await inviteProjectAccess(props.project?.slug || "", {
      email,
      permission: "push"
    });
    if (response.ok === false) {
      throw new Error(response.errors?.[0]?.message || response.error || "GitHub invite failed.");
    }
    await loadAccess({
      quiet: true
    });
  } catch (inviteError) {
    error.value = String(inviteError?.message || inviteError || "GitHub invite failed.");
  } finally {
    actionBusy.value = "";
  }
}

function accessLabel(row = {}) {
  const access = row.access || {};
  if (access.status === "github-not-connected") {
    return "Connect GitHub";
  }
  if (access.status === "inactive") {
    return "Inactive";
  }
  if (access.status === "no-access") {
    return "No access";
  }
  if (access.permission) {
    return access.permission.toLowerCase();
  }
  return "Unknown";
}

function accessColor(row = {}) {
  const access = row.access || {};
  if (access.canPush) {
    return "success";
  }
  if (access.canRead) {
    return "info";
  }
  if (access.status === "no-access") {
    return "warning";
  }
  return "default";
}

function canInvite(row = {}) {
  return canManageAccess.value &&
    row.status === "active" &&
    row.github?.login &&
    row.access?.canPush !== true;
}
</script>

<template>
  <section class="project-access">
    <header class="project-access__header">
      <div>
        <p>Project Access</p>
        <h2>{{ project.slug }}</h2>
        <span v-if="repositoryName">
          <v-icon :icon="mdiGithub" />
          {{ repositoryName }}
        </span>
      </div>
      <v-btn
        :icon="mdiClose"
        aria-label="Close project access"
        size="small"
        type="button"
        variant="text"
        @click="emit('close')"
      />
    </header>

    <v-alert v-if="error" type="error" variant="tonal" density="compact">
      {{ error }}
    </v-alert>

    <div v-if="loading" class="project-access__loading">
      <v-progress-circular color="primary" indeterminate />
    </div>

    <template v-else>
      <v-alert
        v-if="!canManageAccess"
        type="info"
        variant="tonal"
        density="compact"
      >
        Your GitHub account cannot manage access for this repository. Ask a repository administrator to grant write access to tenant users.
      </v-alert>

      <section class="project-access__summary" aria-label="Access summary">
        <div>
          <span>Tenant users</span>
          <strong>{{ tenantCountLabel }}</strong>
        </div>
        <v-btn
          :loading="refreshing"
          size="small"
          type="button"
          variant="text"
          @click="loadAccess({ quiet: true })"
        >
          <v-icon :icon="mdiRefresh" />
          Refresh
        </v-btn>
      </section>

      <section class="project-access__users" aria-label="Tenant users">
        <article
          v-for="row in users"
          :key="row.email"
          class="project-access__user"
        >
          <div class="project-access__user-main">
            <strong>{{ row.email }}</strong>
            <span>
              <v-icon :icon="mdiGithub" />
              {{ row.github?.login ? `@${row.github.login}` : "GitHub not connected" }}
            </span>
          </div>
          <v-chip
            :color="accessColor(row)"
            label
            size="small"
            variant="tonal"
          >
            <v-icon
              :icon="row.access?.canPush ? mdiAccountCheckOutline : mdiAccountAlertOutline"
              start
            />
            {{ accessLabel(row) }}
          </v-chip>
          <v-btn
            v-if="canInvite(row)"
            color="primary"
            :loading="actionBusy === row.email"
            size="small"
            type="button"
            variant="flat"
            @click="inviteUser(row)"
          >
            Invite write access
          </v-btn>
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
.project-access {
  background: #ffffff;
  color: #111827;
  display: grid;
  gap: 1rem;
  min-height: 100dvh;
  padding: 1rem;
}

.project-access__header {
  align-items: start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.project-access__header p,
.project-access__summary span,
.project-access__user-main span {
  color: #64748b;
  font-size: 0.82rem;
  margin: 0;
}

.project-access__header h2 {
  font-size: 1.2rem;
  line-height: 1.25;
  margin: 0.15rem 0;
}

.project-access__header span,
.project-access__user-main span {
  align-items: center;
  display: inline-flex;
  gap: 0.35rem;
}

.project-access__loading {
  align-items: center;
  display: flex;
  justify-content: center;
  min-height: 12rem;
}

.project-access__summary,
.project-access__user {
  align-items: center;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 8px;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 0.8rem;
}

.project-access__summary strong {
  display: block;
  font-size: 1.15rem;
}

.project-access__users {
  display: grid;
  gap: 0.65rem;
}

.project-access__user {
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.project-access__user-main {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}

.project-access__user-main strong,
.project-access__user-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-access .v-btn {
  letter-spacing: 0;
  text-transform: none;
}

@media (max-width: 640px) {
  .project-access__summary,
  .project-access__user {
    align-items: stretch;
    grid-template-columns: 1fr;
  }
}
</style>

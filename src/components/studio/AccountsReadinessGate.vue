<template>
  <div
    class="accounts-readiness-gate"
    data-testid="accounts-readiness-gate"
  >
    <v-sheet
      v-if="gateVisible"
      rounded="lg"
      border
      class="accounts-readiness-gate__notice"
    >
      <div>
        <h2 class="accounts-readiness-gate__title">{{ noticeTitle }}</h2>
        <p class="accounts-readiness-gate__message">{{ noticeMessage }}</p>
      </div>
      <div class="accounts-readiness-gate__actions">
        <v-btn
          color="primary"
          variant="flat"
          :prepend-icon="mdiAccountKeyOutline"
          to="/home/accounts"
        >
          Open accounts
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          :loading="loading"
          :prepend-icon="mdiRefresh"
          @click="refreshAccounts"
        >
          Refresh
        </v-btn>
      </div>
    </v-sheet>

    <div
      class="accounts-readiness-gate__content"
      :class="{ 'accounts-readiness-gate__content--blocked': contentBlocked }"
      :aria-disabled="contentBlocked ? 'true' : undefined"
      :inert="contentBlocked ? '' : undefined"
    >
      <slot />
    </div>
  </div>
</template>

<script>
const cachedAccountsStatuses = new Map();
</script>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import {
  mdiAccountKeyOutline,
  mdiRefresh
} from "@mdi/js";
import { readAccountsStatus } from "@/lib/studioGateApi.js";

const props = defineProps({
  cacheKey: {
    default: "",
    type: String
  }
});

const activeCacheKey = computed(() => normalizeCacheKey(props.cacheKey));
const cachedStatus = cachedAccountsStatusForKey();
const checked = ref(Boolean(cachedStatus));
const loading = ref(false);
const errorMessage = ref("");
const status = ref(cachedStatus || null);

const ready = computed(() => status.value?.ready === true);
const contentBlocked = computed(() => ready.value !== true);
const accountRows = computed(() => Array.isArray(status.value?.accounts) ? status.value.accounts : []);
const missingAccountLabels = computed(() => accountRows.value
  .filter((account) => account?.connected !== true)
  .map((account) => String(account?.label || account?.id || "").trim())
  .filter(Boolean));
const gateVisible = computed(() => contentBlocked.value || Boolean(errorMessage.value) || loading.value);
const noticeTitle = computed(() => {
  if (errorMessage.value) {
    return "Accounts could not load";
  }
  if (!checked.value && loading.value) {
    return "Checking accounts";
  }
  return "Accounts required";
});
const noticeMessage = computed(() => {
  if (errorMessage.value) {
    return errorMessage.value;
  }
  if (!checked.value && loading.value) {
    return "Studio is checking Codex and GitHub before enabling project actions.";
  }
  if (status.value?.message) {
    return String(status.value.message);
  }
  if (missingAccountLabels.value.length > 0) {
    return `Connect ${missingAccountLabels.value.join(" and ")} before using Studio project actions.`;
  }
  return "Connect Codex and GitHub before using Studio project actions.";
});

function normalizeCacheKey(value = "") {
  return String(value || "default").trim() || "default";
}

function cachedAccountsStatusForKey() {
  return cachedAccountsStatuses.get(activeCacheKey.value) || null;
}

function applyAccountsStatus(value = {}) {
  const normalizedStatus = value && typeof value === "object" ? value : null;
  if (normalizedStatus) {
    cachedAccountsStatuses.set(activeCacheKey.value, normalizedStatus);
  } else {
    cachedAccountsStatuses.delete(activeCacheKey.value);
  }
  status.value = normalizedStatus;
  errorMessage.value = "";
  checked.value = true;
}

function applyAccountsError(error) {
  errorMessage.value = String(error?.message || error || "Account status could not load.");
  checked.value = true;
}

async function loadAccounts({
  refresh = false
} = {}) {
  loading.value = true;
  try {
    applyAccountsStatus(await readAccountsStatus({
      refresh
    }));
  } catch (error) {
    applyAccountsError(error);
    console.error("[VIBE64_ACCOUNTS_READINESS_ERROR]", error);
  } finally {
    loading.value = false;
  }
}

function refreshAccounts() {
  void loadAccounts({
    refresh: true
  });
}

watch(activeCacheKey, () => {
  const nextCachedStatus = cachedAccountsStatusForKey();
  status.value = nextCachedStatus || null;
  checked.value = Boolean(nextCachedStatus);
  errorMessage.value = "";
  void loadAccounts();
});

onMounted(() => {
  void loadAccounts({
    refresh: false
  });
});
</script>

<style scoped>
.accounts-readiness-gate {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.85rem;
  min-height: 0;
  min-width: 0;
}

.accounts-readiness-gate__notice {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  min-width: 0;
  padding: 1rem;
}

.accounts-readiness-gate__title {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.04rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0 0 0.2rem;
}

.accounts-readiness-gate__message {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.9rem;
  line-height: 1.35;
  margin: 0;
}

.accounts-readiness-gate__actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.accounts-readiness-gate__content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.accounts-readiness-gate__content--blocked {
  opacity: 0.42;
  pointer-events: none;
  user-select: none;
}

@media (max-width: 640px) {
  .accounts-readiness-gate__notice {
    align-items: stretch;
    flex-direction: column;
  }

  .accounts-readiness-gate__actions {
    justify-content: flex-start;
  }
}
</style>

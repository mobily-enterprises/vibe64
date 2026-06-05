<script setup>
import { onMounted, reactive, ref } from "vue";
import {
  mdiAccountPlusOutline
} from "@mdi/js";
import {
  inviteUser,
  readUsers
} from "@/lib/vibe64AuthApi.js";

const users = ref([]);
const loadingUsers = ref(false);
const inviteStatus = ref("");
const error = ref("");
const inviteForm = reactive({
  email: ""
});

async function loadUsers() {
  loadingUsers.value = true;
  error.value = "";
  try {
    const response = await readUsers();
    if (response.ok === false) {
      throw new Error(response.error || response.message || "Users could not load.");
    }
    users.value = Array.isArray(response.users) ? response.users : [];
  } catch (loadError) {
    error.value = String(loadError?.message || loadError);
  } finally {
    loadingUsers.value = false;
  }
}

async function submitInvite() {
  inviteStatus.value = "";
  error.value = "";
  const response = await inviteUser({
    email: inviteForm.email
  });
  if (response.ok === false) {
    error.value = response.error || response.message || "Invite failed.";
    return;
  }
  inviteForm.email = "";
  inviteStatus.value = "User invited.";
  await loadUsers();
}

onMounted(loadUsers);
</script>

<template>
  <section class="vibe64-user-management">
    <header class="vibe64-user-management__header">
      <h1>Users</h1>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" density="compact">
      {{ error }}
    </v-alert>

    <section class="vibe64-user-management__section">
      <h2>
        <v-icon :icon="mdiAccountPlusOutline" size="20" />
        Invite users
      </h2>
      <form class="vibe64-user-management__invite" @submit.prevent="submitInvite">
        <v-text-field
          v-model="inviteForm.email"
          autocomplete="email"
          label="Invite email"
          required
          type="email"
          variant="outlined"
        />
        <v-btn color="primary" type="submit" variant="flat">Invite</v-btn>
      </form>
      <span v-if="inviteStatus" class="vibe64-user-management__status">{{ inviteStatus }}</span>

      <v-table density="compact">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Password</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in users" :key="row.email">
            <td>{{ row.email }}</td>
            <td>{{ row.role }}</td>
            <td>{{ row.passwordSet ? "Set" : "Invited" }}</td>
          </tr>
          <tr v-if="!loadingUsers && users.length === 0">
            <td colspan="3">No users.</td>
          </tr>
        </tbody>
      </v-table>
    </section>
  </section>
</template>

<style scoped>
.vibe64-user-management {
  display: grid;
  gap: 1rem;
  margin: 0 auto;
  max-width: 58rem;
  padding: 1rem;
  width: 100%;
}

.vibe64-user-management__header h1,
.vibe64-user-management__section h2 {
  margin: 0;
}

.vibe64-user-management__header h1 {
  font-size: 1.45rem;
  line-height: 1.2;
}

.vibe64-user-management__section {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  display: grid;
  gap: 0.9rem;
  padding: 1rem;
}

.vibe64-user-management__section h2 {
  align-items: center;
  display: flex;
  font-size: 1rem;
  gap: 0.45rem;
}

.vibe64-user-management__invite {
  align-items: start;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(16rem, 24rem) auto;
}

.vibe64-user-management__status {
  color: rgb(var(--v-theme-success));
  font-size: 0.9rem;
}

@media (max-width: 720px) {
  .vibe64-user-management__invite {
    grid-template-columns: 1fr;
  }
}
</style>

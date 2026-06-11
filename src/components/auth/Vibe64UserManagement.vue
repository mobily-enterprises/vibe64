<script setup>
import {
  mdiAccountCancelOutline,
  mdiAccountGroupOutline,
  mdiAccountMinusOutline,
  mdiAccountPlusOutline
} from "@mdi/js";
import {
  useVibe64UserManagement
} from "@/composables/useVibe64Users.js";

const {
  actionBusy,
  cancelUserInvite,
  canManageUsers,
  error,
  githubLabel,
  inviteForm,
  inviteStatus,
  inviteWarning,
  removeUser,
  statusLabel,
  submitInvite,
  userList
} = useVibe64UserManagement();
</script>

<template>
  <section class="vibe64-user-management">
    <header class="vibe64-user-management__header">
      <h1>Users</h1>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" density="compact">
      {{ error }}
    </v-alert>
    <v-alert v-if="inviteWarning" type="warning" variant="tonal" density="compact">
      {{ inviteWarning }}
    </v-alert>

    <section class="vibe64-user-management__section">
      <h2 v-if="canManageUsers">
        <v-icon :icon="mdiAccountPlusOutline" size="20" />
        Invite users
      </h2>
      <h2 v-else>
        <v-icon :icon="mdiAccountGroupOutline" size="20" />
        Project users
      </h2>

      <form
        v-if="canManageUsers"
        class="vibe64-user-management__invite"
        @submit.prevent="submitInvite"
      >
        <v-text-field
          v-model="inviteForm.email"
          autocomplete="email"
          label="Invite email"
          required
          type="email"
          variant="outlined"
        />
        <v-btn
          color="primary"
          :loading="actionBusy === 'invite'"
          type="submit"
          variant="flat"
        >
          Invite
        </v-btn>
      </form>
      <span v-if="inviteStatus" class="vibe64-user-management__status">{{ inviteStatus }}</span>

      <v-table density="compact">
        <thead>
          <tr>
            <th>Email</th>
            <th>GitHub</th>
            <th>Role</th>
            <th>Status</th>
            <th v-if="canManageUsers" class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in userList.users" :key="row.email">
            <td>{{ row.email }}</td>
            <td>{{ githubLabel(row) }}</td>
            <td>{{ row.role }}</td>
            <td>{{ statusLabel(row) }}</td>
            <td v-if="canManageUsers" class="vibe64-user-management__row-actions">
              <v-btn
                v-if="row.status === 'invited'"
                :prepend-icon="mdiAccountCancelOutline"
                size="small"
                type="button"
                variant="text"
                :loading="actionBusy === row.email"
                @click="cancelUserInvite(row)"
              >
                Cancel invite
              </v-btn>
              <v-btn
                v-if="row.status === 'active' && row.role !== 'owner'"
                color="error"
                :prepend-icon="mdiAccountMinusOutline"
                size="small"
                type="button"
                variant="text"
                :loading="actionBusy === row.email"
                @click="removeUser(row)"
              >
                Remove
              </v-btn>
            </td>
          </tr>
          <tr v-if="!userList.isInitialLoading && userList.users.length === 0">
            <td :colspan="canManageUsers ? 5 : 4">No users.</td>
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

.vibe64-user-management__row-actions {
  display: flex;
  gap: 0.35rem;
  justify-content: flex-end;
}

@media (max-width: 720px) {
  .vibe64-user-management__invite {
    grid-template-columns: 1fr;
  }
}
</style>

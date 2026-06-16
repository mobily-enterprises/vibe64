<template>
  <section class="vibe64-publish-page">
    <header class="vibe64-publish-page__header">
      <div>
        <p class="vibe64-publish-page__eyebrow">Deployment</p>
        <h1>Publish</h1>
      </div>
      <v-btn
        :icon="mdiRefresh"
        :loading="stateResource.isFetching"
        title="Refresh"
        type="button"
        variant="text"
        @click="stateResource.reload"
      />
    </header>

    <v-alert v-if="loadError" type="error" variant="tonal">
      {{ loadError }}
    </v-alert>

    <div v-if="isInitialLoading" class="vibe64-publish-page__loading">
      <v-progress-circular color="primary" indeterminate />
    </div>

    <template v-else>
      <section class="vibe64-publish-page__panel">
        <div class="vibe64-publish-page__panel-main">
          <p class="vibe64-publish-page__eyebrow">Public URL</p>
          <h2 v-if="publicNameConfigured">
            {{ publicName.publicHost }}
          </h2>
          <h2 v-else>
            Choose a public name
          </h2>
          <a
            v-if="publicUrl"
            class="vibe64-publish-page__link"
            :href="publicUrl"
            rel="noopener"
            target="_blank"
          >
            {{ publicUrl }}
            <v-icon :icon="mdiOpenInNew" size="16" />
          </a>
        </div>
        <div class="vibe64-publish-page__actions">
          <v-btn
            v-if="publicNameConfigured"
            :disabled="commandBusy"
            :prepend-icon="mdiPencil"
            type="button"
            variant="tonal"
            @click="beginPublicNameChange"
          >
            Change URL
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!publicNameConfigured || commandBusy"
            :loading="publishCommand.isRunning"
            :prepend-icon="mdiCloudUploadOutline"
            type="button"
            variant="flat"
            @click="publish"
          >
            Publish
          </v-btn>
        </div>
      </section>

      <section
        v-if="publicNameConfigured && publicNameChangeOpen"
        class="vibe64-publish-page__panel"
      >
        <div class="vibe64-publish-page__name-field">
          <v-text-field
            v-model="publicNameChangeInput"
            autocomplete="off"
            density="comfortable"
            :error-messages="publicNameChangeError"
            hide-details="auto"
            label="New public name"
            spellcheck="false"
            suffix=".users.vibe64.dev"
            variant="outlined"
            @keydown.enter.prevent="changePublicName"
          />
          <div class="vibe64-publish-page__inline-actions">
            <v-btn
              :disabled="commandBusy"
              type="button"
              variant="text"
              @click="cancelPublicNameChange"
            >
              Cancel
            </v-btn>
            <v-btn
              color="primary"
              :disabled="!publicNameChangeInput || commandBusy"
              :loading="changePublicNameCommand.isRunning"
              type="button"
              variant="flat"
              @click="changePublicName"
            >
              Save URL
            </v-btn>
          </div>
        </div>
      </section>

      <section v-if="!publicNameConfigured" class="vibe64-publish-page__panel">
        <div class="vibe64-publish-page__name-field">
          <v-text-field
            v-model="publicNameInput"
            autocomplete="off"
            density="comfortable"
            :error-messages="publicNameError"
            hide-details="auto"
            label="Public name"
            spellcheck="false"
            suffix=".users.vibe64.dev"
            variant="outlined"
            @keydown.enter.prevent="reservePublicName"
          />
          <v-btn
            color="primary"
            :disabled="!publicNameInput || commandBusy"
            :loading="reservePublicNameCommand.isRunning"
            type="button"
            variant="flat"
            @click="reservePublicName"
          >
            Reserve URL
          </v-btn>
        </div>
      </section>

      <section class="vibe64-publish-page__grid">
        <article class="vibe64-publish-page__panel">
          <div class="vibe64-publish-page__panel-main">
            <p class="vibe64-publish-page__eyebrow">Current release</p>
            <h2>{{ currentRelease?.releaseId || 'Not published yet' }}</h2>
            <p v-if="currentRelease?.status" class="vibe64-publish-page__muted">
              {{ currentRelease.status }}{{ currentRelease.finishedAt ? ` at ${formatDate(currentRelease.finishedAt)}` : '' }}
            </p>
            <p v-if="currentRelease?.container?.restartPolicy" class="vibe64-publish-page__muted">
              Restart: {{ currentRelease.container.restartPolicy }}
            </p>
          </div>
        </article>

        <article class="vibe64-publish-page__panel">
          <div class="vibe64-publish-page__panel-main">
            <p class="vibe64-publish-page__eyebrow">Logs</p>
            <h2>Rotated by Docker</h2>
            <p class="vibe64-publish-page__muted">
              json-file, 10m, 5 files
            </p>
          </div>
        </article>
      </section>

      <section class="vibe64-publish-page__panel vibe64-publish-page__panel--stack">
        <div class="vibe64-publish-page__list-heading">
          <div>
            <p class="vibe64-publish-page__eyebrow">Releases</p>
            <h2>{{ releases.length }} release{{ releases.length === 1 ? '' : 's' }}</h2>
          </div>
        </div>

        <article
          v-for="release in releases"
          :key="release.releaseId"
          class="vibe64-publish-page__row"
        >
          <div class="vibe64-publish-page__row-main">
            <strong>{{ release.releaseId }}</strong>
            <small>{{ release.status }}{{ release.finishedAt ? ` at ${formatDate(release.finishedAt)}` : '' }}</small>
          </div>
          <v-chip
            v-if="currentRelease?.releaseId === release.releaseId"
            color="success"
            size="small"
            variant="tonal"
          >
            Current
          </v-chip>
          <v-btn
            v-else-if="release.status === 'published'"
            :disabled="commandBusy"
            :loading="rollbackReleaseCommand.isRunning"
            :prepend-icon="mdiBackupRestore"
            size="small"
            type="button"
            variant="text"
            @click="rollbackRelease(release.releaseId)"
          >
            Roll back
          </v-btn>
        </article>
        <p v-if="releases.length === 0" class="vibe64-publish-page__empty">
          No releases yet.
        </p>
      </section>

      <section class="vibe64-publish-page__panel vibe64-publish-page__panel--stack">
        <div class="vibe64-publish-page__list-heading">
          <div>
            <p class="vibe64-publish-page__eyebrow">Custom domains</p>
            <h2>{{ domains.length }} domain{{ domains.length === 1 ? '' : 's' }}</h2>
          </div>
        </div>

        <div class="vibe64-publish-page__name-field">
          <v-text-field
            v-model="customDomainInput"
            autocomplete="off"
            density="comfortable"
            :disabled="!publicNameConfigured"
            hide-details="auto"
            label="Domain"
            spellcheck="false"
            variant="outlined"
            @keydown.enter.prevent="addCustomDomain"
          />
          <v-btn
            :disabled="!publicNameConfigured || !customDomainInput || commandBusy"
            :loading="addCustomDomainCommand.isRunning"
            :prepend-icon="mdiPlus"
            type="button"
            variant="tonal"
            @click="addCustomDomain"
          >
            Add domain
          </v-btn>
        </div>

        <article
          v-for="domain in domains"
          :key="domain.hostname"
          class="vibe64-publish-page__domain"
        >
          <div class="vibe64-publish-page__row-main">
            <strong>
              <v-icon :icon="mdiWeb" size="16" />
              {{ domain.hostname }}
            </strong>
            <small>{{ domain.verificationStatus }}</small>
          </div>
          <div class="vibe64-publish-page__domain-dns">
            <code v-if="domain.requiredDnsRecords?.[0]">
              {{ domain.requiredDnsRecords[0].host }} {{ domain.requiredDnsRecords[0].type }} {{ domain.requiredDnsRecords[0].value }}
            </code>
            <code v-if="domain.publicHost">
              CNAME/ALIAS {{ domain.hostname }} -> {{ domain.publicHost }}
            </code>
            <v-btn
              v-if="domain.verificationStatus !== 'verified'"
              :disabled="commandBusy"
              :loading="verifyCustomDomainCommand.isRunning"
              size="small"
              type="button"
              variant="text"
              @click="verifyCustomDomain(domain.hostname)"
            >
              Verify DNS
            </v-btn>
          </div>
        </article>
        <p v-if="domains.length === 0" class="vibe64-publish-page__empty">
          No custom domains yet.
        </p>
      </section>
    </template>
  </section>
</template>

<script setup>
import {
  mdiBackupRestore,
  mdiCloudUploadOutline,
  mdiOpenInNew,
  mdiPencil,
  mdiPlus,
  mdiRefresh,
  mdiWeb
} from "@mdi/js";

import {
  useVibe64Deployments
} from "@/composables/useVibe64Deployments.js";

const {
  addCustomDomain,
  addCustomDomainCommand,
  beginPublicNameChange,
  cancelPublicNameChange,
  changePublicName,
  changePublicNameCommand,
  commandBusy,
  currentRelease,
  customDomainInput,
  domains,
  isInitialLoading,
  loadError,
  publicName,
  publicNameChangeInput,
  publicNameChangeError,
  publicNameChangeOpen,
  publicNameError,
  publicNameConfigured,
  publicNameInput,
  publicUrl,
  publish,
  publishCommand,
  releases,
  reservePublicName,
  reservePublicNameCommand,
  rollbackRelease,
  rollbackReleaseCommand,
  stateResource,
  verifyCustomDomain,
  verifyCustomDomainCommand
} = useVibe64Deployments();

function formatDate(value = "") {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
</script>

<style scoped>
.vibe64-publish-page {
  align-content: start;
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.vibe64-publish-page__header,
.vibe64-publish-page__panel,
.vibe64-publish-page__row,
.vibe64-publish-page__domain,
.vibe64-publish-page__name-field,
.vibe64-publish-page__list-heading {
  min-width: 0;
}

.vibe64-publish-page__header,
.vibe64-publish-page__panel,
.vibe64-publish-page__list-heading,
.vibe64-publish-page__row,
.vibe64-publish-page__domain {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.vibe64-publish-page__header h1,
.vibe64-publish-page__panel h2 {
  font-size: 1.15rem;
  line-height: 1.2;
  margin: 0;
}

.vibe64-publish-page__eyebrow {
  color: #64748b;
  font-size: 0.72rem;
  font-weight: 720;
  letter-spacing: 0;
  margin: 0 0 0.2rem;
  text-transform: uppercase;
}

.vibe64-publish-page__panel {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  padding: 1rem;
}

.vibe64-publish-page__panel--stack {
  align-items: stretch;
  display: grid;
}

.vibe64-publish-page__panel-main,
.vibe64-publish-page__row-main {
  min-width: 0;
}

.vibe64-publish-page__actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: flex-end;
}

.vibe64-publish-page__link {
  align-items: center;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  gap: 0.35rem;
  margin-top: 0.35rem;
  text-decoration: none;
}

.vibe64-publish-page__name-field {
  align-items: start;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr) auto;
  width: 100%;
}

.vibe64-publish-page__inline-actions {
  display: flex;
  gap: 0.6rem;
}

.vibe64-publish-page__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.vibe64-publish-page__row,
.vibe64-publish-page__domain {
  border-top: 1px solid rgba(15, 23, 42, 0.1);
  padding-top: 0.8rem;
}

.vibe64-publish-page__row-main strong,
.vibe64-publish-page__row-main small,
.vibe64-publish-page__muted {
  display: block;
}

.vibe64-publish-page__row-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-publish-page__row-main small,
.vibe64-publish-page__muted,
.vibe64-publish-page__empty {
  color: #64748b;
  font-size: 0.86rem;
}

.vibe64-publish-page__muted,
.vibe64-publish-page__empty {
  margin: 0.35rem 0 0;
}

.vibe64-publish-page__domain code {
  background: #f1f5f9;
  border-radius: 6px;
  color: #334155;
  display: block;
  font-size: 0.78rem;
  max-width: min(32rem, 100%);
  overflow: hidden;
  padding: 0.35rem 0.5rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-publish-page__domain-dns {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  min-width: 0;
}

.vibe64-publish-page__loading {
  align-items: center;
  display: flex;
  justify-content: center;
  min-height: 12rem;
}

@media (max-width: 760px) {
  .vibe64-publish-page__header,
  .vibe64-publish-page__panel,
  .vibe64-publish-page__row,
  .vibe64-publish-page__domain {
    align-items: stretch;
    flex-direction: column;
  }

  .vibe64-publish-page__domain-dns {
    align-items: stretch;
    flex-direction: column;
  }

  .vibe64-publish-page__name-field,
  .vibe64-publish-page__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

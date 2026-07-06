<template>
  <ManagedAppAuthSetupView
    :actions-disabled-message="actionsDisabledMessage"
    :actions-enabled="actionsEnabled"
    :app-auth="appAuth"
    :lede="lede"
    :title="title"
  />
</template>

<script setup>
import {
  ManagedAppAuthSetupView
} from "@local/vibe64-accounts/client";
import {
  useJskitManagedAppAuth
} from "@/composables/useJskitManagedAppAuth.js";

defineProps({
  actionsDisabledMessage: {
    type: String,
    default: ""
  },
  actionsEnabled: {
    type: Boolean,
    default: true
  },
  lede: {
    type: String,
    default: "Create and maintain the Supabase Auth projects that this JSKIT app can use for login."
  },
  title: {
    type: String,
    default: "Supabase Auth"
  }
});

const appAuth = useJskitManagedAppAuth();
</script>

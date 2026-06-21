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
import ManagedAppAuthSetupView from "./ManagedAppAuthSetupView.vue";
import {
  useManagedAppAuth
} from "../composables/useManagedAppAuth.js";

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
    default: "Create and maintain the shared dev/prod Supabase Auth projects that JSKIT apps can use for login."
  },
  title: {
    type: String,
    default: "Managed App Login"
  }
});

const appAuth = useManagedAppAuth();
</script>

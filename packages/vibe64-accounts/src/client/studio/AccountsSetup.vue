<template>
  <ProviderAccountsSetup
    :accounts="accounts"
    :account-rows="accountRows"
    :back-label="backLabel"
    :continue-label="continueLabel"
    :lede="lede"
    :needed-label="neededLabel"
    :ready-label="readyLabel"
    :show-continue="showContinue"
    :status-loaded="statusLoaded"
    :title="title"
    @back="emit('back')"
    @continue="emit('continue')"
  />
</template>

<script setup>
import ProviderAccountsSetup from "./ProviderAccountsSetup.vue";
import {
  accountsSetupEmits,
  accountsSetupProps,
  useAccountsSetup
} from "../composables/useAccountsSetup.js";

const props = defineProps(accountsSetupProps);
const emit = defineEmits(accountsSetupEmits);

const {
  accounts,
  accountRows,
  statusLoaded
} = useAccountsSetup(props, emit);
</script>

<script setup>
import { mdiAlertCircleOutline, mdiRobotHappyOutline } from "@mdi/js";

// Success's proof that Colleague answers on the chosen provider: its reply to a
// hello, the typing dots while it waits, or why it failed with Retry, Check
// connection and Continue anyway.
defineProps({
  // { state: "waiting" | "replied" | "failed" | "dismissed" | "", reply, error }
  hello: { type: Object, required: true },
  // The chosen provider's name.
  name: { type: String, required: true },
  // In Learn mode the teacher uses the provider from the next message.
  learn: Boolean
});
const emit = defineEmits(["retry", "check-connection", "dismiss"]);
</script>

<template>
  <div
    class="aio-proof" :class="{ 'aio-proof--failed': hello.state === 'failed' }"
    :aria-busy="hello.state === 'waiting' ? 'true' : undefined"
  >
    <span class="aio-proof__avatar" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path :d="hello.state === 'failed' ? mdiAlertCircleOutline : mdiRobotHappyOutline" /></svg>
    </span>
    <div class="aio-proof__body">
      <template v-if="hello.state === 'failed'">
        <span class="aio-proof__name">Colleague couldn't reach {{ name }}</span>
        <p class="aio-proof__reply">{{ hello.error }}</p>
        <div class="aio-proof__actions">
          <v-btn color="primary" variant="tonal" @click="emit('retry')">Retry</v-btn>
          <v-btn variant="text" color="primary" @click="emit('check-connection')">Check connection</v-btn>
          <v-btn variant="text" @click="emit('dismiss')">Continue anyway</v-btn>
        </div>
      </template>
      <template v-else>
        <span class="aio-proof__name">Colleague</span>
        <span v-if="hello.state === 'waiting'" class="aio-proof__typing" role="status">
          <span class="d-sr-only">Colleague is replying…</span><i /><i /><i />
        </span>
        <p v-else-if="hello.state === 'replied'" class="aio-proof__reply">{{ hello.reply }}</p>
        <p v-else class="aio-proof__reply aio-proof__reply--quiet">
          {{ learn ? `Your teacher uses ${name} from your next message.` : "Ready when you are. Say hi in the Colleague panel." }}
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.aio-proof {
  align-items: flex-start;
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  display: flex;
  gap: var(--v64-space-3);
  margin: var(--v64-space-3) 0 var(--v64-space-2);
  max-width: 32rem;
  padding: var(--v64-space-4);
  text-align: left;
  width: 100%;
}
.aio-proof--failed { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 10%, var(--v64-surface)); border-color: color-mix(in srgb, rgb(var(--v-theme-warning)) 55%, transparent); }
.aio-proof__avatar {
  align-items: center;
  background: var(--v64-primary-container);
  border-radius: var(--v64-shape-full);
  display: inline-flex;
  flex: none;
  height: 36px;
  justify-content: center;
  width: 36px;
}
.aio-proof__avatar svg { fill: var(--v64-on-primary-container); height: 20px; width: 20px; }
.aio-proof--failed .aio-proof__avatar { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 22%, var(--v64-surface)); }
.aio-proof--failed .aio-proof__avatar svg { fill: rgb(var(--v-theme-warning)); }
.aio-proof__body { display: grid; gap: 2px; min-width: 0; }
.aio-proof__name { font: var(--v64-type-label-lg); }
.aio-proof__reply { font: var(--v64-type-body-lg); margin: 0; overflow-wrap: anywhere; }
.aio-proof__reply--quiet { color: var(--v64-on-surface-variant); }
.aio-proof--failed .aio-proof__reply { -webkit-box-orient: vertical; display: -webkit-box; font: var(--v64-type-body-md); -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
.aio-proof__actions { display: flex; flex-wrap: wrap; gap: var(--v64-space-1); margin: var(--v64-space-2) 0 0 calc(var(--v64-space-2) * -1); }
.aio-proof__actions .v-btn:first-child { margin-left: var(--v64-space-2); }
.aio-proof__typing { display: inline-flex; gap: 4px; padding: 8px 0; }
.aio-proof__typing i {
  animation: aio-typing 1.2s ease-in-out infinite;
  background: var(--v64-on-surface-variant);
  border-radius: 50%;
  height: 7px;
  width: 7px;
}
.aio-proof__typing i:nth-child(3) { animation-delay: 0.15s; }
.aio-proof__typing i:nth-child(4) { animation-delay: 0.3s; }
@keyframes aio-typing { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

@media (prefers-reduced-motion: reduce) {
  .aio-proof__typing i { animation: none; }
}
</style>

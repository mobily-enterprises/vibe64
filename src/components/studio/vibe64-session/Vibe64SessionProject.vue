<template>
  <section class="studio-ai-sessions__main">
    <Vibe64SessionTimeline
      :busy="page.busy"
      :steps="timeline.steps"
      @rewind="timeline.rewindToStep"
    >
      <template #current-step>
        <Vibe64SessionCurrentStep
          :actions="actions"
          :active="active"
          :conversation-log="conversationLog"
          :diff="dialogs.diff"
          :page="page"
          :refresh-session-data="refreshSessionData"
          :review="review"
          :session="selection.selectedSession"
          :sessions-api-path="sessionsApiPath"
          :step-input="stepInput"
        />
      </template>
    </Vibe64SessionTimeline>

    <Vibe64SessionFacts
      class="studio-ai-sessions__facts"
      :facts="selection.facts"
      :status-color="selection.statusColor(selection.selectedSession.status)"
      :status-label="selection.statusLabel(selection.selectedSession.status)"
      @copy="page.copyText"
    />

    <Vibe64ReportPreview
      v-if="reportPreview.visible"
      class="studio-ai-sessions__report"
      :error="reportPreview.error"
      :loading="reportPreview.loading"
      :text="reportPreview.text"
    />

    <Vibe64ReportPreview
      v-if="humanInputResponsePreview.visible"
      class="studio-ai-sessions__report"
      empty-text="Reply is not ready yet."
      :error="humanInputResponsePreview.error"
      :loading="humanInputResponsePreview.loading"
      :text="humanInputResponsePreview.text"
      :title-icon="mdiRobotOutline"
      title="Assistant reply"
    />
  </section>
</template>

<script setup>
import {
  mdiRobotOutline
} from "@mdi/js";
import Vibe64ReportPreview from "@/components/studio/vibe64-session/Vibe64ReportPreview.vue";
import Vibe64SessionCurrentStep from "@/components/studio/vibe64-session/Vibe64SessionCurrentStep.vue";
import Vibe64SessionFacts from "@/components/studio/vibe64-session/Vibe64SessionFacts.vue";
import Vibe64SessionTimeline from "@/components/studio/vibe64-session/Vibe64SessionTimeline.vue";

defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  active: {
    default: true,
    type: Boolean
  },
  conversationLog: {
    default: () => ({}),
    type: Object
  },
  dialogs: {
    default: () => ({}),
    type: Object
  },
  page: {
    default: () => ({}),
    type: Object
  },
  reportPreview: {
    default: () => ({}),
    type: Object
  },
  review: {
    default: () => ({}),
    type: Object
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  humanInputResponsePreview: {
    default: () => ({}),
    type: Object
  },
  selection: {
    default: () => ({}),
    type: Object
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  },
  stepInput: {
    default: () => ({}),
    type: Object
  },
  timeline: {
    default: () => ({}),
    type: Object
  }
});
</script>

<style scoped>
.studio-ai-sessions__main {
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__facts {
  margin-top: 0.9rem;
}

.studio-ai-sessions__report {
  margin-top: 0.9rem;
}

@media (min-width: 981px) {
  .studio-ai-sessions__main {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 0.25rem;
    scrollbar-gutter: stable;
  }
}

</style>

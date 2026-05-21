<template>
  <section class="studio-ai-sessions__main">
    <AiStudioSessionTimeline
      :busy="page.busy"
      :steps="timeline.steps"
      @rewind="timeline.rewindToStep"
    >
      <template #current-step>
        <AiStudioSessionCurrentStep
          :actions="actions"
          :diff="dialogs.diff"
          :issue-request="issueRequest"
          :page="page"
          :review="review"
          @update-issue-request-text="emit('update-issue-request-text', $event)"
        />
      </template>
    </AiStudioSessionTimeline>

    <AiStudioSessionFacts
      class="studio-ai-sessions__facts"
      :facts="selection.facts"
      :status-color="selection.statusColor(selection.selectedSession.status)"
      :status-label="selection.statusLabel(selection.selectedSession.status)"
      @copy="page.copyText"
    />

    <AiStudioReportPreview
      v-if="reportPreview.visible"
      class="studio-ai-sessions__report"
      :error="reportPreview.error"
      :loading="reportPreview.loading"
      :text="reportPreview.text"
    />

    <AiStudioReportPreview
      v-if="humanInputResponsePreview.visible"
      class="studio-ai-sessions__report"
      empty-text="AI response is not ready yet."
      :error="humanInputResponsePreview.error"
      :loading="humanInputResponsePreview.loading"
      :text="humanInputResponsePreview.text"
      title="AI response"
    />
  </section>
</template>

<script setup>
import AiStudioReportPreview from "@/components/studio/ai-studio-session/AiStudioReportPreview.vue";
import AiStudioSessionCurrentStep from "@/components/studio/ai-studio-session/AiStudioSessionCurrentStep.vue";
import AiStudioSessionFacts from "@/components/studio/ai-studio-session/AiStudioSessionFacts.vue";
import AiStudioSessionTimeline from "@/components/studio/ai-studio-session/AiStudioSessionTimeline.vue";

defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  dialogs: {
    default: () => ({}),
    type: Object
  },
  issueRequest: {
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
  humanInputResponsePreview: {
    default: () => ({}),
    type: Object
  },
  selection: {
    default: () => ({}),
    type: Object
  },
  timeline: {
    default: () => ({}),
    type: Object
  }
});

const emit = defineEmits(["update-issue-request-text"]);
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

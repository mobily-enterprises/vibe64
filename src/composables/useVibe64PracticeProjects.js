import { computed, ref, toValue } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { VIBE64_SURFACE_ID } from "@/lib/vibe64RequestConfig.js";
import { VIBE64_PROJECT_CHANGED_EVENT } from "@/lib/studioGateApi.js";

const LEARNING_PATH = "/api/vibe64/training/learning";
const LEARNER_CHANGED_EVENT = "vibe64.training.learner.changed";

// Local practice projects live in the learner's private namespace, so the
// standalone source is the learner's own learning.read: each attempt that
// still has a practice project names it with `practiceSlug`. This adapter owns
// no admission; the Training actions re-authorize every read and delete.
function practiceProjectsFromLearning(result = null) {
  if (result?.ok !== true || result.available !== true) return [];
  const attempts = Array.isArray(result.attempts) ? result.attempts
    : [result.active, ...(Array.isArray(result.history) ? result.history : [])];
  const seen = new Set();
  const projects = [];
  for (const attempt of attempts) {
    const slug = String(attempt?.practiceSlug || "").trim();
    const attemptId = String(attempt?.attemptId || "").trim();
    if (!slug || !attemptId || seen.has(slug)) continue;
    seen.add(slug);
    projects.push({
      slug,
      attemptId,
      lessonCode: String(attempt?.pin?.lesson?.code || attempt?.lessonCode || ""),
      lessonTitle: String(attempt?.lessonTitle || ""),
      ended: Boolean(attempt?.ended),
      mine: true
    });
  }
  return projects;
}

function practiceProjectDeletePath(attemptId = "") {
  return `/api/vibe64/training/attempts/${encodeURIComponent(String(attemptId || ""))}/practice/delete`;
}

function useVibe64PracticeProjects({ enabled = true } = {}) {
  const deletingSlug = ref("");
  const active = computed(() => toValue(enabled) === true);
  const resource = useEndpointResource({
    enabled: active,
    fallbackLoadError: "Practice projects could not load.",
    path: LEARNING_PATH,
    queryKey: ["vibe64", "training", "learning", VIBE64_SURFACE_ID, "practice-projects"],
    queryOptions: { retry: false },
    refreshOnPull: true,
    requestRecoveryLabel: "Practice projects",
    realtime: { events: [LEARNER_CHANGED_EVENT, VIBE64_PROJECT_CHANGED_EVENT] }
  });
  const practiceProjects = computed(() => active.value ? practiceProjectsFromLearning(resource.data.value) : []);
  const deleteCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/training",
    buildCommandOptions: (_model, { context }) => ({ method: "POST", path: practiceProjectDeletePath(context.attemptId) }),
    buildRawPayload: () => ({}),
    fallbackRunError: "Practice project could not be deleted.",
    messages: { error: "Practice project could not be deleted.", success: "Practice project deleted." },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.training.practice.delete",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const deleteError = computed(() => deleteCommand.messageType === "error" ? String(deleteCommand.message || "") : "");

  // D-b: the learner's own practice project is deleted with one click; the
  // command's snackbar reports the outcome. No archive is kept.
  async function deletePracticeProject(project = {}) {
    if (!project?.attemptId || deletingSlug.value) return false;
    deletingSlug.value = String(project.slug || "");
    try {
      const result = await deleteCommand.run({ attemptId: project.attemptId });
      await resource.reload();
      return result?.ok !== false && Boolean(result);
    } finally {
      deletingSlug.value = "";
    }
  }

  return { deleteError, deletePracticeProject, deletingSlug, practiceProjects, reload: resource.reload, resource };
}

export { practiceProjectDeletePath, practiceProjectsFromLearning, useVibe64PracticeProjects };

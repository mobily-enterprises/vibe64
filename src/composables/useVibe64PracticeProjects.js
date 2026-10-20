import { computed, ref, toValue } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { VIBE64_SURFACE_ID } from "@/lib/vibe64RequestConfig.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "@local/vibe64-training/shared/learner-events";
import { VIBE64_LEARNING_ROUTES } from "@/lib/vibe64Learning.js";
import { practiceProjectName } from "@/lib/vibe64PracticeProjectName.js";

const text = value => typeof value === "string" && value.length > 0;
const STATUS_LABELS = Object.freeze({ "in-progress": "In progress", finished: "Finished", "not-finished": "Not finished",
  deleting: "Being deleted" });
const lessonName = lesson => practiceProjectName({ lessonTitle: lesson?.title, lessonCode: lesson?.code });

// The learner's practice projects in the learning space, as practice.list
// returns them: live projects (lesson, status) and archived bundles (lesson,
// date). A project whose deletion was interrupted is listed as deleting and
// offers only Delete. Display only; the Training actions authorize every action.
function practiceListFromResult(result = null) {
  if (result?.ok !== true) return { projects: [], archived: [] };
  const projects = (Array.isArray(result.projects) ? result.projects : [])
    .filter(project => text(project?.practiceId) && text(project.slug))
    .map(project => {
      const status = project.deleting === true ? "deleting" : String(project.status || "");
      return { practiceId: project.practiceId, slug: project.slug, name: lessonName(project.lesson),
        status, statusLabel: STATUS_LABELS[status] || "" };
    });
  const archived = (Array.isArray(result.archived) ? result.archived : [])
    .filter(entry => text(entry?.practiceId) && text(entry.archiveId))
    .map(entry => ({ practiceId: entry.practiceId, archiveId: entry.archiveId, name: lessonName(entry.lesson),
      archivedAt: String(entry.archivedAt || "") }));
  return { projects, archived };
}

// L's Practice tab and Lesson finished screen. Open continues the project's
// lesson (practice.open turns learning mode on); Archive keeps a bundle without
// rebuildable dependencies; Delete removes the project or one archived bundle.
// Each is one click. `request` is a test seam for the HTTP client.
function useVibe64PracticeProjects({ enabled = true, request = null } = {}) {
  const active = computed(() => toValue(enabled) === true);
  const resource = useEndpointResource({
    enabled: active,
    fallbackLoadError: "Practice projects could not load.",
    path: VIBE64_LEARNING_ROUTES.practice,
    queryKey: ["vibe64", "training", "practice", VIBE64_SURFACE_ID],
    queryOptions: { retry: false },
    refreshOnPull: true,
    requestRecoveryLabel: "Practice projects",
    // Learner notes changes never touch a practice project.
    realtime: { event: VIBE64_TRAINING_LEARNER_CHANGED_EVENT, matches: ({ payload } = {}) => payload?.reason !== "notes" }
  });
  const list = computed(() => active.value ? practiceListFromResult(resource.data.value) : { projects: [], archived: [] });
  // "<action>:<practiceId>[:<archiveId>]" while one action runs.
  const busy = ref("");
  const error = ref("");
  const openIds = new Map();
  const post = request || ((path, options) => getHttpWebClient().request(resolveStudioRequestUrl(path), options));

  async function act(key, url, body = {}) {
    if (busy.value) return null;
    busy.value = key;
    error.value = "";
    try {
      const result = await post(url, { method: "POST", body });
      if (result?.ok !== true) throw new Error(result?.error || "The practice project change was not confirmed. Try again.");
      return result;
    } catch (cause) {
      error.value = String(cause?.message || "The practice project change was not confirmed. Try again.");
      return null;
    } finally {
      busy.value = "";
      void resource.reload();
    }
  }

  return {
    projects: computed(() => list.value.projects),
    archived: computed(() => list.value.archived),
    loaded: computed(() => active.value && resource.data.value?.ok === true),
    loadError: resource.loadError,
    busy,
    error,
    // An unconfirmed open is retried with the same request ID, as practice.open requires.
    async open(project, { expectedRevision } = {}) {
      const requestId = openIds.get(project.practiceId) || globalThis.crypto.randomUUID();
      openIds.set(project.practiceId, requestId);
      const result = await act(`open:${project.practiceId}`, VIBE64_LEARNING_ROUTES.practiceOpen(project.practiceId),
        { requestId, expectedRevision });
      if (result) openIds.delete(project.practiceId);
      return result;
    },
    archive: project => act(`archive:${project.practiceId}`, VIBE64_LEARNING_ROUTES.practiceArchive(project.practiceId)),
    remove: project => act(`delete:${project.practiceId}`, VIBE64_LEARNING_ROUTES.practiceDelete(project.practiceId)),
    removeArchive: entry => act(`archive-delete:${entry.practiceId}:${entry.archiveId}`,
      VIBE64_LEARNING_ROUTES.practiceArchiveDelete(entry.practiceId, entry.archiveId))
  };
}

export { practiceListFromResult, useVibe64PracticeProjects };

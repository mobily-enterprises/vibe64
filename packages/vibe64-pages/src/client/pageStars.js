// Your starred pages in each project, which every star shows (the chat's page
// cards, the page panel, the Pages list and the chat's Starred menu), and the
// viewing links asked for just before a click, so a starred page opens at once.
import { computed, reactive, toValue, watch } from "vue";
import { useTheme } from "vuetify";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { listStarredPages, openPageView, setPageStar } from "./pagesRequests.js";

// readable-check: allow module-state - shared resource: every star in a project shows its one latest answer
const projects = reactive({});
const NO_PROJECT = Object.freeze({ pages: [], loaded: false, loading: false, error: "", pendingIds: [] });

function projectStars(projectSlug) {
  projects[projectSlug] ||= { pages: [], loaded: false, loading: false, error: "", pendingIds: [], sequence: 0 };
  return projects[projectSlug];
}

/** @param {string} projectSlug */
async function refreshPageStars(projectSlug) {
  if (!projectSlug) return;
  const stars = projectStars(projectSlug);
  // A star being saved answers with the full list itself.
  if (stars.pendingIds.length) return;
  const sequence = ++stars.sequence;
  stars.loading = true;
  try {
    const answer = await listStarredPages(projectSlug);
    if (sequence === stars.sequence) {
      stars.pages = answer.pages || [];
      stars.loaded = true;
      stars.error = "";
    }
  } catch (cause) {
    if (sequence === stars.sequence) stars.error = cause?.message || "Starred pages could not load.";
  } finally {
    if (sequence === stars.sequence) stars.loading = false;
  }
}

/**
 * Stars an unstarred page or unstars a starred one, showing the change at once.
 * @param {string} projectSlug
 * @param {{ id: string }} page its summary, which the starred list shows
 */
async function togglePageStar(projectSlug, page) {
  const stars = projectStars(projectSlug);
  if (!page?.id || stars.pendingIds.includes(page.id)) return;
  const starred = !stars.pages.some((entry) => entry.id === page.id);
  stars.sequence += 1;
  stars.loading = false;
  stars.pendingIds = [...stars.pendingIds, page.id];
  stars.pages = starred ? [...stars.pages, page] : stars.pages.filter((entry) => entry.id !== page.id);
  let failure = null;
  try {
    const answer = await setPageStar(projectSlug, page.id, starred);
    if (stars.pendingIds.length === 1) stars.pages = answer.pages || [];
    stars.loaded = true;
    stars.error = "";
  } catch (cause) {
    failure = cause;
  } finally {
    stars.pendingIds = stars.pendingIds.filter((id) => id !== page.id);
  }
  if (failure) {
    await refreshPageStars(projectSlug);
    throw failure;
  }
}

// A viewing link asked for ahead is kept for two minutes at most, never past
// the link's own end, and goes to the first viewer that opens its page.
const AHEAD_KEEP_MS = 2 * 60 * 1000;
const AHEAD_MARGIN_MS = 60 * 1000;
// readable-check: allow module-state - shared resource: the menu asks ahead, the page panel takes the answer
const aheadLinks = new Map();
const aheadKey = (projectSlug, pageId, theme) => `${projectSlug}\n${pageId}\n${theme}`;

/**
 * Asks for a page's viewing link before it is opened, unless one is on hand.
 * @param {string} projectSlug
 * @param {string} pageId
 * @param {"light" | "dark"} theme
 */
function preparePageView(projectSlug, pageId, theme) {
  const key = aheadKey(projectSlug, pageId, theme);
  if (!projectSlug || !pageId || aheadLinks.has(key)) return;
  const entry = { answer: null, promise: null, timer: 0 };
  entry.promise = openPageView(projectSlug, pageId, theme).then((answer) => {
    const keep = Math.min(AHEAD_KEEP_MS, Date.parse(answer.expiresAt) - Date.now() - AHEAD_MARGIN_MS);
    if (aheadLinks.get(key) === entry) {
      if (keep > 0) {
        entry.answer = answer;
        entry.timer = setTimeout(() => aheadLinks.get(key) === entry && aheadLinks.delete(key), keep);
      } else {
        aheadLinks.delete(key);
      }
    }
    return answer;
  }, (cause) => {
    if (aheadLinks.get(key) === entry) aheadLinks.delete(key);
    throw cause;
  });
  // A link that could not be asked for ahead is asked for again when the page opens.
  entry.promise.catch(() => {});
  aheadLinks.set(key, entry);
}

/**
 * The viewing link asked for ahead, handed over once: its answer when it has
 * arrived, else the request still on its way; null when none was asked for.
 * @param {string} projectSlug
 * @param {string} pageId
 * @param {"light" | "dark"} theme
 * @returns {{ answer: object } | { promise: Promise<object> } | null}
 */
function takePreparedPageView(projectSlug, pageId, theme) {
  const key = aheadKey(projectSlug, pageId, theme);
  const entry = aheadLinks.get(key);
  if (!entry) return null;
  aheadLinks.delete(key);
  clearTimeout(entry.timer);
  return entry.answer ? { answer: entry.answer } : { promise: entry.promise };
}

/**
 * A page this person starred, as the starred list knows it, before the page itself answers.
 * @param {string} projectSlug
 * @param {string} pageId
 */
function starredPageSummary(projectSlug, pageId) {
  return projects[projectSlug]?.pages.find((page) => page.id === pageId) || null;
}

/** The theme a viewing link carries: the viewer's Vibe64 theme. */
function usePageViewTheme() {
  const theme = useTheme();
  return computed(() => theme.current.value.dark ? "dark" : "light");
}

/**
 * This person's starred pages in a project, loaded once per project and shared.
 * @param {import("vue").MaybeRefOrGetter<string>} projectSlug
 */
function usePageStars(projectSlug) {
  const feedback = useUiFeedback({ source: "vibe64.pages.stars" });
  const slug = computed(() => String(toValue(projectSlug) || ""));
  const state = computed(() => slug.value ? projectStars(slug.value) : NO_PROJECT);
  watch(slug, (value) => {
    if (value && !state.value.loaded && !state.value.loading) void refreshPageStars(value);
  }, { immediate: true });
  return {
    error: computed(() => state.value.error),
    loaded: computed(() => state.value.loaded),
    loading: computed(() => state.value.loading),
    pages: computed(() => state.value.pages),
    pendingIds: computed(() => state.value.pendingIds),
    isStarred: (pageId) => state.value.pages.some((page) => page.id === pageId),
    refresh: () => refreshPageStars(slug.value),
    toggle: (page) => togglePageStar(slug.value, page).catch((cause) => feedback.error(cause, "The star could not be saved."))
  };
}

export { preparePageView, starredPageSummary, takePreparedPageView, usePageStars, usePageViewTheme };

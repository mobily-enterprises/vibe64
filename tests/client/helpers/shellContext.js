import { shallowRef } from "vue";
import * as HostKeys from "../../../src/lib/vibe64AssistantHost.js";
import { createPageActivity } from "../../../src/lib/vibe64PageActivity.js";

// What Vibe64AssistantShellContext provides to every view of a host, for a test that mounts one view on its own:
// each slot empty, the local viewer and a page activity channel. A test passes the learning controller (or a
// double) its view reads; the slots are returned so the test can read what the view published.
export function provideShellContext(app, { learning = null, viewer = HostKeys.LOCAL_ASSISTANT_VIEWER } = {}) {
  const slots = {
    assistantHost: shallowRef(null), colleagueView: shallowRef(null), colleaguePreview: shallowRef(null),
    colleagueIntegrations: shallowRef(null), colleagueDatabase: shallowRef(null), colleaguePlan: shallowRef(null),
    colleagueLayout: shallowRef(null), browserNavigation: shallowRef(null), pageFocus: shallowRef(null),
    colleagueLauncher: shallowRef(null), aiTaskTray: shallowRef(null)
  };
  const pageActivity = createPageActivity();
  app.provide(HostKeys.VIBE64_ASSISTANT_VIEWER_KEY, viewer);
  app.provide(HostKeys.VIBE64_ASSISTANT_HOST_KEY, slots.assistantHost);
  app.provide(HostKeys.VIBE64_COLLEAGUE_VIEW_KEY, slots.colleagueView);
  app.provide(HostKeys.VIBE64_COLLEAGUE_PREVIEW_KEY, slots.colleaguePreview);
  app.provide(HostKeys.VIBE64_COLLEAGUE_INTEGRATIONS_KEY, slots.colleagueIntegrations);
  app.provide(HostKeys.VIBE64_COLLEAGUE_DATABASE_KEY, slots.colleagueDatabase);
  app.provide(HostKeys.VIBE64_COLLEAGUE_PLAN_KEY, slots.colleaguePlan);
  app.provide(HostKeys.VIBE64_COLLEAGUE_LAYOUT_KEY, slots.colleagueLayout);
  app.provide(HostKeys.VIBE64_BROWSER_NAVIGATION_KEY, slots.browserNavigation);
  app.provide(HostKeys.VIBE64_PAGE_FOCUS_KEY, slots.pageFocus);
  app.provide(HostKeys.VIBE64_PAGE_ACTIVITY_KEY, pageActivity);
  app.provide(HostKeys.VIBE64_COLLEAGUE_LAUNCHER_KEY, slots.colleagueLauncher);
  app.provide(HostKeys.VIBE64_AI_TASK_TRAY_KEY, slots.aiTaskTray);
  if (learning) app.provide(HostKeys.VIBE64_LEARNING_KEY, learning);
  return { ...slots, pageActivity };
}

import { createApp, reactive, shallowRef } from "vue";
import * as HostKeys from "../../../src/lib/vibe64AssistantHost.js";
import { createPageActivity } from "../../../src/lib/vibe64PageActivity.js";
import { VIBE64_VOICE_KEY } from "../../../packages/vibe64-voice/src/client/voiceHost.js";

// What both hosts provide to every view, for a test that mounts or runs one view on its own:
// Vibe64AssistantShellContext's slots (each empty unless the test passes its own), the local viewer and a page
// activity channel, plus the learning controller a test passes. The slots are returned so a test can read
// what the view published.
export function provideShellContext(app, { learning = null, viewer = HostKeys.LOCAL_ASSISTANT_VIEWER, ...given } = {}) {
  const slots = {
    assistantHost: shallowRef(null), colleagueView: shallowRef(null), colleaguePreview: shallowRef(null),
    colleagueIntegrations: shallowRef(null), colleagueDatabase: shallowRef(null), colleaguePlan: shallowRef(null),
    colleagueLayout: shallowRef(null), browserNavigation: shallowRef(null), pageFocus: shallowRef(null),
    colleagueLauncher: shallowRef(null), aiTaskTray: shallowRef(null), pageActivity: createPageActivity(),
    ...given
  };
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
  app.provide(HostKeys.VIBE64_PAGE_ACTIVITY_KEY, slots.pageActivity);
  app.provide(HostKeys.VIBE64_COLLEAGUE_LAUNCHER_KEY, slots.colleagueLauncher);
  app.provide(HostKeys.VIBE64_AI_TASK_TRAY_KEY, slots.aiTaskTray);
  if (learning) app.provide(HostKeys.VIBE64_LEARNING_KEY, learning);
  return slots;
}

// Runs a composable or a component's setup() outside a mounted tree, with the shell context injected.
export function runInShellContext(run, options = {}) {
  const app = createApp({});
  const slots = provideShellContext(app, options);
  return { app, slots, result: app.runWithContext(run) };
}

// Vibe64VoiceHost's value with no conversation in voice: nothing is spoken, read aloud or shown.
export function voiceDouble() {
  return {
    controller: {
      state: reactive({ binding: null, session: null, nextTarget: null, busy: false, visible: false, error: "" }),
      open: async () => false, end: async () => {}, reveal() {}, minimize() {}
    },
    launcher: shallowRef(null),
    readAloudFor: () => false,
    readAloudChangePendingFor: () => false,
    avatarVisibleFor: () => null,
    setAvatarVisible() {},
    Avatar: null,
    Settings: null,
    open: async () => null
  };
}

export function provideVoiceDouble(app, voice = voiceDouble()) {
  app.provide(VIBE64_VOICE_KEY, voice);
  return voice;
}

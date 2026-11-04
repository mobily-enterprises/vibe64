<script>
import { h } from "vue";
import PackageShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import Vibe64AiTaskTrayTarget from "./Vibe64AiTaskTrayTarget.vue";
import Vibe64ColleagueLauncherTarget from "./Vibe64ColleagueLauncherTarget.vue";
import Vibe64LearningButton from "./learning/Vibe64LearningButton.vue";

export default {
  name: "ShellLayout",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    // A page's own content for one of the header's places, read at each render; a page passes only what it has.
    // readable-check: allow optional-call - optional operation: a page fills only the header places it has content for
    const pageSlot = (name, slotProps) => slots[name]?.(slotProps);
    return () => h(PackageShellLayout, attrs, {
      ...slots,
      // The L button leads every management page header, as in the Studio shell.
      "top-left": (slotProps) => [h(Vibe64LearningButton), pageSlot("top-left", slotProps)],
      "top-right": (slotProps) => [
        h(ShellOutlet, { target: "shell-layout:top-right" }),
        pageSlot("top-right", slotProps),
        h(Vibe64AiTaskTrayTarget),
        h(Vibe64ColleagueLauncherTarget)
      ]
    });
  }
};
</script>

<style>
body.studio-shell-drawer-hidden [aria-label="Toggle navigation menu"] {
  display: none !important;
}

body.studio-shell-drawer-hidden [data-testid="jskit-shell-drawer"] {
  display: none !important;
  visibility: hidden !important;
  width: 0 !important;
}

body.studio-shell-drawer-hidden .v-main {
  --v-layout-left: 0px !important;
  padding-left: 0 !important;
}

body.studio-shell-drawer-hidden .shell-layout__content {
  padding-inline: 0.75rem;
}

body.studio-home-shell-active {
  overflow: hidden;
}

body.studio-home-shell-active .v-application,
body.studio-home-shell-active .v-application__wrap {
  height: 100dvh;
  min-height: 100dvh;
  overflow: hidden;
}

body.studio-home-shell-active .v-main {
  min-height: 0;
  overflow: hidden;
}

body.studio-home-shell-active .shell-layout__content {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--v-layout-top, 0px) - var(--v-layout-bottom, 0px));
  min-height: 0;
  overflow: hidden;
}

body.studio-home-shell-active .shell-route-transition,
body.studio-home-shell-active .shell-route-transition__pane {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}
</style>

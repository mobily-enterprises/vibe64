import { onBeforeUnmount, toValue, watchEffect } from "vue";
import { useShellLayoutState } from "@jskit-ai/shell-web/client/composables/useShellLayoutState";

const DRAWER_HIDDEN_CLASS = "studio-shell-drawer-hidden";

function setDrawerToggleHidden(hidden) {
  if (typeof document === "undefined") {
    return;
  }
  document.body.classList.toggle(DRAWER_HIDDEN_CLASS, Boolean(hidden));
}

/**
 * Hides the shell's navigation drawer and its toggle while `hidden` is true, and restores them on unmount.
 * @param {{ hidden: import("vue").MaybeRefOrGetter<boolean> }} options
 */
export function useStudioShellDrawer({ hidden }) {
  const {
    drawerDefaultOpen,
    setDrawerDefaultOpen,
    setDrawerOpen
  } = useShellLayoutState();
  const originalDrawerDefaultOpen = drawerDefaultOpen.value;

  watchEffect(() => {
    const drawerHidden = Boolean(toValue(hidden));
    setDrawerToggleHidden(drawerHidden);
    if (drawerHidden) {
      setDrawerDefaultOpen(false);
      setDrawerOpen(false);
    }
  });

  onBeforeUnmount(() => {
    setDrawerToggleHidden(false);
    setDrawerDefaultOpen(originalDrawerDefaultOpen);
    setDrawerOpen(originalDrawerDefaultOpen);
  });
}

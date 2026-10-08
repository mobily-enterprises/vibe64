<template>
  <v-app-bar
    border
    class="shell-layout__app-bar bg-surface"
    :class="{ 'studio-app-shell-layout--learning': learningMode }"
    density="comfortable"
    elevation="0"
    data-testid="jskit-shell-app-bar"
    @touchstart.passive="startPaneSwipe($event, true)"
    @touchmove="movePaneSwipe"
    @touchend="endPaneSwipe"
    @touchcancel="cancelPaneSwipe"
  >
    <v-btn
      v-if="showLearningModeControl"
      class="studio-app-shell-layout__learning-plate"
      :class="{ 'studio-app-shell-layout__learning-plate--active': learningMode }"
      aria-label="Learning mode"
      :aria-pressed="learningMode"
      :title="learningMode ? 'Switch to Working mode' : 'Switch to Learning mode'"
      height="40"
      min-width="44"
      variant="flat"
      @click="emit('update:learningMode', !learningMode)"
    >
      <span aria-hidden="true">L</span>
    </v-btn>
    <slot name="top-left" />
    <v-spacer />
    <div class="studio-app-shell-layout__top-right">
      <ShellOutlet target="shell-layout:top-right" />
      <slot name="top-right" />
      <Vibe64ColleagueLauncherTarget />
    </div>
  </v-app-bar>

  <v-main class="bg-background" :class="{ 'studio-app-shell-layout--learning': learningMode, 'studio-app-shell-layout--fill-viewport': fillViewport }">
    <v-container
      fluid
      class="shell-layout__content studio-app-shell-layout__content"
      :class="{ 'studio-app-shell-layout__content--fill-viewport': fillViewport }"
      @touchstart.passive="startPaneSwipe"
      @touchmove="movePaneSwipe"
      @touchend="endPaneSwipe"
      @touchcancel="cancelPaneSwipe"
    >
      <slot />
    </v-container>
  </v-main>
</template>

<script setup>
import { watch } from "vue";
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import Vibe64ColleagueLauncherTarget from "./Vibe64ColleagueLauncherTarget.vue";

const SWIPE_MIN_DISTANCE_PX = 64;
const SWIPE_INTENT_DISTANCE_PX = 12;
const SWIPE_MAX_DURATION_MS = 700;
const SWIPE_HORIZONTAL_RATIO = 2;
const BROWSER_GESTURE_EDGE_PX = 24;

const props = defineProps({
  mobilePaneSwipeEnabled: Boolean,
  chatCollapsed: Boolean,
  showLearningModeControl: Boolean,
  learningMode: Boolean,
  fillViewport: Boolean
});
const emit = defineEmits(["update:chatCollapsed", "update:learningMode"]);
let paneSwipe = null;

watch(() => [props.mobilePaneSwipeEnabled, props.chatCollapsed], cancelPaneSwipe);

function cancelPaneSwipe() {
  paneSwipe = null;
}

function startPaneSwipe(event, header = false) {
  cancelPaneSwipe();
  if (
    !props.mobilePaneSwipeEnabled || event.defaultPrevented || event.touches.length !== 1
    || window.getSelection()?.isCollapsed === false
  ) {
    return;
  }

  const target = event.target;
  if (target.closest(`
    input, textarea, select, [contenteditable]:not([contenteditable="false"]),
    [role="textbox"], [role="slider"], [role="separator"], [role="dialog"], [role="menu"],
    [draggable="true"], canvas, iframe, video, audio, .cm-editor, .xterm, [data-pane-swipe-ignore]
  `)) {
    return;
  }
  if (!header && target.closest('a, button, [role="button"], svg')) {
    return;
  }

  // Leave tables, code blocks and other horizontal scrollers in control.
  for (let node = target; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    // Drag handles and custom gesture surfaces declare their own touch behavior.
    if (style.touchAction === "none" || style.touchAction.startsWith("pan-")) {
      return;
    }
    if (node.scrollWidth > node.clientWidth + 1 && /^(auto|scroll)$/u.test(style.overflowX)) {
      return;
    }
    if (node === event.currentTarget) {
      break;
    }
  }

  const touch = event.touches[0];
  // Browser back/forward gestures keep the outer screen edges.
  if (touch.clientX < BROWSER_GESTURE_EDGE_PX || touch.clientX > window.innerWidth - BROWSER_GESTURE_EDGE_PX) {
    return;
  }
  paneSwipe = {
    id: touch.identifier,
    x: touch.clientX,
    y: touch.clientY,
    startedAt: event.timeStamp,
    chatCollapsed: props.chatCollapsed
  };
}

function movePaneSwipe(event) {
  if (!paneSwipe) {
    return;
  }
  if (
    !props.mobilePaneSwipeEnabled || event.defaultPrevented || event.touches.length !== 1
    || event.timeStamp - paneSwipe.startedAt > SWIPE_MAX_DURATION_MS
  ) {
    cancelPaneSwipe();
    return;
  }
  const touch = event.touches[0];
  const horizontalDistance = Math.abs(touch.clientX - paneSwipe.x);
  const verticalDistance = Math.abs(touch.clientY - paneSwipe.y);
  if (
    touch.identifier !== paneSwipe.id
    || (verticalDistance > SWIPE_INTENT_DISTANCE_PX && horizontalDistance < verticalDistance * SWIPE_HORIZONTAL_RATIO)
  ) {
    cancelPaneSwipe();
    return;
  }
  const horizontalIntent = horizontalDistance > SWIPE_INTENT_DISTANCE_PX
    && horizontalDistance >= verticalDistance * SWIPE_HORIZONTAL_RATIO;
  if (!horizontalIntent) {
    return;
  }
  if (!event.cancelable) {
    cancelPaneSwipe();
    return;
  }
  // Only claim a deliberate horizontal gesture; vertical scrolling stays native.
  event.preventDefault();
}

function endPaneSwipe(event) {
  const swipe = paneSwipe;
  cancelPaneSwipe();
  if (
    !swipe || !props.mobilePaneSwipeEnabled || event.defaultPrevented || event.touches.length
    || props.chatCollapsed !== swipe.chatCollapsed || event.timeStamp - swipe.startedAt > SWIPE_MAX_DURATION_MS
    || window.getSelection()?.isCollapsed === false
  ) {
    return;
  }
  const touch = Array.from(event.changedTouches).find((item) => item.identifier === swipe.id);
  if (!touch) {
    return;
  }
  const dx = touch.clientX - swipe.x;
  const horizontalDistance = Math.abs(dx);
  const verticalDistance = Math.abs(touch.clientY - swipe.y);
  if (horizontalDistance < SWIPE_MIN_DISTANCE_PX || horizontalDistance < verticalDistance * SWIPE_HORIZONTAL_RATIO) {
    return;
  }
  // Suppress the tap that would otherwise activate a header button after swiping.
  if (event.cancelable) {
    event.preventDefault();
  }
  emit("update:chatCollapsed", dx < 0);
}
</script>

<style scoped>
:global(body.studio-home-shell-active) {
  overflow: hidden;
}

:global(body.studio-home-shell-active .v-application),
:global(body.studio-home-shell-active .v-application__wrap) {
  height: 100dvh;
  min-height: 100dvh;
  overflow: hidden;
}

:global(body.studio-home-shell-active .v-main) {
  min-height: 0;
  overflow: hidden;
}

:global(body.studio-home-shell-active .shell-layout__content) {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--v-layout-top, 0px) - var(--v-layout-bottom, 0px));
  min-height: 0;
  overflow: hidden;
  padding-bottom: 0;
  padding-left: 0;
  padding-right: 0;
  padding-top: 0.35rem;
}

:global(body.studio-home-shell-active .shell-error-host__banners) {
  left: auto;
  right: 0;
  width: min(30rem, 100vw);
}

:global(body.studio-home-shell-active .shell-error-host__banner-stack) {
  width: 100%;
}

.studio-app-shell-layout__content {
  padding: 0.75rem 0.75rem 0;
}

.studio-app-shell-layout--fill-viewport { height: 100dvh; overflow: hidden; }
.studio-app-shell-layout__content--fill-viewport {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--v-layout-top, 0px) - var(--v-layout-bottom, 0px));
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.studio-app-shell-layout--learning {
  background-color: color-mix(in srgb, rgb(var(--v-theme-surface)) 92%, #ffdb2c) !important;
}

.studio-app-shell-layout__learning-plate {
  flex: 0 0 auto;
  margin-left: 0.75rem;
  border: 2px solid #101010;
  border-radius: 3px;
  background-color: #ffdb2c !important;
  color: #101010 !important;
  font-size: 1.75rem;
  font-weight: 800;
  line-height: 1;
  padding: 0 0.5rem;
}

.studio-app-shell-layout__learning-plate--active {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-on-surface));
}

.studio-app-shell-layout__learning-plate:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .studio-app-shell-layout__learning-plate {
    transition: none;
  }
}

.studio-app-shell-layout__top-right {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.25rem;
  min-width: 0;
}
</style>

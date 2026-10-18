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
      :title="learningMode ? 'Leave Learning mode' : 'Enter Learning mode'"
      density="comfortable"
      icon
      size="small"
      :variant="learningMode ? 'flat' : 'outlined'"
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

  <v-main
    class="bg-background"
    :class="{
      'studio-app-shell-layout--learning': learningMode,
      'studio-app-shell-layout--learning-stacked': learningMode && !mobilePaneSwipeEnabled,
      'studio-app-shell-layout--fill-viewport': fillViewport
    }"
  >
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

watch(() => [props.mobilePaneSwipeEnabled, props.chatCollapsed, props.learningMode], cancelPaneSwipe);

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

/* M3 small top app bar: surface at rest with a hairline outline-variant
   divider. Learning fades in a warm amber wash and a thin amber rule along
   the bottom edge, so the mode is unmistakable without shouting. */
.shell-layout__app-bar {
  border-bottom-color: var(--v64-outline-variant) !important;
  transition: border-color var(--v64-duration-medium) var(--v64-ease-standard);
}

.shell-layout__app-bar::before,
.shell-layout__app-bar::after {
  content: "";
  opacity: 0;
  pointer-events: none;
  position: absolute;
  transition: opacity var(--v64-duration-long) var(--v64-ease-standard);
}

.shell-layout__app-bar::before {
  background: var(--v64-learning-app-bar);
  inset: 0;
}

.shell-layout__app-bar::after {
  background: linear-gradient(90deg, var(--v64-learning-strong), var(--v64-learning) 45%, transparent);
  bottom: 0;
  height: 2px;
  left: 0;
  right: 0;
}

.shell-layout__app-bar :deep(.v-toolbar__content) {
  position: relative;
  z-index: 1;
}

.shell-layout__app-bar.studio-app-shell-layout--learning {
  border-bottom-color: transparent !important;
}

.shell-layout__app-bar.studio-app-shell-layout--learning::before,
.shell-layout__app-bar.studio-app-shell-layout--learning::after {
  opacity: 1;
}

.v-main.studio-app-shell-layout--learning {
  background-color: var(--v64-learning-tint) !important;
}

/* The L plate: the mode switch. Off, it is a quiet outlined plate that warms
   up on hover as a preview of the mode; on, it becomes a solid yellow learner
   plate with a crisp ink edge, a soft glow and a small pop. Same footprint as
   the neighbouring header icon buttons. */
.studio-app-shell-layout__learning-plate {
  --v64-plate-ink: #1d1600;
  background: var(--v64-surface-container-low) !important;
  border: 1.5px solid var(--v64-outline) !important;
  border-radius: var(--v64-shape-sm);
  color: var(--v64-on-surface-variant) !important;
  flex: 0 0 auto;
  font-family: system-ui, sans-serif;
  font-size: 1.05rem;
  font-weight: 850;
  line-height: 1;
  margin-left: var(--v64-space-3);
  transition:
    background-color var(--v64-duration-short) var(--v64-ease-standard),
    border-color var(--v64-duration-short) var(--v64-ease-standard),
    box-shadow var(--v64-duration-medium) var(--v64-ease-standard),
    color var(--v64-duration-short) var(--v64-ease-standard),
    transform var(--v64-duration-short) var(--v64-ease-standard);
}

@media (hover: hover) {
  .studio-app-shell-layout__learning-plate:hover {
    background: var(--v64-learning-container) !important;
    border-color: var(--v64-learning-strong) !important;
    color: var(--v64-on-learning-container) !important;
  }
}

.studio-app-shell-layout__learning-plate:active {
  transform: scale(0.94);
}

.studio-app-shell-layout__learning-plate--active,
.studio-app-shell-layout__learning-plate--active:hover {
  animation: studio-app-shell-plate-pop var(--v64-duration-long) var(--v64-ease-emphasized-decelerate);
  background: linear-gradient(150deg, #ffe680 0%, var(--v64-learning) 55%, #f0b400 100%) !important;
  border-color: var(--v64-plate-ink) !important;
  box-shadow: 0 0 0 3px var(--v64-learning-glow), var(--v64-elevation-1);
  color: var(--v64-plate-ink) !important;
}

.studio-app-shell-layout__learning-plate:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: 3px;
}

@keyframes studio-app-shell-plate-pop {
  0% { transform: scale(0.82) rotate(-8deg); }
  60% { transform: scale(1.08) rotate(2deg); }
  100% { transform: scale(1) rotate(0); }
}

@media (prefers-reduced-motion: reduce) {
  .studio-app-shell-layout__learning-plate,
  .studio-app-shell-layout__learning-plate--active {
    animation: none;
    transition: none;
  }
}

@media (max-width: 600px) {
  /* 40px touch target on phones. */
  .studio-app-shell-layout__learning-plate {
    height: 2.5rem;
    margin-left: var(--v64-space-1);
    width: 2.5rem;
  }

  /* Phone bar budget: the passive realtime dot (a disabled indicator, not a
     touch target) and the account/Colleague buttons tighten so the project
     name keeps its readable minimum. */
  .studio-app-shell-layout__top-right {
    gap: 0;
    margin-left: auto;
  }

  .shell-layout__app-bar .v-spacer {
    display: none;
  }

  .studio-app-shell-layout__top-right > :deep(button:disabled) {
    width: 1rem !important;
  }

  .studio-app-shell-layout__top-right :deep(.vibe64-auth-settings) {
    margin-inline-end: var(--v64-space-1);
  }

  .studio-app-shell-layout__top-right :deep(.vibe64-auth-settings__button),
  .studio-app-shell-layout__top-right :deep(.vibe64-colleague-launcher-target > .v-btn) {
    flex-basis: 2.5rem;
    height: 2.5rem !important;
    min-height: 2.5rem;
    min-width: 2.5rem;
    width: 2.5rem !important;
  }
}

.studio-app-shell-layout__top-right {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.25rem;
  min-width: 0;
}

/* Only where Learning has no chat/project pane switching (the Courses page
   without a project) are chat and lessons stacked; a project page in Learning
   uses the Working arrow and swipe unchanged. */
@media (max-width: 980px) {
  .studio-app-shell-layout--learning-stacked :deep(.studio-autopilot:not(.studio-autopilot--chat-collapsed)),
  .studio-app-shell-layout--learning-stacked :deep(.studio-ai-sessions__empty-layout) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
    gap: 0.5rem;
  }

  .studio-app-shell-layout--learning-stacked :deep(.studio-autopilot:not(.studio-autopilot--chat-collapsed) .studio-autopilot__project-panel),
  .studio-app-shell-layout--learning-stacked :deep(.studio-ai-sessions__empty-project-panel) {
    display: grid;
    visibility: visible;
  }
}
</style>

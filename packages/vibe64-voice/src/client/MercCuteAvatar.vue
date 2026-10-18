<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const IDLE_FACES = Object.freeze([
  { name: "soft-center", mouth: "soft-smile" },
  { name: "easy-left", gazeX: "-2.5px", headRotate: "-1.5deg", mouth: "soft-smile" },
  { name: "quiet-center", browY: "0.5px", headY: "1px", mouth: "soft-smile" },
  { name: "warm-nod", headY: "2.5px", mouth: "warm-smile" },
  { name: "easy-right", gazeX: "2.5px", headRotate: "1.5deg", mouth: "soft-smile" },
  { name: "bright-eyes", browY: "-1.5px", gazeY: "-0.5px", mouth: "soft-smile" },
  { name: "curious", browRightRotate: "5deg", headRotate: "-3deg", mouth: "warm-smile" },
  { name: "friendly", headRotate: "2.5deg", headX: "1px", mouth: "soft-smile" },
  { name: "big-smile", browY: "-1px", headY: "-1px", mouth: "big-smile" },
  { name: "rested", gazeY: "1px", headRotate: "-0.5deg", mouth: "soft-smile" }
]);

const LISTENING_FACES = Object.freeze([
  { name: "attentive", browY: "-1.5px", mouth: "soft-smile" },
  { name: "tiny-nod", headY: "2.5px", mouth: "soft-smile" },
  { name: "follow-left", gazeX: "-3px", headRotate: "-1.5deg", mouth: "closed" },
  { name: "tilt-left", browRightRotate: "5deg", headRotate: "-4deg", mouth: "soft-smile" },
  { name: "follow-right", gazeX: "3px", headRotate: "1.5deg", mouth: "closed" },
  { name: "tilt-right", browLeftRotate: "-5deg", headRotate: "4deg", mouth: "soft-smile" }
]);

const PRE_THINKING_FACES = Object.freeze([
  { name: "settle", gazeY: "0.5px", mouth: "closed" },
  { name: "glance-left", gazeX: "-2px", gazeY: "-1px", headRotate: "-1deg", mouth: "closed" },
  { name: "center", browY: "0.75px", headY: "1px", mouth: "thoughtful" },
  { name: "glance-right", gazeX: "2px", gazeY: "-1px", headRotate: "1deg", mouth: "closed" },
  { name: "tiny-tilt", browRightRotate: "4deg", headRotate: "-2.5deg", mouth: "thoughtful" },
  { name: "ready", browY: "-1px", headY: "-1px", mouth: "soft-smile" }
]);

const THINKING_FACES = Object.freeze([
  { name: "look-up-left", browLeftRotate: "-6deg", gazeX: "-2.5px", gazeY: "-3px", headRotate: "-3deg", mouth: "thoughtful" },
  { name: "focus", browLeftRotate: "4deg", browRightRotate: "-4deg", gazeY: "-1px", mouth: "closed" },
  { name: "look-up-right", browRightRotate: "6deg", gazeX: "2.5px", gazeY: "-3px", headRotate: "3deg", mouth: "thoughtful" },
  { name: "weigh-left", gazeX: "-3px", headRotate: "-4deg", mouth: "closed" },
  { name: "weigh-right", gazeX: "3px", headRotate: "4deg", mouth: "closed" },
  { name: "idea", browY: "-2px", gazeY: "-1px", headY: "-1.5px", mouth: "warm-smile" }
]);

const FACE_SEQUENCES = Object.freeze({
  idle: IDLE_FACES,
  listening: LISTENING_FACES,
  "pre-thinking": PRE_THINKING_FACES,
  thinking: THINKING_FACES
});
const FACE_INTERVAL_MS = Object.freeze({
  idle: 3_400,
  listening: 1_350,
  "pre-thinking": 1_450,
  thinking: 1_700
});
const VALID_MOUTH_POSES = Object.freeze(["open", "round", "small", "wide"]);

const props = defineProps({
  mouthLevel: {
    default: 0,
    type: Number
  },
  mouthPose: {
    default: "closed",
    type: String
  },
  state: {
    default: "idle",
    type: String
  }
});

const blinking = ref(false);
const currentFace = ref(IDLE_FACES[0]);
const reducedMotion = ref(false);
let blinkTimer = 0;
let faceTimer = 0;
let reopenTimer = 0;
let reducedMotionQuery = null;
let running = false;
const nextFaceIndex = {
  idle: 0,
  listening: 0,
  "pre-thinking": 0,
  thinking: 0
};

const expression = computed(() => {
  const state = String(props.state || "idle");
  return ["idle", "listening", "pre-thinking", "thinking", "speaking"].includes(state)
    ? state
    : "idle";
});
const faceStyle = computed(() => {
  const face = currentFace.value || {};
  return {
    "--merc-brow-left-rotate": face.browLeftRotate || "0deg",
    "--merc-brow-right-rotate": face.browRightRotate || "0deg",
    "--merc-brow-y": face.browY || "0px",
    "--merc-gaze-x": face.gazeX || "0px",
    "--merc-gaze-y": face.gazeY || "0px",
    "--merc-head-rotate": face.headRotate || "0deg",
    "--merc-head-x": face.headX || "0px",
    "--merc-head-y": face.headY || "0px"
  };
});
const visibleMouthPose = computed(() => {
  if (expression.value !== "speaking") {
    return currentFace.value?.mouth || "soft-smile";
  }
  const pose = String(props.mouthPose || "closed");
  return props.mouthLevel >= 0.045 && VALID_MOUTH_POSES.includes(pose)
    ? pose
    : "soft-smile";
});

function clearTimers() {
  window.clearTimeout(blinkTimer);
  window.clearTimeout(faceTimer);
  window.clearTimeout(reopenTimer);
  blinkTimer = 0;
  faceTimer = 0;
  reopenTimer = 0;
}

function scheduleBlink(delay = 2_600 + (Math.random() * 3_600)) {
  window.clearTimeout(blinkTimer);
  if (!running || reducedMotion.value) return;
  blinkTimer = window.setTimeout(() => {
    blinking.value = true;
    reopenTimer = window.setTimeout(() => {
      blinking.value = false;
      scheduleBlink();
    }, 125);
  }, delay);
}

function showNextFace() {
  window.clearTimeout(faceTimer);
  const state = expression.value;
  const sequence = FACE_SEQUENCES[state];
  if (!sequence) {
    currentFace.value = null;
    return;
  }
  if (reducedMotion.value) {
    currentFace.value = sequence[0];
    return;
  }
  const index = nextFaceIndex[state] % sequence.length;
  currentFace.value = sequence[index];
  nextFaceIndex[state] = (index + 1) % sequence.length;
  if (!running) return;
  const jitter = state === "idle" ? Math.random() * 1_200 : 0;
  faceTimer = window.setTimeout(showNextFace, FACE_INTERVAL_MS[state] + jitter);
}

function updateReducedMotion(event) {
  reducedMotion.value = event.matches;
  showNextFace();
  scheduleBlink();
}

watch(expression, () => {
  const sequence = FACE_SEQUENCES[expression.value];
  if (sequence && expression.value !== "idle") {
    nextFaceIndex[expression.value] = Math.floor(Math.random() * sequence.length);
  }
  showNextFace();
});

onMounted(() => {
  running = true;
  reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion.value = reducedMotionQuery.matches;
  reducedMotionQuery.addEventListener?.("change", updateReducedMotion);
  showNextFace();
  scheduleBlink(900 + (Math.random() * 1_100));
});

onBeforeUnmount(() => {
  running = false;
  clearTimers();
  reducedMotionQuery?.removeEventListener?.("change", updateReducedMotion);
  reducedMotionQuery = null;
});
</script>

<template>
  <svg
    :aria-label="'Cute illustrated AI avatar of Merc, ' + expression"
    class="merc-cute-avatar"
    :class="[
      'merc-cute-avatar--' + expression,
      'merc-cute-avatar--mouth-' + visibleMouthPose,
      { 'merc-cute-avatar--blinking': blinking }
    ]"
    role="img"
    :style="faceStyle"
    viewBox="0 0 320 320"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="merc-cute-hair" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#15131c" />
        <stop offset="0.5" stop-color="#2b2531" />
        <stop offset="1" stop-color="#161521" />
      </linearGradient>
      <linearGradient id="merc-cute-hair-light" x1="0" x2="1">
        <stop offset="0" stop-color="#a98a9d" stop-opacity="0.12" />
        <stop offset="0.48" stop-color="#d7b9c4" stop-opacity="0.44" />
        <stop offset="1" stop-color="#7b7188" stop-opacity="0.1" />
      </linearGradient>
      <linearGradient id="merc-cute-skin" x1="0" x2="0.8" y1="0" y2="1">
        <stop offset="0" stop-color="#ffe6d8" />
        <stop offset="0.62" stop-color="#f7c5b2" />
        <stop offset="1" stop-color="#df927f" />
      </linearGradient>
      <radialGradient id="merc-cute-iris" cx="38%" cy="28%" r="74%">
        <stop offset="0" stop-color="#ebeaf6" />
        <stop offset="0.38" stop-color="#aaa6bb" />
        <stop offset="0.74" stop-color="#666273" />
        <stop offset="1" stop-color="#373441" />
      </radialGradient>
      <filter id="merc-cute-soft-shadow" x="-30%" y="-30%" width="160%" height="170%">
        <feDropShadow dx="0" dy="5" flood-color="#321a3c" flood-opacity="0.2" stdDeviation="5" />
      </filter>
    </defs>

    <g class="merc-cute-avatar__body">
      <path class="merc-cute-avatar__bare-shoulders" d="M66 320c9-16 28-21 52-27l6-12h72l6 12c24 6 43 11 52 27H66Z" />
      <path class="merc-cute-avatar__neck" d="M124 210h72v64c-8 12-23 18-36 18s-28-6-36-18v-64Z" />
      <path class="merc-cute-avatar__neck-shadow" d="M128 216c20 12 44 12 64 0v19c-17 11-47 14-64 4v-23Z" />
      <path class="merc-cute-avatar__collarbones" d="M105 307q25-15 47-10m63 10q-25-15-47-10" />
      <path class="merc-cute-avatar__shoulder-light" d="M72 316c18-12 41-15 61-20m115 20c-18-12-41-15-61-20" />
    </g>

    <g class="merc-cute-avatar__head-pose">
      <g class="merc-cute-avatar__head" filter="url(#merc-cute-soft-shadow)">
        <path class="merc-cute-avatar__hair-back" d="M79 177C67 128 78 82 119 48l7-17 12 11 20-24 13 22 21-15 1 22c24 12 40 31 48 56l17 4-14 12 6 18-16 3c3 34-8 69-31 100l-17-12-12 29-16-21-14 25-16-23-18 20-9-28-23 12c-16-16-23-34-16-52Z" />
        <path class="merc-cute-avatar__hair-glow" d="M92 179c-8-45 3-91 36-119-22 31-26 87-11 137l-25-18Zm111-119c30 26 38 76 25 123l-24 17c15-54 10-105-1-140Z" />

        <ellipse class="merc-cute-avatar__ear" cx="91" cy="152" rx="15" ry="24" />
        <ellipse class="merc-cute-avatar__ear" cx="229" cy="152" rx="15" ry="24" />
        <path class="merc-cute-avatar__face" d="M160 56c-41 0-65 31-64 80 2 47 23 82 64 94 41-12 62-47 64-94 1-49-23-80-64-80Z" />

        <path class="merc-cute-avatar__hair-cap" d="M91 128c0-37 11-64 33-77l2-20 12 11 20-24 13 22 21-15 1 22c22 12 35 33 36 65-18-15-39-27-65-35-16 24-41 43-73 51Z" />
        <path class="merc-cute-avatar__bang merc-cute-avatar__bang--left" d="M125 52l12 17c8 19 8 40 3 63-8-24-20-44-36-56l21-24Z" />
        <path class="merc-cute-avatar__bang merc-cute-avatar__bang--center" d="M153 40l11 18c2 24-5 47-17 68 2-26-6-50-20-67l26-19Z" />
        <path class="merc-cute-avatar__bang merc-cute-avatar__bang--right" d="M182 43l10 20c-1 25-15 45-36 61 10-24 9-49-2-72l28-9Z" />
        <path class="merc-cute-avatar__side-lock merc-cute-avatar__side-lock--left" d="M105 76c-20 24-24 66-15 105 5 23 17 43 37 58l7-27c-15-26-21-61-15-104l-14-32Z" />
        <path class="merc-cute-avatar__side-lock merc-cute-avatar__side-lock--right" d="M212 72c20 25 25 67 18 106-5 25-18 46-38 62l-7-27c16-28 21-64 14-107l13-34Z" />
        <path class="merc-cute-avatar__hair-sheen" d="M111 70c13-14 29-21 45-23m-51 35c-9 22-11 54-5 85m105-96c12 25 15 58 8 91" />
        <path class="merc-cute-avatar__cyber-streak merc-cute-avatar__cyber-streak--cyan" d="M109 78c-9 24-11 58-5 91" />
        <path class="merc-cute-avatar__cyber-streak merc-cute-avatar__cyber-streak--pink" d="M203 66c11 26 14 60 9 94" />

        <g class="merc-cute-avatar__brows">
          <path class="merc-cute-avatar__brow merc-cute-avatar__brow--left" d="M105 109q20-13 42-1" />
          <path class="merc-cute-avatar__brow merc-cute-avatar__brow--right" d="M173 108q22-12 42 1" />
        </g>

        <g class="merc-cute-avatar__eyes-open">
          <ellipse class="merc-cute-avatar__eye-white" cx="126" cy="141" rx="19" ry="14" />
          <ellipse class="merc-cute-avatar__eye-white" cx="194" cy="141" rx="19" ry="14" />
          <g class="merc-cute-avatar__gaze">
            <circle class="merc-cute-avatar__iris" cx="127" cy="142" r="10" />
            <circle class="merc-cute-avatar__iris" cx="193" cy="142" r="10" />
            <circle class="merc-cute-avatar__pupil" cx="127" cy="143" r="5" />
            <circle class="merc-cute-avatar__pupil" cx="193" cy="143" r="5" />
            <circle class="merc-cute-avatar__eye-glint" cx="123" cy="137" r="3" />
            <circle class="merc-cute-avatar__eye-glint" cx="189" cy="137" r="3" />
            <circle class="merc-cute-avatar__eye-glint merc-cute-avatar__eye-glint--small" cx="130" cy="146" r="1.4" />
            <circle class="merc-cute-avatar__eye-glint merc-cute-avatar__eye-glint--small" cx="196" cy="146" r="1.4" />
          </g>
          <path class="merc-cute-avatar__eye-line" d="M107 140q19-19 38 0M175 140q19-19 38 0" />
          <path class="merc-cute-avatar__lash" d="m108 136-5-3m9 0-3-6m103 9 5-3m-9 0 3-6" />
        </g>
        <g class="merc-cute-avatar__eyes-closed">
          <path d="M109 142q17 11 34 0M177 142q17 11 34 0" />
          <path class="merc-cute-avatar__lash" d="m111 145-5 3m9-1-3 5m97-7 5 3m-9-1 3 5" />
        </g>

        <path class="merc-cute-avatar__nose" d="M160 158q-3 9 2 11" />
        <circle class="merc-cute-avatar__nose-light" cx="160" cy="163" r="2" />
        <ellipse class="merc-cute-avatar__cheek" cx="116" cy="177" rx="16" ry="7" />
        <ellipse class="merc-cute-avatar__cheek" cx="204" cy="177" rx="16" ry="7" />

        <g class="merc-cute-avatar__mouth">
          <g v-if="visibleMouthPose === 'big-smile'">
            <path class="merc-cute-avatar__mouth-inside" d="M143 194q17 10 34 0c-2 16-9 23-17 23s-15-7-17-23Z" />
            <path class="merc-cute-avatar__teeth" d="M147 197q13 6 26 0c-2 6-7 9-13 9s-11-3-13-9Z" />
          </g>
          <g v-else-if="visibleMouthPose === 'wide'">
            <path class="merc-cute-avatar__mouth-inside" d="M143 198q17-7 34 0-3 16-17 16t-17-16Z" />
            <path class="merc-cute-avatar__teeth" d="M147 198q13-4 26 0-4 5-13 5t-13-5Z" />
          </g>
          <g v-else-if="visibleMouthPose === 'open'">
            <ellipse class="merc-cute-avatar__mouth-inside" cx="160" cy="204" rx="11" ry="15" />
            <path class="merc-cute-avatar__tongue" d="M151 211q9-6 18 0-3 6-9 6t-9-6Z" />
          </g>
          <g v-else-if="visibleMouthPose === 'round'">
            <ellipse class="merc-cute-avatar__mouth-inside" cx="160" cy="202" rx="7" ry="10" />
            <ellipse class="merc-cute-avatar__lip-outline" cx="160" cy="202" rx="9" ry="12" />
          </g>
          <g v-else-if="visibleMouthPose === 'small'">
            <ellipse class="merc-cute-avatar__mouth-inside" cx="160" cy="199" rx="10" ry="5" />
            <path class="merc-cute-avatar__lip-line" d="M151 199q9 6 18 0" />
          </g>
          <path v-else-if="visibleMouthPose === 'warm-smile'" class="merc-cute-avatar__lip-line" d="M147 195q13 8 26 0" />
          <path v-else-if="visibleMouthPose === 'thoughtful'" class="merc-cute-avatar__lip-line" d="M150 199q10-3 21 1" />
          <path v-else-if="visibleMouthPose === 'closed'" class="merc-cute-avatar__lip-line" d="M150 198q10 1 20 0" />
          <path v-else class="merc-cute-avatar__lip-line" d="M149 197q11 4 22 0" />
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.merc-cute-avatar {
  display: block;
  height: 100%;
  overflow: visible;
  width: 100%;
}

.merc-cute-avatar__body {
  animation: merc-cute-breathe 4.2s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: 50% 100%;
}

.merc-cute-avatar__bare-shoulders,
.merc-cute-avatar__neck {
  fill: url(#merc-cute-skin);
}

.merc-cute-avatar__neck-shadow {
  fill: #dc958c;
  opacity: 0.2;
}

.merc-cute-avatar__collarbones,
.merc-cute-avatar__shoulder-light {
  fill: none;
  stroke: #c98778;
  stroke-linecap: round;
  stroke-width: 2;
}

.merc-cute-avatar__shoulder-light {
  opacity: 0.18;
  stroke: #fff5ed;
  stroke-width: 4;
}

.merc-cute-avatar__head-pose {
  transform: translate(var(--merc-head-x), var(--merc-head-y)) rotate(var(--merc-head-rotate));
  transform-box: fill-box;
  transform-origin: 50% 83%;
  transition: transform 520ms cubic-bezier(0.2, 0, 0, 1);
}

.merc-cute-avatar__head {
  animation: merc-cute-idle 7s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: 50% 83%;
}

.merc-cute-avatar--listening .merc-cute-avatar__head,
.merc-cute-avatar--pre-thinking .merc-cute-avatar__head,
.merc-cute-avatar--thinking .merc-cute-avatar__head {
  animation: none;
}

.merc-cute-avatar--speaking .merc-cute-avatar__head {
  animation: merc-cute-speaking 3.2s ease-in-out infinite;
}

.merc-cute-avatar__hair-back,
.merc-cute-avatar__bang,
.merc-cute-avatar__side-lock {
  fill: url(#merc-cute-hair);
}

.merc-cute-avatar__hair-glow {
  fill: url(#merc-cute-hair-light);
}

.merc-cute-avatar__hair-cap {
  fill: #211c28;
}

.merc-cute-avatar__hair-sheen {
  fill: none;
  opacity: 0.42;
  stroke: #b59cac;
  stroke-linecap: round;
  stroke-width: 4;
}

.merc-cute-avatar__cyber-streak {
  fill: none;
  opacity: 0.62;
  stroke-linecap: round;
  stroke-width: 3;
}

.merc-cute-avatar__cyber-streak--cyan {
  stroke: #69d8df;
}

.merc-cute-avatar__cyber-streak--pink {
  stroke: #c875a5;
}

.merc-cute-avatar__ear,
.merc-cute-avatar__face {
  fill: url(#merc-cute-skin);
}

.merc-cute-avatar__brow {
  fill: none;
  stroke: #40343f;
  stroke-linecap: round;
  stroke-width: 4.5;
  transform-box: fill-box;
  transform-origin: center;
  transition: transform 520ms cubic-bezier(0.2, 0, 0, 1);
}

.merc-cute-avatar__brow--left {
  transform: translateY(var(--merc-brow-y)) rotate(var(--merc-brow-left-rotate));
}

.merc-cute-avatar__brow--right {
  transform: translateY(var(--merc-brow-y)) rotate(var(--merc-brow-right-rotate));
}

.merc-cute-avatar__eye-white {
  fill: #fffdfc;
  stroke: #3d3540;
  stroke-width: 1.8;
}

.merc-cute-avatar__gaze {
  transform: translate(var(--merc-gaze-x), var(--merc-gaze-y));
  transition: transform 500ms cubic-bezier(0.2, 0, 0, 1);
}

.merc-cute-avatar__iris {
  fill: url(#merc-cute-iris);
  stroke: #4f4b5b;
  stroke-width: 1.2;
}

.merc-cute-avatar__pupil {
  fill: #252430;
}

.merc-cute-avatar__eye-glint {
  fill: #fff;
}

.merc-cute-avatar__eye-glint--small {
  opacity: 0.85;
}

.merc-cute-avatar__eye-line,
.merc-cute-avatar__lash,
.merc-cute-avatar__eyes-closed path {
  fill: none;
  stroke: #352d37;
  stroke-linecap: round;
  stroke-width: 3;
}

.merc-cute-avatar__lash {
  stroke-width: 2.5;
}

.merc-cute-avatar__eyes-closed {
  opacity: 0;
}

.merc-cute-avatar--blinking .merc-cute-avatar__eyes-open {
  opacity: 0;
}

.merc-cute-avatar--blinking .merc-cute-avatar__eyes-closed {
  opacity: 1;
}

.merc-cute-avatar__nose {
  fill: none;
  stroke: #c57f73;
  stroke-linecap: round;
  stroke-width: 1.7;
}

.merc-cute-avatar__nose-light {
  fill: #fff4eb;
  opacity: 0.78;
}

.merc-cute-avatar__cheek {
  fill: #f58f9e;
  opacity: 0.22;
}

.merc-cute-avatar__lip-line,
.merc-cute-avatar__lip-outline {
  fill: none;
  stroke: #aa5c68;
  stroke-linecap: round;
  stroke-width: 2.2;
}

.merc-cute-avatar__mouth-inside {
  fill: #63283f;
  stroke: #a74265;
  stroke-width: 2;
}

.merc-cute-avatar__teeth {
  fill: #fff9f3;
}

.merc-cute-avatar__tongue {
  fill: #ed8093;
}

@keyframes merc-cute-breathe {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.012); }
}

@keyframes merc-cute-idle {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-1.5px); }
}

@keyframes merc-cute-speaking {
  0%, 100% { transform: translateY(0) rotate(-0.5deg); }
  50% { transform: translateY(-1.5px) rotate(0.75deg); }
}

@media (prefers-reduced-motion: reduce) {
  .merc-cute-avatar__body,
  .merc-cute-avatar__head {
    animation: none;
  }

  .merc-cute-avatar__brow,
  .merc-cute-avatar__gaze,
  .merc-cute-avatar__head-pose {
    transition: none;
  }
}
</style>

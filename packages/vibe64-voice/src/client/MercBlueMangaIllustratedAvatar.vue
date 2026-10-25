<script setup>
import { useVoiceAvatar } from "@jskit-ai/assistant-voice/client";

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

const { blinking, activeExpression, idleGesture, expression, visibleMouthPose } = useVoiceAvatar(props);
</script>

<template>
  <svg
    aria-label="Illustrated blue-haired manga girl AI avatar of Merc"
    class="merc-avatar merc-avatar--blond-girl"
    :class="[
      `merc-avatar--${expression}`,
      `merc-avatar--mouth-${visibleMouthPose}`,
      idleGesture ? `merc-avatar--gesture-${idleGesture}` : '',
      activeExpression ? `merc-avatar--${expression}-${activeExpression}` : '',
      {
        'merc-avatar--blinking': blinking
      }
    ]"
    role="img"
    viewBox="0 0 320 320"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g class="merc-avatar__body">
      <path
        class="merc-avatar__shirt"
        d="M48 320c5-36 24-62 59-78 15-7 32-11 53-11s38 4 53 11c35 16 54 42 59 78H48Z"
      />

      <path
        class="merc-avatar__undershirt"
        d="M119 251c12 11 26 17 41 17s29-6 41-17l17 69H102l17-69Z"
      />

      <path
        class="merc-avatar__neck"
        d="M138 203h44v48c-7 13-37 13-44 0v-48Z"
      />

      <path
        class="merc-avatar__hood"
        d="M92 246c15-9 29-14 45-16l23 28 23-28c16 2 30 7 45 16l-16 48-35-26-17 23-17-23-35 26-16-48Z"
      />

      <path
        class="merc-avatar__hood-shadow"
        d="M103 252c13 5 26 13 40 24l17-18 17 18c14-11 27-19 40-24-9 17-18 29-28 39l-29-19-29 19c-10-10-19-22-28-39Z"
      />

      <path
        class="merc-avatar__jacket-panel"
        d="M48 320c4-29 17-52 39-69l23 39-10 30H48Zm224 0c-4-29-17-52-39-69l-23 39 10 30h52Z"
      />

      <path
        class="merc-avatar__shirt-neckline"
        d="M125 255q35 24 70 0"
      />
    </g>

    <g class="merc-avatar__head-gesture">
      <g class="merc-avatar__head">
        <path
          class="merc-avatar__hair merc-avatar__hair--back"
          d="M74 153C66 119 70 78 91 49c17-24 42-36 69-36 37 0 65 13 82 39 20 31 20 72 6 110-8 22-22 41-43 54H115c-22-14-34-34-41-63Z"
        />
        <path
          class="merc-avatar__hair merc-avatar__hair--crown-spikes"
          d="M87 82c12-33 38-55 72-62 32-6 62 1 82 19-17 2-30 7-41 16-12-7-25-10-39-9-15 1-29 7-40 16-11-3-22-2-34 0Z"
        />
        <path
          class="merc-avatar__hair merc-avatar__hair--temples"
          d="M92 116c-18 12-25 31-21 56 4 23 15 41 35 54-8-24-8-47 1-68l-15-42Zm136 0c18 12 25 31 21 56-4 23-15 41-35 54 8-24 8-47-1-68l15-42Z"
        />
        <ellipse
          class="merc-avatar__ear"
          cx="94"
          cy="151"
          rx="10"
          ry="18"
        />
        <ellipse
          class="merc-avatar__ear"
          cx="226"
          cy="151"
          rx="10"
          ry="18"
        />
        <path
          class="merc-avatar__face"
          d="M160 72c-41 0-67 24-67 67 0 45 27 82 67 85 40-3 67-40 67-85 0-43-26-67-67-67Z"
        />

        <path
          class="merc-avatar__hair merc-avatar__hair--cap"
          d="M82 118c-5-31 2-58 22-79 19-20 42-28 68-27 34 1 60 14 75 38 13 21 17 47 10 76-18-13-40-21-66-22-38-2-74 3-109 14Z"
        />
        <path
          class="merc-avatar__hair merc-avatar__hair--fringe"
          d="M88 105c15 2 29-3 41-15 8-7 15-15 21-24 2 11 7 20 15 27 8-10 17-18 28-24 1 13 5 23 12 30 10-7 19-15 27-25 5 19 5 37 0 53-14-8-29-13-45-15-23-3-43-1-61 5-15 5-28 11-39 18-7-18-10-35-9-54Z"
        />
        <path
          class="merc-avatar__hair-swoops"
          d="M91 76c22-33 56-49 99-48M103 91c29-29 65-38 107-28M117 105c28-20 61-25 97-15"
        />

        <path
          class="merc-avatar__brow merc-avatar__brow--left"
          d="M104 111c13-8 28-9 41-3"
        />
        <path
          class="merc-avatar__brow merc-avatar__brow--right"
          d="M175 108c13-6 28-5 41 3"
        />

        <g class="merc-avatar__eyes" :class="{ 'merc-avatar__eyes--closed': blinking }">
          <g class="merc-avatar__eye">
            <ellipse
              class="merc-avatar__eye-white"
              cx="126"
              cy="145"
              rx="19"
              ry="23"
            />
            <ellipse
              class="merc-avatar__iris"
              cx="127"
              cy="145"
              rx="14.5"
              ry="19.5"
            />
            <ellipse
              class="merc-avatar__pupil"
              cx="128"
              cy="145"
              rx="9.5"
              ry="14"
            />
            <circle
              class="merc-avatar__eye-light"
              cx="121"
              cy="136"
              r="5.5"
            />
            <circle
              class="merc-avatar__eye-light"
              cx="133"
              cy="154"
              r="3"
            />
            <path
              class="merc-avatar__eye-light merc-avatar__eye-star"
              d="M116 147l3 5 5 2-5 2-3 5-2-5-5-2 5-2 2-5Z"
            />
          </g>
          <g class="merc-avatar__eye">
            <ellipse
              class="merc-avatar__eye-white"
              cx="194"
              cy="145"
              rx="19"
              ry="23"
            />
            <ellipse
              class="merc-avatar__iris"
              cx="193"
              cy="145"
              rx="14.5"
              ry="19.5"
            />
            <ellipse
              class="merc-avatar__pupil"
              cx="192"
              cy="145"
              rx="9.5"
              ry="14"
            />
            <circle
              class="merc-avatar__eye-light"
              cx="187"
              cy="136"
              r="5.5"
            />
            <circle
              class="merc-avatar__eye-light"
              cx="199"
              cy="154"
              r="3"
            />
            <path
              class="merc-avatar__eye-light merc-avatar__eye-star"
              d="M181 147l3 5 5 2-5 2-3 5-2-5-5-2 5-2 2-5Z"
            />
          </g>
          <path
            class="merc-avatar__eyeliner"
            d="M106 143q20-27 40 0M174 143q20-27 40 0"
          />
          <path
            class="merc-avatar__eyelashes"
            d="M108 132l-9-5m14 0-6-9m7 5-2-10m100 19 9-5m-14 0 6-9m-7 5 2-10"
          />
        </g>

        <path
          class="merc-avatar__nose"
          d="M159 164q-2 5 2 6"
        />
        <ellipse
          class="merc-avatar__cheek"
          cx="112"
          cy="180"
          rx="18"
          ry="9"
        />
        <ellipse
          class="merc-avatar__cheek"
          cx="208"
          cy="180"
          rx="18"
          ry="9"
        />

        <g transform="translate(35 34) scale(.78)">
          <g class="merc-avatar__mouth">
            <g v-if="visibleMouthPose === 'smile'" class="merc-avatar__mouth-pose">
              <path
                class="merc-avatar__mouth-inside"
                d="M134 183q26 12 52 0c-2 25-13 36-26 36s-24-11-26-36Z"
              />
              <path
                class="merc-avatar__teeth"
                d="M139 184q21 8 42 0c-3 8-10 11-21 11s-18-3-21-11Z"
              />
              <path
                class="merc-avatar__tongue"
                d="M147 207q13-9 26 0c-4 7-8 10-13 10s-9-3-13-10Z"
              />
            </g>
            <g v-else-if="visibleMouthPose === 'wide'" class="merc-avatar__mouth-pose">
              <path class="merc-avatar__mouth-inside" d="M130 185q30-13 60 0-5 25-30 25t-30-25Z" />
              <path class="merc-avatar__teeth" d="M135 186q25-8 50 0-8 8-25 8t-25-8Z" />
            </g>
            <g v-else-if="visibleMouthPose === 'open'" class="merc-avatar__mouth-pose">
              <ellipse class="merc-avatar__mouth-inside" cx="160" cy="194" rx="19" ry="25" />
              <path class="merc-avatar__tongue" d="M145 207q15-11 30 0-5 10-15 10t-15-10Z" />
            </g>
            <g v-else-if="visibleMouthPose === 'round'" class="merc-avatar__mouth-pose">
              <ellipse class="merc-avatar__mouth-inside" cx="160" cy="193" rx="12" ry="18" />
              <ellipse class="merc-avatar__lip-light" cx="160" cy="193" rx="16" ry="22" />
            </g>
            <g v-else-if="visibleMouthPose === 'small'" class="merc-avatar__mouth-pose">
              <ellipse class="merc-avatar__mouth-inside" cx="160" cy="191" rx="19" ry="10" />
              <path class="merc-avatar__lip" d="M142 191q18 12 36 0" />
            </g>
            <path v-else-if="visibleMouthPose === 'warm-smile'" class="merc-avatar__lip" d="M140 190q20 7 40 0" />
            <path v-else-if="visibleMouthPose === 'soft-smile'" class="merc-avatar__lip" d="M141 191q19 3 38 0" />
            <path v-else-if="visibleMouthPose === 'thoughtful'" class="merc-avatar__lip" d="M142 191q17-3 36 1" />
            <path v-else class="merc-avatar__lip" d="M141 191q19 1 38 0" />
          </g>
        </g>

      </g>
    </g>
  </svg>
</template>

<style scoped>
.merc-avatar {
  display: block;
  height: 100%;
  overflow: visible;
  width: 100%;
}

.merc-avatar__shirt {
  fill: #72777c;
}

.merc-avatar--blond-girl .merc-avatar__shirt {
  fill: #f4f1e7;
  stroke: #24252b;
  stroke-linejoin: round;
  stroke-width: 4;
}

.merc-avatar__undershirt {
  fill: #d63a39;
  stroke: #24252b;
  stroke-linejoin: round;
  stroke-width: 4;
}

.merc-avatar__hood {
  fill: #c9d329;
  stroke: #24252b;
  stroke-linejoin: round;
  stroke-width: 4;
}

.merc-avatar__hood-shadow {
  fill: #aebb24;
  opacity: 0.9;
}

.merc-avatar__jacket-panel {
  fill: #f8f7f0;
  stroke: #24252b;
  stroke-linejoin: round;
  stroke-width: 4;
}

.merc-avatar__shirt-neckline {
  fill: none;
  stroke: #f7f4eb;
  stroke-linecap: round;
  stroke-width: 4;
}

.merc-avatar__neck,
.merc-avatar__ear,
.merc-avatar__face {
  fill: #e2a06f;
}

.merc-avatar--blond-girl .merc-avatar__neck,
.merc-avatar--blond-girl .merc-avatar__ear,
.merc-avatar--blond-girl .merc-avatar__face {
  stroke: #24252b;
  stroke-linejoin: round;
  stroke-width: 4;
}

.merc-avatar__neck {
  fill: #d78d60;
}

.merc-avatar__body {
  animation: merc-body-breathe 3.8s cubic-bezier(0.45, 0, 0.55, 1) infinite;
  transform-box: fill-box;
  transform-origin: 50% 100%;
}

.merc-avatar__head-gesture {
  transform-box: fill-box;
  transform-origin: 50% 88%;
}

.merc-avatar__head {
  animation: merc-head-idle 8.2s cubic-bezier(0.45, 0, 0.25, 1) infinite;
  transform-box: fill-box;
  transform-origin: 50% 88%;
}

.merc-avatar--listening .merc-avatar__head {
  animation: none;
}

.merc-avatar--pre-thinking .merc-avatar__head {
  animation: none;
}

.merc-avatar--speaking .merc-avatar__head {
  animation: merc-head-speaking 3.9s cubic-bezier(0.45, 0, 0.25, 1) infinite;
}

.merc-avatar--thinking .merc-avatar__head {
  animation: none;
}

.merc-avatar__hair {
  fill: #237fbd;
}

.merc-avatar--blond-girl .merc-avatar__hair {
  stroke: #22242b;
  stroke-linejoin: round;
  stroke-width: 4;
}

.merc-avatar__hair-lock {
  fill: none;
  opacity: 0.72;
  stroke: #4fa6d7;
  stroke-linecap: round;
  stroke-width: 5;
}

.merc-avatar__hair-swoops {
  fill: none;
  stroke: #67add6;
  stroke-linecap: round;
  stroke-width: 4;
}

.merc-avatar__brow {
  fill: none;
  stroke: #8b6528;
  stroke-linecap: round;
  stroke-width: 7;
  transform-box: fill-box;
  transform-origin: center;
  transition: transform 120ms ease-out;
}

.merc-avatar--blond-girl .merc-avatar__brow {
  stroke: #24252b;
  stroke-width: 3.5;
}

.merc-avatar--listening .merc-avatar__head-gesture,
.merc-avatar--listening .merc-avatar__brow,
.merc-avatar--listening .merc-avatar__iris,
.merc-avatar--listening .merc-avatar__pupil,
.merc-avatar--listening .merc-avatar__eye-light,
.merc-avatar--pre-thinking .merc-avatar__head-gesture,
.merc-avatar--pre-thinking .merc-avatar__brow,
.merc-avatar--pre-thinking .merc-avatar__iris,
.merc-avatar--pre-thinking .merc-avatar__pupil,
.merc-avatar--pre-thinking .merc-avatar__eye-light,
.merc-avatar--thinking .merc-avatar__head-gesture,
.merc-avatar--thinking .merc-avatar__brow,
.merc-avatar--thinking .merc-avatar__iris,
.merc-avatar--thinking .merc-avatar__pupil,
.merc-avatar--thinking .merc-avatar__eye-light {
  animation: none;
  transition: transform 480ms cubic-bezier(0.2, 0, 0, 1);
}

.merc-avatar--listening-attentive .merc-avatar__head-gesture {
  transform: translate(0, -1px) rotate(0);
}

.merc-avatar--listening-attentive .merc-avatar__brow {
  transform: translateY(-1.5px);
}

.merc-avatar--listening-tiny-nod .merc-avatar__head-gesture {
  transform: translate(0, 3px) rotate(0.5deg);
}

.merc-avatar--listening-follow-left .merc-avatar__head-gesture {
  transform: translate(-1px, 0) rotate(-1.5deg);
}

.merc-avatar--listening-follow-left .merc-avatar__iris,
.merc-avatar--listening-follow-left .merc-avatar__pupil,
.merc-avatar--listening-follow-left .merc-avatar__eye-light {
  transform: translate(-2.5px, 0);
}

.merc-avatar--listening-tilt-left .merc-avatar__head-gesture {
  transform: translate(-2px, -1px) rotate(-4deg);
}

.merc-avatar--listening-tilt-left .merc-avatar__brow--right {
  transform: translateY(-2px) rotate(3deg);
}

.merc-avatar--listening-follow-right .merc-avatar__head-gesture {
  transform: translate(1px, 0) rotate(1.5deg);
}

.merc-avatar--listening-follow-right .merc-avatar__iris,
.merc-avatar--listening-follow-right .merc-avatar__pupil,
.merc-avatar--listening-follow-right .merc-avatar__eye-light {
  transform: translate(2.5px, 0);
}

.merc-avatar--listening-tilt-right .merc-avatar__head-gesture {
  transform: translate(2px, -1px) rotate(4deg);
}

.merc-avatar--listening-tilt-right .merc-avatar__brow--left {
  transform: translateY(-2px) rotate(-3deg);
}

.merc-avatar--pre-thinking-settle .merc-avatar__head-gesture {
  transform: translate(0, 0) rotate(-0.5deg);
}

.merc-avatar--pre-thinking-glance-left .merc-avatar__head-gesture {
  transform: translate(-1px, 0) rotate(-1deg);
}

.merc-avatar--pre-thinking-glance-left .merc-avatar__iris,
.merc-avatar--pre-thinking-glance-left .merc-avatar__pupil,
.merc-avatar--pre-thinking-glance-left .merc-avatar__eye-light {
  transform: translate(-1.75px, -0.5px);
}

.merc-avatar--pre-thinking-center .merc-avatar__head-gesture {
  transform: translate(0, 1.5px) rotate(0);
}

.merc-avatar--pre-thinking-center .merc-avatar__brow {
  transform: translateY(0.75px);
}

.merc-avatar--pre-thinking-glance-right .merc-avatar__head-gesture {
  transform: translate(1px, 0) rotate(1deg);
}

.merc-avatar--pre-thinking-glance-right .merc-avatar__iris,
.merc-avatar--pre-thinking-glance-right .merc-avatar__pupil,
.merc-avatar--pre-thinking-glance-right .merc-avatar__eye-light {
  transform: translate(1.75px, -0.5px);
}

.merc-avatar--pre-thinking-tiny-tilt .merc-avatar__head-gesture {
  transform: translate(-1px, -1px) rotate(-2.5deg);
}

.merc-avatar--pre-thinking-tiny-tilt .merc-avatar__brow--right {
  transform: translateY(-1.5px) rotate(2deg);
}

.merc-avatar--pre-thinking-ready .merc-avatar__head-gesture {
  transform: translate(0, -1.5px) rotate(0.5deg);
}

.merc-avatar--pre-thinking-ready .merc-avatar__brow {
  transform: translateY(-2px);
}

.merc-avatar--thinking-look-up-left .merc-avatar__head-gesture {
  transform: translate(-2px, -1px) rotate(-5deg);
}

.merc-avatar--thinking-look-up-left .merc-avatar__iris,
.merc-avatar--thinking-look-up-left .merc-avatar__pupil,
.merc-avatar--thinking-look-up-left .merc-avatar__eye-light {
  transform: translate(-3.5px, -3px);
}

.merc-avatar--thinking-look-up-left .merc-avatar__brow--left {
  transform: translateY(-3px) rotate(-5deg);
}

.merc-avatar--thinking-look-up-left .merc-avatar__brow--right {
  transform: translateY(1px) rotate(2deg);
}

.merc-avatar--thinking-focus .merc-avatar__head-gesture {
  transform: translate(0, 2px) rotate(0);
}

.merc-avatar--thinking-focus .merc-avatar__brow--left {
  transform: translate(1px, 2px) rotate(5deg);
}

.merc-avatar--thinking-focus .merc-avatar__brow--right {
  transform: translate(-1px, 2px) rotate(-5deg);
}

.merc-avatar--thinking-look-up-right .merc-avatar__head-gesture {
  transform: translate(2px, -1px) rotate(5deg);
}

.merc-avatar--thinking-look-up-right .merc-avatar__iris,
.merc-avatar--thinking-look-up-right .merc-avatar__pupil,
.merc-avatar--thinking-look-up-right .merc-avatar__eye-light {
  transform: translate(3.5px, -3px);
}

.merc-avatar--thinking-look-up-right .merc-avatar__brow--left {
  transform: translateY(1px) rotate(-2deg);
}

.merc-avatar--thinking-look-up-right .merc-avatar__brow--right {
  transform: translateY(-3px) rotate(5deg);
}

.merc-avatar--thinking-weigh-left .merc-avatar__head-gesture {
  transform: translate(-2px, 1px) rotate(-3deg);
}

.merc-avatar--thinking-weigh-left .merc-avatar__iris,
.merc-avatar--thinking-weigh-left .merc-avatar__pupil,
.merc-avatar--thinking-weigh-left .merc-avatar__eye-light {
  transform: translate(-3px, 0.75px);
}

.merc-avatar--thinking-weigh-left .merc-avatar__brow--right {
  transform: translateY(-2px) rotate(4deg);
}

.merc-avatar--thinking-weigh-right .merc-avatar__head-gesture {
  transform: translate(2px, 1px) rotate(3deg);
}

.merc-avatar--thinking-weigh-right .merc-avatar__iris,
.merc-avatar--thinking-weigh-right .merc-avatar__pupil,
.merc-avatar--thinking-weigh-right .merc-avatar__eye-light {
  transform: translate(3px, 0.75px);
}

.merc-avatar--thinking-weigh-right .merc-avatar__brow--left {
  transform: translateY(-2px) rotate(-4deg);
}

.merc-avatar--thinking-idea .merc-avatar__head-gesture {
  transform: translate(0, -3px) rotate(-1deg);
}

.merc-avatar--thinking-idea .merc-avatar__iris,
.merc-avatar--thinking-idea .merc-avatar__pupil,
.merc-avatar--thinking-idea .merc-avatar__eye-light {
  transform: translate(0, -2px);
}

.merc-avatar--thinking-idea .merc-avatar__brow {
  transform: translateY(-4px);
}

.merc-avatar--mouth-open .merc-avatar__brow,
.merc-avatar--mouth-wide .merc-avatar__brow {
  transform: translateY(-1.5px);
}

.merc-avatar__eyes {
  transform-box: fill-box;
  transform-origin: center;
  transition: transform 70ms ease-in;
}

.merc-avatar__eyes--closed {
  transform: scaleY(0.08);
}

.merc-avatar__eye-white {
  fill: #fffaf4;
}

.merc-avatar--blond-girl .merc-avatar__eye-white {
  fill: #fffef7;
  stroke: #24252b;
  stroke-width: 2.6;
}

.merc-avatar__eyelashes,
.merc-avatar__eyeliner {
  fill: none;
  stroke: #24252b;
  stroke-linecap: round;
}

.merc-avatar__eyelashes {
  stroke-width: 3.4;
}

.merc-avatar__eyeliner {
  stroke-width: 4;
}

.merc-avatar__iris {
  fill: #2f3136;
}

.merc-avatar__pupil {
  fill: #0e0f12;
}

.merc-avatar__eye-light,
.merc-avatar__teeth {
  fill: #fffaf0;
}

.merc-avatar__eye-star {
  transform-origin: center;
}

.merc-avatar__iris,
.merc-avatar__pupil,
.merc-avatar__eye-light {
  animation: merc-gaze 8.8s ease-in-out infinite;
  transform-box: fill-box;
}

.merc-avatar__nose {
  fill: none;
  opacity: 0.5;
  stroke: #c4826e;
  stroke-linecap: round;
  stroke-width: 3;
}

.merc-avatar--blond-girl .merc-avatar__nose {
  opacity: 0.8;
  stroke: #24252b;
  stroke-width: 2.4;
}

.merc-avatar__cheek {
  fill: #ed9993;
  opacity: 0.22;
}

.merc-avatar--blond-girl .merc-avatar__cheek {
  fill: #df865e;
  opacity: 0.14;
}

.merc-avatar__mouth-inside {
  fill: #292227;
}

.merc-avatar--blond-girl .merc-avatar__mouth-inside {
  stroke: #24252b;
  stroke-linejoin: round;
  stroke-width: 2.6;
}

.merc-avatar__mouth {
  animation: merc-mouth-settle 4.9s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}

.merc-avatar--speaking .merc-avatar__mouth {
  animation: none;
}

.merc-avatar__tongue {
  fill: #e94e44;
}

.merc-avatar__lip {
  fill: none;
  stroke: #873f49;
  stroke-linecap: round;
  stroke-width: 5;
}

.merc-avatar--blond-girl .merc-avatar__lip {
  stroke: #24252b;
  stroke-width: 3.5;
}

.merc-avatar__lip-light {
  fill: none;
  stroke: #984d55;
  stroke-width: 5;
}

.merc-avatar__earring {
  fill: none;
  stroke: #d7b76e;
  stroke-width: 3;
  transform-box: fill-box;
  transform-origin: 50% 0;
}

.merc-avatar__earring-drop {
  fill: #dca4c8;
  stroke: #a77b42;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.merc-avatar--gesture-glance-left .merc-avatar__iris,
.merc-avatar--gesture-glance-left .merc-avatar__pupil,
.merc-avatar--gesture-glance-left .merc-avatar__eye-light {
  animation: merc-gesture-glance-left 1.1s ease-in-out both;
}

.merc-avatar--gesture-tiny-nod .merc-avatar__head-gesture {
  animation: merc-gesture-tiny-nod 1.1s ease-in-out both;
}

.merc-avatar--gesture-glance-right .merc-avatar__iris,
.merc-avatar--gesture-glance-right .merc-avatar__pupil,
.merc-avatar--gesture-glance-right .merc-avatar__eye-light {
  animation: merc-gesture-glance-right 1.1s ease-in-out both;
}

.merc-avatar--gesture-brow-lift .merc-avatar__brow {
  animation: merc-gesture-brow-lift 1.1s ease-in-out both;
}

.merc-avatar--gesture-glance-up .merc-avatar__iris,
.merc-avatar--gesture-glance-up .merc-avatar__pupil,
.merc-avatar--gesture-glance-up .merc-avatar__eye-light {
  animation: merc-gesture-glance-up 1.1s ease-in-out both;
}

.merc-avatar--gesture-curious-tilt .merc-avatar__head-gesture {
  animation: merc-gesture-curious-tilt 1.1s ease-in-out both;
}

.merc-avatar--gesture-smile-brighten .merc-avatar__mouth {
  animation: merc-gesture-smile-brighten 1.1s ease-in-out both;
}

.merc-avatar--gesture-friendly-lean .merc-avatar__head-gesture {
  animation: merc-gesture-friendly-lean 1.1s ease-in-out both;
}

.merc-avatar--gesture-shoulder-lift .merc-avatar__shirt {
  animation: merc-gesture-shoulder-lift 1.1s ease-in-out both;
  transform-box: fill-box;
  transform-origin: 50% 100%;
}

.merc-avatar--gesture-earring-sway .merc-avatar__earring {
  animation: merc-gesture-earring-sway 1.1s ease-in-out both;
}

@keyframes merc-head-idle {
  0%, 100% { transform: rotate(-3.2deg) translate(-3.5px, 0); }
  16% { transform: rotate(-4.3deg) translate(-4px, 2px); }
  37% { transform: rotate(1.7deg) translate(2.5px, -4px); }
  52% { transform: rotate(0.9deg) translate(2px, -5px); }
  72% { transform: rotate(4.1deg) translate(4.5px, -0.5px); }
  88% { transform: rotate(-0.7deg) translate(-0.5px, -2px); }
}

@keyframes merc-head-speaking {
  0%, 100% { transform: rotate(-3.1deg) translate(-3px, 0); }
  22% { transform: rotate(-0.4deg) translate(0, -4px); }
  46% { transform: rotate(3.1deg) translate(3.5px, -1px); }
  68% { transform: rotate(0.8deg) translate(1.5px, -4.5px); }
  84% { transform: rotate(-2deg) translate(-2px, -1.5px); }
}

@keyframes merc-body-breathe {
  0%, 100% { transform: scale(1, 1) translateY(0); }
  48% { transform: scale(1.045, 1.065) translateY(-5px); }
  62% { transform: scale(1.035, 1.05) translateY(-4px); }
}

@keyframes merc-mouth-settle {
  0%, 12%, 100% { transform: scale(1) translate(0, 0); }
  31% { transform: scale(1.035, 0.91) translate(0.5px, 1.5px); }
  48% { transform: scale(0.96, 1.04) translate(-0.75px, 0); }
  66% { transform: scale(1.025, 0.95) translate(0.5px, 1px); }
  82% { transform: scale(0.985, 1.015) translate(-0.25px, 0); }
}

@keyframes merc-gaze {
  0%, 13%, 100% { transform: translate(0, 0); }
  24%, 41% { transform: translate(1.2px, -0.35px); }
  55%, 72% { transform: translate(-1px, 0.5px); }
  84% { transform: translate(0.35px, 0); }
}

@keyframes merc-gesture-glance-left {
  0%, 16%, 84%, 100% { transform: translate(0, 0); }
  34%, 68% { transform: translate(-4px, 0.5px); }
}

@keyframes merc-gesture-tiny-nod {
  0%, 12%, 100% { transform: translate(0, 0) rotate(0); }
  34% { transform: translate(0, 3.5px) rotate(0.8deg); }
  56% { transform: translate(0, -1px) rotate(-0.3deg); }
  76% { transform: translate(0, 1.5px) rotate(0.3deg); }
}

@keyframes merc-gesture-glance-right {
  0%, 16%, 84%, 100% { transform: translate(0, 0); }
  34%, 68% { transform: translate(4px, 0.5px); }
}

@keyframes merc-gesture-brow-lift {
  0%, 14%, 86%, 100% { transform: translateY(0); }
  34%, 66% { transform: translateY(-4px); }
}

@keyframes merc-gesture-glance-up {
  0%, 16%, 84%, 100% { transform: translate(0, 0); }
  34%, 68% { transform: translate(0, -3.5px); }
}

@keyframes merc-gesture-curious-tilt {
  0%, 14%, 88%, 100% { transform: translate(0, 0) rotate(0); }
  38%, 68% { transform: translate(-2px, -1px) rotate(-5.5deg); }
}

@keyframes merc-gesture-smile-brighten {
  0%, 12%, 88%, 100% { transform: translate(0, 0) scale(1); }
  36%, 66% { transform: translate(0, -1px) scale(1.08, 1.05); }
}

@keyframes merc-gesture-friendly-lean {
  0%, 14%, 88%, 100% { transform: translate(0, 0) rotate(0); }
  38%, 68% { transform: translate(3px, -1px) rotate(4.5deg); }
}

@keyframes merc-gesture-shoulder-lift {
  0%, 12%, 88%, 100% { transform: translate(0, 0) scale(1); }
  38%, 64% { transform: translate(0, -3px) scale(1.035, 1.045); }
}

@keyframes merc-gesture-earring-sway {
  0%, 12%, 100% { transform: translate(0, 0) rotate(0); }
  32% { transform: translate(-1px, 1px) rotate(-14deg); }
  56% { transform: translate(1px, 1px) rotate(12deg); }
  78% { transform: translate(-0.5px, 0.5px) rotate(-5deg); }
}

@media (prefers-reduced-motion: reduce) {
  .merc-avatar__head-gesture,
  .merc-avatar__head,
  .merc-avatar__body,
  .merc-avatar__shirt,
  .merc-avatar__mouth,
  .merc-avatar__brow,
  .merc-avatar__earring,
  .merc-avatar__iris,
  .merc-avatar__pupil,
  .merc-avatar__eye-light,
  .merc-avatar--listening .merc-avatar__head,
  .merc-avatar--speaking .merc-avatar__head,
  .merc-avatar--pre-thinking .merc-avatar__head,
  .merc-avatar--thinking .merc-avatar__head {
    animation: none;
  }

  .merc-avatar__eyes {
    transition: none;
  }

  .merc-avatar__brow,
  .merc-avatar--listening .merc-avatar__head-gesture,
  .merc-avatar--listening .merc-avatar__iris,
  .merc-avatar--listening .merc-avatar__pupil,
  .merc-avatar--listening .merc-avatar__eye-light,
  .merc-avatar--pre-thinking .merc-avatar__head-gesture,
  .merc-avatar--pre-thinking .merc-avatar__iris,
  .merc-avatar--pre-thinking .merc-avatar__pupil,
  .merc-avatar--pre-thinking .merc-avatar__eye-light,
  .merc-avatar--thinking .merc-avatar__head-gesture,
  .merc-avatar--thinking .merc-avatar__iris,
  .merc-avatar--thinking .merc-avatar__pupil,
  .merc-avatar--thinking .merc-avatar__eye-light {
    transition: none;
  }
}
</style>

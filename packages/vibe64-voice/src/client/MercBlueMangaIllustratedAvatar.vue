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
  },
  still: {
    default: false,
    type: Boolean
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
        'merc-avatar--blinking': blinking,
        'merc-avatar--still': still
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

<style scoped src="./mercAvatarMotion.css"></style>

<style scoped>
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
}

.merc-avatar--blond-girl .merc-avatar__brow {
  stroke: #24252b;
  stroke-width: 3.5;
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
}

.merc-avatar__earring-drop {
  fill: #dca4c8;
  stroke: #a77b42;
  stroke-linejoin: round;
  stroke-width: 1.5;
}
</style>

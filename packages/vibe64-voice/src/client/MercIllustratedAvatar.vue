<script setup>
import { computed } from "vue";
import { useVoiceAvatar } from "@jskit-ai/assistant-voice/client";

const props = defineProps({
  appearance: {
    default: "original",
    type: String
  },
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

const girlVariant = computed(() => props.appearance === "blond-girl");
const { blinking, activeExpression, idleGesture, expression, visibleMouthPose } = useVoiceAvatar(props);
</script>

<template>
  <svg
    :aria-label="girlVariant
      ? 'Illustrated blond girl AI avatar of Merc'
      : 'Illustrated AI avatar of Merc'"
    class="merc-avatar"
    :class="[
      `merc-avatar--${expression}`,
      `merc-avatar--mouth-${visibleMouthPose}`,
      idleGesture ? `merc-avatar--gesture-${idleGesture}` : '',
      activeExpression ? `merc-avatar--${expression}-${activeExpression}` : '',
      {
        'merc-avatar--blinking': blinking,
        'merc-avatar--blond-girl': girlVariant
      }
    ]"
    role="img"
    viewBox="0 0 320 320"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g class="merc-avatar__body">
      <path
        class="merc-avatar__shirt"
        :d="girlVariant
          ? 'M62 320c7-44 31-71 74-89h48c43 18 67 45 74 89H62Z'
          : 'M52 320c4-50 28-78 75-91h66c47 13 71 41 75 91H52Z'"
      />
      <path
        class="merc-avatar__neck"
        :d="girlVariant
          ? 'M137 204h46v45c-6 13-40 13-46 0v-45Z'
          : 'M130 205h60v50c-8 15-52 15-60 0v-50Z'"
      />
      <path
        v-if="girlVariant"
        class="merc-avatar__blouse-neckline"
        d="M121 244l39 37 39-37"
      />
      <path
        v-if="girlVariant"
        class="merc-avatar__blouse-bow"
        d="M160 281c-12-9-24-9-24 1 0 9 12 12 24 5 12 7 24 4 24-5 0-10-12-10-24-1Z"
      />
    </g>

    <g class="merc-avatar__head-gesture">
      <g class="merc-avatar__head">
        <path
          class="merc-avatar__hair merc-avatar__hair--back"
          :d="girlVariant
            ? 'M96 121c-1-30 6-57 23-79 17-22 40-35 69-41-22 23-31 45-27 66 19-28 44-48 77-60-24 26-33 52-27 76 17-20 34-33 52-40-9 28-4 52 12 73-24-7-41-6-53 0-15-25-37-38-63-38-27 0-49 16-63 43Z'
            : 'M86 145c-11-35-4-68 18-90l-8-20 26 11 7-26 20 20 12-26 13 27 24-19 1 27 29-13-10 26h28l-21 20 25 12-23 10c5 12 7 25 5 39l-14-19c-5-43-28-68-59-69-34-2-58 24-62 69l-11 18Z'"
        />
        <path
          v-if="girlVariant"
          class="merc-avatar__hair merc-avatar__hair--crown-spikes"
          d="M100 88C93 63 99 36 118 14c-3 22 4 36 17 46 1-25 12-45 30-59-7 24-2 42 11 55 12-27 32-46 57-54-19 21-25 41-19 60 16-19 35-32 56-36-18 19-24 37-21 56Z"
        />
        <path
          v-if="girlVariant"
          class="merc-avatar__hair merc-avatar__hair--temples"
          d="M99 111C83 105 69 91 61 70c1 21 5 39 16 53l-23-10c7 24 20 41 38 53-3-22-1-40 7-55Zm122-2c18-5 33-19 43-39-2 22-6 38-16 53l28-12c-7 25-21 42-43 55 2-23-2-42-12-57Z"
        />
        <ellipse
          class="merc-avatar__ear"
          :cx="girlVariant ? 95 : 91"
          :cy="girlVariant ? 147 : 148"
          :rx="girlVariant ? 11.5 : 16"
          :ry="girlVariant ? 20 : 27"
        />
        <ellipse
          class="merc-avatar__ear"
          :cx="girlVariant ? 225 : 229"
          :cy="girlVariant ? 147 : 148"
          :rx="girlVariant ? 11.5 : 16"
          :ry="girlVariant ? 20 : 27"
        />
        <path
          v-if="girlVariant"
          class="merc-avatar__face"
          d="M160 42c-45 0-70 35-70 84 0 52 29 91 70 91s70-39 70-91c0-49-25-84-70-84Z"
        />
        <path
          v-else
          class="merc-avatar__face"
          d="M160 48c-44 0-70 31-70 84 0 61 29 102 70 102s70-41 70-102c0-53-26-84-70-84Z"
        />

        <path
          v-if="girlVariant"
          class="merc-avatar__hair merc-avatar__hair--cap"
          d="M94 108c4-39 28-64 66-67 38-3 63 21 67 60-21-10-43-14-66-13-27 1-50 7-67 20Z"
        />
        <path
          class="merc-avatar__hair merc-avatar__hair--fringe"
          :d="girlVariant
            ? 'M96 108c5-37 29-65 69-79-19 18-28 38-23 57 21-27 46-44 78-49-23 15-36 33-37 49 22-9 42-8 62 1-21 11-43 17-69 17-33 0-57-1-80 4Z'
            : 'M91 115c5-38 29-61 66-65 35-3 61 15 72 50l-19-12-3 20-17-24-6 22-20-27-9 25-16-25-15 24-15-16-11 23-7 5Z'"
        />
        <path
          v-if="!girlVariant"
          class="merc-avatar__hair-lock"
          d="M108 72c9-12 20-20 33-24M145 43l-2 29M176 42l5 31M204 54c9 8 15 19 18 31"
        />
        <path
          v-if="girlVariant"
          class="merc-avatar__hair-swoops"
          d="M110 86c16-31 48-52 89-63M116 99c27-31 63-43 105-40M132 108c26-20 61-27 97-21"
        />

        <path
          class="merc-avatar__brow merc-avatar__brow--left"
          :d="girlVariant ? 'M105 113c13-10 30-11 44-2' : 'M113 113c11-8 24-8 34-1'"
        />
        <path
          class="merc-avatar__brow merc-avatar__brow--right"
          :d="girlVariant ? 'M171 111c14-9 31-8 44 2' : 'M173 112c11-7 24-7 34 1'"
        />

        <g class="merc-avatar__eyes" :class="{ 'merc-avatar__eyes--closed': blinking }">
          <g class="merc-avatar__eye">
            <ellipse
              class="merc-avatar__eye-white"
              :cx="girlVariant ? 127.5 : 130"
              :cy="girlVariant ? 138 : 132"
              :rx="girlVariant ? 23.5 : 18"
              :ry="girlVariant ? 16.5 : 11"
            />
            <circle
              class="merc-avatar__iris"
              :cx="girlVariant ? 130 : 132"
              :cy="girlVariant ? 138 : 132"
              :r="girlVariant ? 12.5 : 7.5"
            />
            <circle
              class="merc-avatar__pupil"
              :cx="girlVariant ? 131 : 133"
              :cy="girlVariant ? 138 : 132"
              :r="girlVariant ? 5.8 : 3.6"
            />
            <circle
              class="merc-avatar__eye-light"
              cx="135"
              :cy="girlVariant ? 132 : 128"
              :r="girlVariant ? 3.2 : 1.8"
            />
            <circle
              v-if="girlVariant"
              class="merc-avatar__eye-light"
              cx="125"
              cy="143"
              r="1.5"
            />
          </g>
          <g class="merc-avatar__eye">
            <ellipse
              class="merc-avatar__eye-white"
              :cx="girlVariant ? 192.5 : 190"
              :cy="girlVariant ? 138 : 132"
              :rx="girlVariant ? 23.5 : 18"
              :ry="girlVariant ? 16.5 : 11"
            />
            <circle
              class="merc-avatar__iris"
              :cx="girlVariant ? 190 : 188"
              :cy="girlVariant ? 138 : 132"
              :r="girlVariant ? 12.5 : 7.5"
            />
            <circle
              class="merc-avatar__pupil"
              :cx="girlVariant ? 189 : 187"
              :cy="girlVariant ? 138 : 132"
              :r="girlVariant ? 5.8 : 3.6"
            />
            <circle
              class="merc-avatar__eye-light"
              :cx="girlVariant ? 194 : 190"
              :cy="girlVariant ? 132 : 128"
              :r="girlVariant ? 3.2 : 1.8"
            />
            <circle
              v-if="girlVariant"
              class="merc-avatar__eye-light"
              cx="184"
              cy="143"
              r="1.5"
            />
          </g>
          <path
            v-if="girlVariant"
            class="merc-avatar__eyeliner"
            d="M104 137q24-22 48 0M168 137q24-22 48 0"
          />
          <path
            v-if="girlVariant"
            class="merc-avatar__eyelashes"
            d="M106 130l-8-5m12 1-5-8m109 12 8-5m-12 1 5-8"
          />
        </g>

        <path
          class="merc-avatar__nose"
          :d="girlVariant
            ? 'M160 154q-2 6 2 7'
            : 'M158 132c-1 15-6 27-3 31 4 4 10 4 14 0'"
        />
        <ellipse
          class="merc-avatar__cheek"
          :cx="girlVariant ? 111 : 116"
          :cy="girlVariant ? 171 : 166"
          :rx="girlVariant ? 22 : 17"
          ry="9"
        />
        <ellipse
          class="merc-avatar__cheek"
          :cx="girlVariant ? 209 : 204"
          :cy="girlVariant ? 171 : 166"
          :rx="girlVariant ? 22 : 17"
          ry="9"
        />

        <g :transform="girlVariant ? 'translate(35 34) scale(.78)' : undefined">
          <g class="merc-avatar__mouth">
            <g v-if="visibleMouthPose === 'smile'" class="merc-avatar__mouth-pose">
              <path class="merc-avatar__mouth-inside" d="M132 183q28 24 56 0c-4 20-16 29-28 29s-24-9-28-29Z" />
              <path class="merc-avatar__teeth" d="M137 185q23 14 46 0c-4 9-13 13-23 13s-19-4-23-13Z" />
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

        <circle
          class="merc-avatar__earring"
          :cx="girlVariant ? 88 : 84"
          :cy="girlVariant ? 163 : 165"
          r="5"
        />
        <circle v-if="girlVariant" class="merc-avatar__earring" cx="232" cy="163" r="5" />
        <path
          v-if="girlVariant"
          class="merc-avatar__earring-drop"
          d="M88 168l-5 8 5 5 5-5-5-8Zm144 0-5 8 5 5 5-5-5-8Z"
        />
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
  fill: #725f88;
}

.merc-avatar__blouse-neckline {
  fill: none;
  stroke: #e8c9dd;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 5;
}

.merc-avatar__blouse-bow {
  fill: #dca4c8;
  stroke: #5e466f;
  stroke-linejoin: round;
  stroke-width: 2;
}

.merc-avatar__neck,
.merc-avatar__ear,
.merc-avatar__face {
  fill: #f1c7a3;
}

.merc-avatar__neck {
  fill: #e6b18d;
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
  fill: #d2a13a;
}

.merc-avatar__hair--fringe {
  fill: #e2b84e;
}

.merc-avatar__hair-lock {
  fill: none;
  opacity: 0.72;
  stroke: #f5d978;
  stroke-linecap: round;
  stroke-width: 5;
}

.merc-avatar__hair-swoops {
  fill: none;
  stroke: #f6ce63;
  stroke-linecap: round;
  stroke-width: 5;
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
  stroke-width: 4.5;
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

.merc-avatar__eyelashes,
.merc-avatar__eyeliner {
  fill: none;
  stroke: #765021;
  stroke-linecap: round;
}

.merc-avatar__eyelashes {
  stroke-width: 2.6;
}

.merc-avatar__eyeliner {
  stroke-width: 2.3;
}

.merc-avatar__iris {
  fill: #5c3829;
}

.merc-avatar__pupil {
  fill: #241815;
}

.merc-avatar__eye-light,
.merc-avatar__teeth {
  fill: #fffaf0;
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
  opacity: 0.4;
  stroke-width: 2;
}

.merc-avatar__cheek {
  fill: #ed9993;
  opacity: 0.22;
}

.merc-avatar--blond-girl .merc-avatar__cheek {
  opacity: 0.32;
}

.merc-avatar__mouth-inside {
  fill: #592d35;
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
  fill: #c96870;
}

.merc-avatar__lip {
  fill: none;
  stroke: #873f49;
  stroke-linecap: round;
  stroke-width: 5;
}

.merc-avatar--blond-girl .merc-avatar__lip {
  stroke: #a63f61;
  stroke-width: 4.2;
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

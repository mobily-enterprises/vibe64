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
    aria-label="Illustrated AI avatar of Merc"
    class="merc-avatar"
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
        d="M52 320c4-50 28-78 75-91h66c47 13 71 41 75 91H52Z"
      />
      <path
        class="merc-avatar__neck"
        d="M130 205h60v50c-8 15-52 15-60 0v-50Z"
      />
    </g>

    <g class="merc-avatar__head-gesture">
      <g class="merc-avatar__head">
        <path
          class="merc-avatar__hair merc-avatar__hair--back"
          d="M86 145c-11-35-4-68 18-90l-8-20 26 11 7-26 20 20 12-26 13 27 24-19 1 27 29-13-10 26h28l-21 20 25 12-23 10c5 12 7 25 5 39l-14-19c-5-43-28-68-59-69-34-2-58 24-62 69l-11 18Z"
        />
        <ellipse
          class="merc-avatar__ear"
          cx="91"
          cy="148"
          rx="16"
          ry="27"
        />
        <ellipse
          class="merc-avatar__ear"
          cx="229"
          cy="148"
          rx="16"
          ry="27"
        />
        <path
          class="merc-avatar__face"
          d="M160 48c-44 0-70 31-70 84 0 61 29 102 70 102s70-41 70-102c0-53-26-84-70-84Z"
        />

        <path
          class="merc-avatar__hair merc-avatar__hair--fringe"
          d="M91 115c5-38 29-61 66-65 35-3 61 15 72 50l-19-12-3 20-17-24-6 22-20-27-9 25-16-25-15 24-15-16-11 23-7 5Z"
        />
        <path
          class="merc-avatar__hair-lock"
          d="M108 72c9-12 20-20 33-24M145 43l-2 29M176 42l5 31M204 54c9 8 15 19 18 31"
        />

        <path
          class="merc-avatar__brow merc-avatar__brow--left"
          d="M113 113c11-8 24-8 34-1"
        />
        <path
          class="merc-avatar__brow merc-avatar__brow--right"
          d="M173 112c11-7 24-7 34 1"
        />

        <g class="merc-avatar__eyes" :class="{ 'merc-avatar__eyes--closed': blinking }">
          <g class="merc-avatar__eye">
            <ellipse
              class="merc-avatar__eye-white"
              cx="130"
              cy="132"
              rx="18"
              ry="11"
            />
            <circle
              class="merc-avatar__iris"
              cx="132"
              cy="132"
              r="7.5"
            />
            <circle
              class="merc-avatar__pupil"
              cx="133"
              cy="132"
              r="3.6"
            />
            <circle
              class="merc-avatar__eye-light"
              cx="135"
              cy="128"
              r="1.8"
            />
          </g>
          <g class="merc-avatar__eye">
            <ellipse
              class="merc-avatar__eye-white"
              cx="190"
              cy="132"
              rx="18"
              ry="11"
            />
            <circle
              class="merc-avatar__iris"
              cx="188"
              cy="132"
              r="7.5"
            />
            <circle
              class="merc-avatar__pupil"
              cx="187"
              cy="132"
              r="3.6"
            />
            <circle
              class="merc-avatar__eye-light"
              cx="190"
              cy="128"
              r="1.8"
            />
          </g>
        </g>

        <path
          class="merc-avatar__nose"
          d="M158 132c-1 15-6 27-3 31 4 4 10 4 14 0"
        />
        <ellipse
          class="merc-avatar__cheek"
          cx="116"
          cy="166"
          rx="17"
          ry="9"
        />
        <ellipse
          class="merc-avatar__cheek"
          cx="204"
          cy="166"
          rx="17"
          ry="9"
        />

        <g>
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
          cx="84"
          cy="165"
          r="5"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped src="./mercAvatarMotion.css"></style>

<style scoped>
.merc-avatar__shirt {
  fill: #72777c;
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

.merc-avatar__nose {
  fill: none;
  opacity: 0.5;
  stroke: #c4826e;
  stroke-linecap: round;
  stroke-width: 3;
}

.merc-avatar__cheek {
  fill: #ed9993;
  opacity: 0.22;
}

.merc-avatar__mouth-inside {
  fill: #592d35;
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

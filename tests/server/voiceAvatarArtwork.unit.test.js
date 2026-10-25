import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const AVATAR_MOTION_URL = new URL(import.meta.resolve("@jskit-ai/assistant-voice/client").replace(/index\.js$/, "voiceAvatar.js"));
const MERC_AVATAR_URL = new URL(
  "../../packages/vibe64-voice/src/client/MercAvatar.vue",
  import.meta.url
);
const MERC_ILLUSTRATED_AVATAR_URL = new URL(
  "../../packages/vibe64-voice/src/client/MercIllustratedAvatar.vue",
  import.meta.url
);
const MERC_BLUE_MANGA_ILLUSTRATED_AVATAR_URL = new URL(
  "../../packages/vibe64-voice/src/client/MercBlueMangaIllustratedAvatar.vue",
  import.meta.url
);

function assertAvatarExpressionCycle(avatar, constantName, state) {
  const expressionList = avatar.match(new RegExp(
    `const ${constantName} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`,
    "u"
  ));
  assert.ok(expressionList);
  const expressions = [...expressionList[1].matchAll(/"([a-z-]+)"/gu)]
    .map((match) => match[1]);

  assert.equal(expressions.length, 6);
  assert.equal(new Set(expressions).size, 6);
  for (const expression of expressions) {
    assert.match(avatar, new RegExp(`\\.merc-avatar--${state}-${expression}\\b`, "u"));
  }
}

test("the Colleague avatar chooses between the Merc and Yu artworks", async () => {
  const [canonicalAvatar, blueMangaIllustration, originalAvatar] = await Promise.all([
    readFile(MERC_AVATAR_URL, "utf8"),
    readFile(MERC_BLUE_MANGA_ILLUSTRATED_AVATAR_URL, "utf8"),
    readFile(MERC_ILLUSTRATED_AVATAR_URL, "utf8")
  ]);

  const colleague = await readFile(new URL("../../src/components/Vibe64LocalColleagueHost.vue", import.meta.url), "utf8");
  const voiceExports = await readFile(new URL("../../packages/vibe64-voice/src/client/index.js", import.meta.url), "utf8");
  assert.match(colleague, /<Vibe64ColleagueAvatar/u);
  assert.match(voiceExports, /Vibe64ColleagueAvatar.*MercAvatar/u);
  assert.match(canonicalAvatar, /import MercBlueMangaIllustratedAvatar from "\.\/MercBlueMangaIllustratedAvatar\.vue";/u);
  assert.match(canonicalAvatar, /import MercIllustratedAvatar from "\.\/MercIllustratedAvatar\.vue";/u);
  assert.match(canonicalAvatar, /<MercIllustratedAvatar\s+v-if="avatar === 'merc'"[\s\S]*?<MercBlueMangaIllustratedAvatar\s+v-else/u);
  assert.match(canonicalAvatar, /:mouth-level="mouthLevel"[\s\S]*?:mouth-pose="mouthPose"[\s\S]*?:state="state"[\s\S]*?:mouth-level="mouthLevel"[\s\S]*?:mouth-pose="mouthPose"[\s\S]*?:state="state"/u);
  for (const artwork of [canonicalAvatar, blueMangaIllustration, originalAvatar]) assert.doesNotMatch(artwork, /appearance|girlVariant/u);
  assert.match(blueMangaIllustration, /Illustrated blue-haired manga girl AI avatar of Merc/u);
  assert.match(blueMangaIllustration, /class="merc-avatar merc-avatar--blond-girl"/u);
  assert.match(blueMangaIllustration, /class="merc-avatar__hair merc-avatar__hair--crown-spikes"/u);
  assert.match(blueMangaIllustration, /class="merc-avatar__eye-light merc-avatar__eye-star"/u);
  assert.match(blueMangaIllustration, /class="merc-avatar__hood"/u);
  assert.match(blueMangaIllustration, /prefers-reduced-motion: reduce/u);
  assert.match(originalAvatar, /aria-label="Illustrated AI avatar of Merc"/u);
  assert.match(originalAvatar, /class="merc-avatar"/u);
  assert.match(originalAvatar, /class="merc-avatar__hair merc-avatar__hair--back"/u);
  assert.match(originalAvatar, /class="merc-avatar__hair merc-avatar__hair--fringe"/u);
  assert.match(originalAvatar, /class="merc-avatar__hair-lock"/u);
  assert.doesNotMatch(originalAvatar, /merc-avatar__hair--girl-(?:back|sides)|merc-avatar--blond-girl/u);
});

test("the fifth avatar rests in a slight smile with lighter skin, uniform blue hair, and smaller dark oval eyes", async () => {
  const avatar = await readFile(MERC_BLUE_MANGA_ILLUSTRATED_AVATAR_URL, "utf8") + await readFile(AVATAR_MOTION_URL, "utf8");

  assert.match(avatar, /return IDLE_MOUTH_POSES\[idleGesture\.value\] \|\| "soft-smile";/u);
  assert.match(avatar, /"tiny-nod": "warm-smile"[\s\S]*?"curious-tilt": "warm-smile"/u);
  assert.match(avatar, /"smile-brighten": "smile"/u);
  assert.match(avatar, /class="merc-avatar__eye-white"[\s\S]*?rx="19"\s+ry="23"/u);
  assert.match(avatar, /class="merc-avatar__iris"[\s\S]*?rx="14\.5"\s+ry="19\.5"/u);
  assert.match(avatar, /class="merc-avatar__pupil"[\s\S]*?rx="9\.5"\s+ry="14"/u);
  assert.match(avatar, /\.merc-avatar__face \{\s*fill: #e2a06f;/u);
  assert.match(avatar, /\.merc-avatar__hair \{\s*fill: #237fbd;/u);
  assert.match(avatar, /class="merc-avatar__hair merc-avatar__hair--crown-spikes"/u);
  assert.match(avatar, /class="merc-avatar__hair merc-avatar__hair--temples"/u);
  assert.match(avatar, /class="merc-avatar__hair merc-avatar__hair--fringe"/u);
  assert.doesNotMatch(avatar, /\.merc-avatar--blond-girl \.merc-avatar__hair--(?:crown-spikes|temples) \{/u);
  assert.doesNotMatch(avatar, /\.merc-avatar__hair--fringe \{/u);
});

test("Merc cycles ten distinct idle gestures without competing with active voice states", async () => {
  const avatar = await readFile(MERC_BLUE_MANGA_ILLUSTRATED_AVATAR_URL, "utf8") + await readFile(AVATAR_MOTION_URL, "utf8");
  const gestureList = avatar.match(/const IDLE_GESTURES = Object\.freeze\(\[([\s\S]*?)\]\);/u);
  assert.ok(gestureList);
  const gestures = [...gestureList[1].matchAll(/"([a-z-]+)"/gu)].map((match) => match[1]);

  assert.equal(gestures.length, 10);
  assert.equal(new Set(gestures).size, 10);
  for (const gesture of gestures) {
    assert.match(avatar, new RegExp(`\\.merc-avatar--gesture-${gesture}\\b`, "u"));
    assert.match(avatar, new RegExp(`@keyframes merc-gesture-${gesture}\\b`, "u"));
  }
  assert.match(avatar, /expression\.value !== "idle"/u);
  assert.match(avatar, /prefers-reduced-motion: reduce/u);
  assert.match(avatar, /class="merc-avatar__head-gesture"[\s\S]*class="merc-avatar__head"/u);
});

test("Merc keeps soft and warm idle smiles with a rare big smile while preserving speech poses", async () => {
  const avatar = await readFile(MERC_BLUE_MANGA_ILLUSTRATED_AVATAR_URL, "utf8") + await readFile(AVATAR_MOTION_URL, "utf8");
  const mouthPoseList = avatar.match(/const IDLE_MOUTH_POSES = Object\.freeze\(\{([\s\S]*?)\}\);/u);
  assert.ok(mouthPoseList);
  const idleMouthPoses = Object.fromEntries(
    [...mouthPoseList[1].matchAll(/"([a-z-]+)": "([a-z-]+)"/gu)]
      .map((match) => [match[1], match[2]])
  );

  assert.deepEqual(idleMouthPoses, {
    "curious-tilt": "warm-smile",
    "friendly-lean": "warm-smile",
    "smile-brighten": "smile",
    "tiny-nod": "warm-smile"
  });
  assert.doesNotMatch(mouthPoseList[1], /round/u);
  assert.match(avatar, /<path v-else-if="visibleMouthPose === 'warm-smile'" class="merc-avatar__lip" d="M140 190q20 7 40 0" \/>/u);
  assert.match(avatar, /<path v-else-if="visibleMouthPose === 'soft-smile'" class="merc-avatar__lip" d="M141 191q19 3 38 0" \/>/u);
  assert.match(avatar, /return IDLE_MOUTH_POSES\[idleGesture\.value\] \|\| "soft-smile";/u);
  assert.match(avatar, /expression\.value === "thinking"[\s\S]*?THINKING_MOUTH_POSES\[activeExpression\.value\] \|\| "thoughtful"/u);
  assert.match(avatar, /<path v-else-if="visibleMouthPose === 'thoughtful'"/u);
  assert.match(avatar, /const pose = String\(props\.mouthPose \|\| "closed"\);/u);
});

test("Merc cycles a distinct series of thoughtful expressions while an assistant turn is active", async () => {
  const avatar = await readFile(MERC_BLUE_MANGA_ILLUSTRATED_AVATAR_URL, "utf8") + await readFile(AVATAR_MOTION_URL, "utf8");
  assertAvatarExpressionCycle(avatar, "THINKING_EXPRESSIONS", "thinking");
  assert.match(avatar, /activeExpressionIndexes\[state\] = \(index \+ 1\) % sequence\.length/u);
  assert.match(avatar, /ACTIVE_EXPRESSION_DURATION_MS\[state\]/u);
});

test("Merc gives recording, message delivery, and active thinking their own varied faces", async () => {
  const avatar = await readFile(MERC_BLUE_MANGA_ILLUSTRATED_AVATAR_URL, "utf8") + await readFile(AVATAR_MOTION_URL, "utf8");
  for (const [constantName, state] of [
    ["LISTENING_EXPRESSIONS", "listening"],
    ["PRE_THINKING_EXPRESSIONS", "pre-thinking"],
    ["THINKING_EXPRESSIONS", "thinking"]
  ]) {
    assertAvatarExpressionCycle(avatar, constantName, state);
  }
  assert.match(avatar, /"pre-thinking": Math\.floor\(Math\.random\(\) \* PRE_THINKING_EXPRESSIONS\.length\)/u);
  assert.match(avatar, /prefers-reduced-motion: reduce/u);
});

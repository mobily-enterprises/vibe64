import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { transform } from "esbuild";
import { renderToString } from "@vue/server-renderer";
import * as avatarCatalogue from "../../packages/vibe64-voice/src/shared/avatars.js";

const STORAGE_KEY = "vibe64:assistant-avatars";

async function loadModule(relativePath, imports, { sfc = false } = {}) {
  const filename = new URL(relativePath, import.meta.url);
  let source = await readFile(filename, "utf8");
  if (sfc) {
    const { descriptor } = parse(source, { filename: String(filename) });
    source = compileScript(descriptor, { id: "local-avatar", inlineTemplate: true }).content;
  }
  const { code } = await transform(source, { format: "cjs" });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(imports, name), name);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), values };
}

async function loadPreferences(t, initial) {
  const storage = memoryStorage(initial);
  const previous = globalThis.window;
  globalThis.window = { localStorage: storage };
  t.after(() => { globalThis.window = previous; });
  const browserStorage = await loadModule("../../src/lib/browserLocalStorage.js", {});
  const preferences = await loadModule("../../src/composables/useVibe64LocalAvatarPreferences.js", {
    vue, "@local/vibe64-voice/shared/avatars": avatarCatalogue, "@/lib/browserLocalStorage.js": browserStorage
  });
  return { storage, preferences };
}

test("standalone Vibe64 shows the same per-assistant default artwork as a new hosted person", async t => {
  const { preferences } = await loadPreferences(t);
  assert.deepEqual(avatarCatalogue.VIBE64_AVATAR_CHOICES.map(choice => [choice.id, choice.label]),
    [["merc", "Merc · male"], ["yu", "Yu · female"]]);
  const { avatars } = preferences.useVibe64LocalAvatarPreferences();
  assert.deepEqual(avatars.value, { colleague: "merc", coding: "yu" });
  assert.equal(preferences.VIBE64_LOCAL_AVATAR_STORAGE_KEY, STORAGE_KEY);
});

test("the browser-local avatar choice is remembered per assistant target and rejects unknown artwork", async t => {
  const { storage, preferences } = await loadPreferences(t, { [STORAGE_KEY]: JSON.stringify({ colleague: "yu", coding: "robot" }) });
  const first = preferences.useVibe64LocalAvatarPreferences();
  assert.deepEqual(first.avatars.value, { colleague: "yu", coding: "yu" }, "an unknown saved value uses the target default");
  const second = preferences.useVibe64LocalAvatarPreferences();
  assert.equal(second.avatars, first.avatars, "every mounted consumer shares one browser choice");
  first.setAvatar("coding", "merc");
  assert.deepEqual(second.avatars.value, { colleague: "yu", coding: "merc" });
  assert.deepEqual(JSON.parse(storage.values.get(STORAGE_KEY)), { colleague: "yu", coding: "merc" });
  first.setAvatar("coding", "robot");
  first.setAvatar("database", "merc");
  assert.deepEqual(JSON.parse(storage.values.get(STORAGE_KEY)), { colleague: "yu", coding: "merc" });
});

test("the standalone voice host supplies the chosen artwork, mouth animation and chooser to each assistant", async t => {
  const { preferences } = await loadPreferences(t, { [STORAGE_KEY]: JSON.stringify({ colleague: "yu" }) });
  const hostProps = [];
  const avatars = [];
  const settings = [];
  const Vibe64VoiceHost = { props: ["preferences"], setup(props, { slots }) {
    hostProps.push(props);
    return () => [
      slots.avatar({ mouthLevel: 0.4, mouthPose: "open", state: "speaking", binding: { preferenceTarget: "colleague" } }),
      slots.avatar({ mouthLevel: 0, mouthPose: "closed", state: "idle", binding: { preferenceTarget: "coding" } }),
      slots.settings({ voice: null, binding: { preferenceTarget: "coding" } }),
      slots.default()
    ];
  } };
  const Vibe64ColleagueAvatar = { props: ["avatar", "mouthLevel", "mouthPose", "state"], setup(props) { avatars.push({ ...props }); return () => null; } };
  const Vibe64LocalVoiceSettings = { props: ["binding", "voice"], setup(props) { settings.push({ ...props }); return () => null; } };
  const host = await loadModule("../../src/components/Vibe64LocalVoiceHost.vue", {
    vue, "@local/vibe64-voice/client": { Vibe64ColleagueAvatar, Vibe64VoiceHost },
    "./Vibe64LocalVoiceSettings.vue": Vibe64LocalVoiceSettings,
    "@/composables/useVibe64LocalAvatarPreferences.js": preferences
  }, { sfc: true });
  let children = 0;
  await renderToString(vue.createSSRApp({ render: () => vue.h(host.default, null, { default: () => { children += 1; return null; } }) }));
  assert.deepEqual(hostProps[0].preferences, { colleague: { avatar: "yu" }, coding: { avatar: "yu" } });
  assert.deepEqual(avatars, [
    { avatar: "yu", mouthLevel: 0.4, mouthPose: "open", state: "speaking" },
    { avatar: "yu", mouthLevel: 0, mouthPose: "closed", state: "idle" }
  ]);
  assert.deepEqual(settings, [{ binding: { preferenceTarget: "coding" }, voice: null }]);
  assert.equal(children, 1, "the application content stays inside the one voice host");
});

test("the chooser and both standalone consumers use the shared artwork rather than the generic robot", async () => {
  const read = path => readFile(new URL(path, import.meta.url), "utf8");
  const [chooser, settings, app, colleague] = await Promise.all([
    read("../../packages/vibe64-voice/src/client/Vibe64AvatarSetting.vue"),
    read("../../src/components/Vibe64LocalVoiceSettings.vue"),
    read("../../src/App.vue"),
    read("../../src/components/Vibe64LocalColleagueHost.vue")
  ]);
  assert.match(chooser, /:items="VIBE64_AVATAR_CHOICES"[\s\S]*label="Avatar"/u);
  assert.match(settings, /<Vibe64AvatarSetting[\s\S]*:model-value="avatars\[binding\.preferenceTarget\]"[\s\S]*setAvatar\(binding\.preferenceTarget, value\)/u);
  assert.match(settings, /<VoiceSpeakingVoiceSelect :voice="voice"/u, "the replaced speech-service voice selector remains available");
  assert.match(settings, /import \{ VoiceSpeakingVoiceSelect \} from "@jskit-ai\/assistant-voice\/client";/u, "reuse JSKIT's selector instead of copying it");
  assert.match(app, /<Vibe64LocalVoiceHost><Vibe64LearningRouteHold><RouterView \/><\/Vibe64LearningRouteHold><Vibe64LocalColleagueHost \/><Vibe64LearningOverlay \/><\/Vibe64LocalVoiceHost>/u);
  assert.match(colleague, /<Vibe64ColleagueAvatar v-bind="voiceVisual \|\| \{ state \}" :avatar="avatars\.colleague" \/>/u);
  assert.match(colleague, /@voice-visual="voiceVisual = \$event"/u);
});

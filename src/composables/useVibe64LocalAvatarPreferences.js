import { shallowRef } from "vue";
import { VIBE64_DEFAULT_AVATARS, isVibe64AvatarId } from "@local/vibe64-voice/shared/avatars";
import { readLocalStorageJson, writeLocalStorageJson } from "@/lib/browserLocalStorage.js";

// Standalone Vibe64 has no account preference service: the avatar chosen for
// each assistant target is remembered in this browser only. A host with saved
// personal preferences supplies its own Vibe64VoiceHost preferences instead.
const VIBE64_LOCAL_AVATAR_STORAGE_KEY = "vibe64:assistant-avatars";

function readStoredAvatars() {
  const stored = readLocalStorageJson(VIBE64_LOCAL_AVATAR_STORAGE_KEY, {});
  return Object.freeze(Object.fromEntries(Object.entries(VIBE64_DEFAULT_AVATARS).map(([target, fallback]) =>
    [target, isVibe64AvatarId(stored?.[target]) ? stored[target] : fallback])));
}

let avatars = null;

function useVibe64LocalAvatarPreferences() {
  // One browser-wide choice per target, shared by every mounted consumer.
  avatars ||= shallowRef(readStoredAvatars());
  function setAvatar(target, value) {
    if (!Object.hasOwn(VIBE64_DEFAULT_AVATARS, target) || !isVibe64AvatarId(value)) return;
    if (avatars.value[target] === value) return;
    avatars.value = Object.freeze({ ...avatars.value, [target]: value });
    writeLocalStorageJson(VIBE64_LOCAL_AVATAR_STORAGE_KEY, avatars.value);
  }
  return { avatars, setAvatar };
}

export { VIBE64_LOCAL_AVATAR_STORAGE_KEY, useVibe64LocalAvatarPreferences };

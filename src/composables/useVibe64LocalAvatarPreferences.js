import { shallowRef } from "vue";
import { VIBE64_DEFAULT_AVATARS, isVibe64AvatarId } from "@local/vibe64-voice/shared/avatars";
import { readLocalStorageJson, writeLocalStorageJson } from "@/lib/browserLocalStorage.js";

// Standalone Vibe64 has no account preference service: the avatar chosen for
// each assistant target, and whether its face was last shown or minimised, are
// remembered in this browser only. A host with saved personal preferences
// supplies its own Vibe64VoiceHost preferences instead.
const VIBE64_LOCAL_AVATAR_STORAGE_KEY = "vibe64:assistant-avatars";
const VIBE64_LOCAL_AVATAR_VISIBILITY_STORAGE_KEY = "vibe64:assistant-avatar-visibility";

function readStoredAvatars() {
  const stored = readLocalStorageJson(VIBE64_LOCAL_AVATAR_STORAGE_KEY, {});
  return Object.freeze(Object.fromEntries(Object.entries(VIBE64_DEFAULT_AVATARS).map(([target, fallback]) =>
    [target, isVibe64AvatarId(stored?.[target]) ? stored[target] : fallback])));
}

function readStoredVisibility() {
  const stored = readLocalStorageJson(VIBE64_LOCAL_AVATAR_VISIBILITY_STORAGE_KEY, {});
  return Object.freeze(Object.fromEntries(Object.keys(VIBE64_DEFAULT_AVATARS).map(target => [target, stored?.[target] !== false])));
}

let avatars = null;
let visibility = null;

function useVibe64LocalAvatarPreferences() {
  // One browser-wide choice per target, shared by every mounted consumer.
  avatars ||= shallowRef(readStoredAvatars());
  visibility ||= shallowRef(readStoredVisibility());
  function setAvatar(target, value) {
    if (!Object.hasOwn(VIBE64_DEFAULT_AVATARS, target) || !isVibe64AvatarId(value)) return;
    if (avatars.value[target] === value) return;
    avatars.value = Object.freeze({ ...avatars.value, [target]: value });
    writeLocalStorageJson(VIBE64_LOCAL_AVATAR_STORAGE_KEY, avatars.value);
  }
  function setAvatarVisible(target, value) {
    if (!Object.hasOwn(VIBE64_DEFAULT_AVATARS, target) || typeof value !== "boolean") return;
    if (visibility.value[target] === value) return;
    visibility.value = Object.freeze({ ...visibility.value, [target]: value });
    writeLocalStorageJson(VIBE64_LOCAL_AVATAR_VISIBILITY_STORAGE_KEY, visibility.value);
  }
  return { avatars, setAvatar, visibility, setAvatarVisible };
}

export { VIBE64_LOCAL_AVATAR_STORAGE_KEY, VIBE64_LOCAL_AVATAR_VISIBILITY_STORAGE_KEY, useVibe64LocalAvatarPreferences };

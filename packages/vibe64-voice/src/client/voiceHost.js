import { inject } from "vue";

/**
 * What Vibe64VoiceHost provides to every view inside it: the one voice controller and the person's voice
 * preferences for each conversation. Both hosts render their views inside it.
 * @typedef {object} Vibe64Voice
 * @property {ReturnType<typeof import("@jskit-ai/assistant-voice/client").createVoiceConversationController>} controller
 * @property {import("vue").ShallowRef<unknown>} launcher
 * @property {(conversation: object) => boolean} readAloudFor
 * @property {(conversation: object) => boolean} readAloudChangePendingFor
 * @property {(target: string) => boolean | null} avatarVisibleFor
 * @property {(target: string, visible: boolean) => void} setAvatarVisible
 * @property {import("vue").FunctionalComponent | null} Avatar the host's avatar slot, when it has one; it forwards
 * `still` to its face, which a minimised chat's Show avatar thumbnail sets so the face never moves
 * @property {import("vue").FunctionalComponent | null} Settings the host's settings slot, when it has one
 * @property {(conversation: object) => Promise<unknown>} open
 */

export const VIBE64_VOICE_KEY = Symbol.for("vibe64.voice");

/** @returns {Vibe64Voice} */
export function useVibe64Voice() {
  return inject(VIBE64_VOICE_KEY);
}

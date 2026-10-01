import { inject } from "vue";
export const VIBE64_VOICE_KEY = Symbol.for("vibe64.voice");
export function useVibe64Voice() { return inject(VIBE64_VOICE_KEY, null); }

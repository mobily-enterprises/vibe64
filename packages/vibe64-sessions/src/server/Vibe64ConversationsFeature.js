import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createConversationHost, NO_COLLEAGUE_CONVERSATIONS } from "./conversationHost.js";
import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("./types.js").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-colleague/server/types").ColleagueService} ColleagueService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */

/** The assistant runtime's conversation host, shared by Main and Colleague when it is installed. */
const Vibe64ConversationsFeature = defineFeature({
  id: "vibe64.conversations",
  domain: "vibe64-conversations",
  requires: {
    env: "runtime.env",
    sessions: "vibe64.sessions",
    http: "runtime.http"
  },
  optional: { colleague: "vibe64.colleague" },
  provides: {
    conversations: "assistant.conversations",
    access: "assistant.conversation.access"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {SessionsService} capabilities.sessions
   * @param {ColleagueService | null} capabilities.colleague
   * @param {RuntimeHttp} capabilities.http
   */
  setup({
    env,
    sessions,
    colleague,
    http
  }) {
    return createConversationHost({
      colleagueConversations: colleague ? colleague.browserConversations : NO_COLLEAGUE_CONVERSATIONS,
      http,
      localhostCheckBypassed: isLocalhostCheckBypassEnabled({ env }),
      mainConversations: sessions.browserConversations
    });
  }
});

export { Vibe64ConversationsFeature };

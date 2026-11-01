import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createConversationHost, NO_COLLEAGUE_CONVERSATIONS } from "./conversationHost.js";

/** @typedef {import("./types.js").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-colleague/server/types").ColleagueService} ColleagueService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */

/** The assistant runtime's conversation host, shared by Main and Colleague when it is installed. */
const Vibe64ConversationsFeature = defineFeature({
  id: "vibe64.conversations",
  domain: "vibe64-conversations",
  requires: {
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
   * @param {SessionsService} capabilities.sessions
   * @param {ColleagueService | null} capabilities.colleague
   * @param {RuntimeHttp} capabilities.http
   */
  setup({
    sessions,
    colleague,
    http
  }) {
    return createConversationHost({
      colleagueConversations: colleague ? colleague.browserConversations : NO_COLLEAGUE_CONVERSATIONS,
      http,
      mainConversations: sessions.browserConversations
    });
  }
});

export { Vibe64ConversationsFeature };

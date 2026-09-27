import { describe, expect, it } from "vitest";
import { thinkingMessagePresentation, usesCommentaryForThinking } from "../../src/lib/vibe64ThinkingPresentation.js";

describe("provider thinking presentation", () => {
  for (const engineId of ["codex", "claude"]) {
    for (const modelProviderId of ["deepseek", "zai-coding-plan"]) {
      it(`${engineId}/${modelProviderId} presents commentary as thinking and omits raw reasoning`, () => {
        const selection = { engineId, modelProviderId };
        const commentary = { role: "commentary", text: "Checking the sources.", messageId: "progress" };
        const reasoning = { role: "thinking", text: "Long raw reasoning", messageId: "detail" };
        const answer = { role: "assistant", text: "The result." };
        expect(usesCommentaryForThinking(selection)).toBe(true);
        expect(thinkingMessagePresentation(commentary, selection)).toEqual({ ...commentary, role: "thinking" });
        expect(thinkingMessagePresentation(reasoning, selection)).toBeNull();
        expect(thinkingMessagePresentation(answer, selection)).toBe(answer);
        expect(commentary.role).toBe("commentary");
        expect(reasoning).not.toHaveProperty("preview");
      });
    }
  }

  it("uses each message's recorded selection and preserves other models and unknown attribution", () => {
    const deepseek = { engineId: "codex", modelProviderId: "deepseek" };
    for (const selection of [undefined, { engineId: "codex", modelProviderId: "openai" },
      { engineId: "claude", modelProviderId: "anthropic" }, { engineId: "opencode", modelProviderId: "deepseek" }]) {
      const message = { role: "commentary", text: "Working." };
      expect(thinkingMessagePresentation(message, selection)).toBe(message);
      if (selection) {
        const attributed = { ...message, assistantSelection: selection };
        expect(thinkingMessagePresentation(attributed, deepseek)).toBe(attributed);
      }
    }
  });
});

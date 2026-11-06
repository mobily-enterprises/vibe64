import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readClaudeHistory } from "@jskit-ai/assistant-core/server/claude-history";
import { conversationTurnPresentation } from "../../src/lib/vibe64ConversationPresentation.js";
import { thinkingMessagesPresentation, usesCommentaryForThinking } from "../../src/lib/vibe64ThinkingPresentation.js";
import { claudeSummarizedThinkingRecordings } from "../fixtures/claudeSummarizedThinking.js";

const claude = { engineId: "claude", modelId: "opus", modelProviderId: "anthropic", variantId: "high" };

// The Main turn Vibe64 saves from the recorded frames: Claude's history reader shares the
// live turn's block classification, and each message keeps its native block identity.
async function savedClaudeTurn({ conversationId, frames }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-claude-thinking-"));
  try {
    const workdir = path.join(root, "source");
    const configRoot = path.join(root, "config");
    await mkdir(workdir);
    const projectDirectory = path.join(configRoot, "projects", (await realpath(workdir)).replace(/[^a-zA-Z0-9]/gu, "-"));
    await mkdir(projectDirectory, { recursive: true });
    await writeFile(path.join(projectDirectory, `${conversationId}.jsonl`),
      frames.map((frame) => `${JSON.stringify(frame)}\n`).join(""));
    const history = await readClaudeHistory({ configRoot, workdir, conversationId });
    const at = new Map(frames.map((frame) => [`claude_${frame.uuid}_0`, frame.timestamp]));
    return {
      turnId: "000052",
      metadata: { engineId: "claude", assistantSelection: claude },
      messages: [
        { role: "user", text: frames[0].message.content[0].text, messageId: "message_user", at: frames[0].timestamp },
        ...history.messages.map((message) => ({ role: message.role, text: message.text, messageId: message.id,
          outputId: message.outputId, at: at.get(message.id) }))
      ]
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const paragraphs = (message) => message.text.split("\n\n").length;

describe("provider thinking presentation", () => {
  for (const engineId of ["codex", "claude"]) {
    for (const modelProviderId of ["deepseek", "zai-coding-plan", "zai"]) {
      it(`${engineId}/${modelProviderId} presents commentary as thinking and omits raw reasoning`, () => {
        const selection = { engineId, modelProviderId };
        const commentary = { role: "commentary", text: "Checking the sources.\n\nReading the tests.", messageId: "progress" };
        const reasoning = { role: "thinking", text: "Long raw reasoning\n\nMore of it", messageId: "detail" };
        const answer = { role: "assistant", text: "The result." };
        expect(usesCommentaryForThinking(selection)).toBe(true);
        expect(thinkingMessagesPresentation(commentary, selection)).toEqual([{ ...commentary, role: "thinking" }]);
        expect(thinkingMessagesPresentation(reasoning, selection)).toEqual([]);
        expect(thinkingMessagesPresentation(answer, selection)[0]).toBe(answer);
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
      expect(thinkingMessagesPresentation(message, selection)).toEqual([message]);
      expect(thinkingMessagesPresentation(message, selection)[0]).toBe(message);
      if (selection) {
        const attributed = { ...message, assistantSelection: selection };
        expect(thinkingMessagesPresentation(attributed, deepseek)[0]).toBe(attributed);
      }
    }
  });

  // Raw shape: the roles and summary counts Vibe64 saves; display: one progress update per summary.
  for (const [project, raw, progressLine] of [
    ["beepollen", [["thinking", 4], ["thinking", 1]], /^Your development database is protected/u],
    ["dogandgroom", [["thinking", 3], ["thinking", 1], ["thinking", 1], ["commentary", 1]], /^`PUBLIC_APP_URL` is missing/u]
  ]) {
    it(`shows each summary of Claude's summarized thinking as its own progress update (${project})`, async () => {
      const turn = await savedClaudeTurn(claudeSummarizedThinkingRecordings[project]);
      const saved = turn.messages.slice(1);
      expect(saved.map((message) => [message.role, paragraphs(message)])).toEqual(raw);
      const summaries = saved.filter((message) => message.role === "thinking").flatMap((message) => message.text.split("\n\n"));
      const shown = conversationTurnPresentation(turn).messages;
      expect(shown.map((message) => message.role)).toEqual(["user", ...Array(summaries.length).fill("thinking"),
        ...saved.filter((message) => message.role === "commentary").map(() => "commentary")]);
      const updates = shown.filter((message) => message.role === "thinking");
      expect(updates.map((message) => message.text)).toEqual(summaries);
      // The step's progress line follows the block's last summary as an update of its own.
      const [first] = saved;
      const blockSize = paragraphs(first);
      expect(updates[blockSize].text).toMatch(progressLine);
      expect(updates[blockSize - 1].text).toBe(first.text.split("\n\n").at(-1));
      expect(new Set(updates.map((message) => message.messageId)).size).toBe(summaries.length);
      expect(updates.slice(0, blockSize).map((message) => message.messageId)).toEqual([first.messageId,
        ...Array.from({ length: blockSize - 1 }, (_, index) => `${first.messageId}:${index + 2}`)]);
      expect(updates.slice(0, blockSize).every((message) => message.at === first.at && message.outputId === first.outputId)).toBe(true);
      const thinkingOnly = saved.filter((message) => message.role === "thinking");
      expect(conversationTurnPresentation({ ...turn, messages: undefined, thinking: thinkingOnly }).thinking)
        .toHaveLength(summaries.length);
    });
  }

  it("keeps a single summary, a code fence and other engines' reasoning whole", () => {
    const single = { role: "thinking", text: "Checking the tests.", messageId: "one" };
    const fenced = { role: "thinking", text: "Comparing:\n\n```js\nconst a = 1;\n\nconst b = 2;\n```", messageId: "code" };
    expect(thinkingMessagesPresentation(single, claude)).toEqual([single]);
    expect(thinkingMessagesPresentation(fenced, claude)).toEqual([fenced]);
    // Codex sends one summary per message, sometimes a heading and its body; OpenCode one per reasoning part.
    const summary = { role: "thinking", text: "Reviewing hook\n\nI'm reading the hook first.", messageId: "codex" };
    for (const engineId of ["codex", "opencode"]) {
      expect(thinkingMessagesPresentation(summary, { engineId, modelProviderId: "openai" })).toEqual([summary]);
    }
    expect(thinkingMessagesPresentation({ ...summary, assistantSelection: { engineId: "codex" } }, claude)).toHaveLength(1);
    const commentary = { role: "commentary", text: "Saved.\n\nNow testing.", messageId: "line" };
    expect(thinkingMessagesPresentation(commentary, claude)).toEqual([commentary]);
  });
});

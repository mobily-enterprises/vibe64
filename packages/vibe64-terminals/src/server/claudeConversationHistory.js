import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { readClaudeJsonFrames } from "@local/vibe64-runtime/server/claudeStreamJson";

const UUID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;

function requireClaudeSessionId(id) {
  if (!UUID_PATTERN.test(id)) throw new TypeError("Invalid Claude conversation id.");
  return id;
}

// Claude's SDK documents this layout. Only the requested native conversation is
// read; authentication files are never opened. Long paths use the CLI's prefix
// lookup because its native and Node builds use different hash suffixes.
async function claudeHistoryPath({ configRoot, workdir, conversationId }) {
  requireClaudeSessionId(conversationId);
  const canonical = (await realpath(workdir)).normalize("NFC");
  const directory = canonical.replace(/[^a-zA-Z0-9]/gu, "-");
  const projects = path.join(configRoot, "projects");
  const candidates = directory.length <= 200 ? [directory] :
    (await readdir(projects).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })).filter((name) => name.startsWith(`${directory.slice(0, 200)}-`));
  for (const name of candidates) {
    const candidate = path.join(projects, name, `${conversationId}.jsonl`);
    const info = await stat(candidate).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info?.isFile()) return { path: candidate, size: info.size };
  }
  return null;
}

function claudeMessageBlocks(frame) {
  if (frame.type !== "assistant" || frame.parent_tool_use_id) return [];
  const content = frame.message?.content;
  if (!Array.isArray(content)) return [];
  // Native frames split one API message into blocks with distinct UUIDs.
  const messageId = frame.uuid || frame.message.id;
  if (!messageId) return [];
  const commentary = content.some((block) => block.type === "tool_use");
  return content.flatMap((block, index) => {
    const text = block.type === "thinking" ? block.thinking : block.type === "text" ? block.text : "";
    return typeof text === "string" && text.trim() ? [{
      id: `claude_${messageId}_${index}`, text, complete: true,
      role: block.type === "thinking" ? "thinking" : commentary ? "commentary" : "assistant"
    }] : [];
  });
}

async function readClaudeHistory(options) {
  const file = await claudeHistoryPath(options);
  if (!file || file.size === 0) return { exists: false, messages: [], userIds: [], text: "" };
  if (file.size > 256 * 1024 * 1024) throw new Error("Claude history exceeds the supported read limit.");
  const messages = new Map();
  const userIds = [];
  let lastUserId = "";
  let goal = null;
  // Snapshot the file length. A writer can be in the middle of its last frame;
  // only this native-history read allows that unfinished tail.
  for await (const frame of readClaudeJsonFrames(createReadStream(file.path, { end: file.size - 1 }), {
    allowIncompleteTail: true
  })) {
    if (frame.isSidechain) continue;
    const status = frame.attachment;
    if (status?.type === "goal_status" && typeof status.condition === "string") {
      if (status.met === true && status.sentinel === true) goal = null;
      else if (status.met === false || status.met === true) {
        const timestamp = Date.parse(frame.timestamp) / 1000;
        goal = {
          threadId: options.conversationId, objective: status.condition,
          createdAt: goal?.objective === status.condition && !status.sentinel ? goal.createdAt : timestamp,
          status: status.met ? "complete" : "active", updatedAt: timestamp,
          reason: typeof status.reason === "string" ? status.reason : ""
        };
      }
    }
    if (frame.type === "user" && !frame.isMeta && frame.uuid &&
        (typeof frame.message?.content === "string" || frame.message?.content?.some((block) => block.type === "text"))) {
      userIds.push(frame.uuid);
      lastUserId = frame.uuid;
    }
    for (const message of claudeMessageBlocks(frame)) {
      messages.set(message.id, { ...message, userId: lastUserId });
    }
  }
  return { exists: true, messages: [...messages.values()], userIds, goal,
    text: [...messages.values()].filter((message) => message.role === "assistant" && message.userId === lastUserId)
      .map((message) => message.text).join("\n") };
}

export { claudeHistoryPath, claudeMessageBlocks, readClaudeHistory, requireClaudeSessionId };

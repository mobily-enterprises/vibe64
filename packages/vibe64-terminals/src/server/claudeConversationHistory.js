import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { readClaudeJsonFrames } from "@local/vibe64-runtime/server/claudeStreamJson";
import { retireNativeConversation } from "./nativeConversationRetirement.js";

const UUID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;

function requireClaudeSessionId(id) {
  if (!UUID_PATTERN.test(id)) throw new TypeError("Invalid Claude conversation id.");
  return id;
}

async function archivedClaudeProjectDirectory(workdir) {
  const canonical = await realpath(workdir).catch((error) => {
    if (error.code === "ENOENT") return workdir;
    throw error;
  });
  return canonical.normalize("NFC").replace(/[^a-zA-Z0-9]/gu, "-");
}

function matchingClaudeProjectDirectories(names, directory) {
  return names.filter((name) => directory.length <= 200
    ? name === directory
    : name.startsWith(`${directory.slice(0, 200)}-`));
}

export async function listClaudeConversationStorage({ configRoot, binding }) {
  if (!path.isAbsolute(configRoot) || !path.isAbsolute(binding.workdir || "")) throw new TypeError("Claude inventory requires absolute directories.");
  const directory = await archivedClaudeProjectDirectory(binding.workdir);
  const projects = path.join(configRoot, "projects");
  const names = await readdir(projects).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  const candidates = matchingClaudeProjectDirectories(names, directory);
  if (names.length > 10000 || candidates.length > 1) throw new Error("Claude project inventory is ambiguous or exceeds its limit.");
  const ids = new Set();
  for (const name of candidates) {
    const entries = await readdir(path.join(projects, name), { withFileTypes: true });
    if (entries.length > 10000) throw new Error("Claude conversation inventory exceeds its limit.");
    for (const entry of entries) {
      const id = entry.name.replace(/\.jsonl(?:\.(?:superseded|orphaned)-.*)?$/u, "");
      if (UUID_PATTERN.test(id) && entry.isFile()) ids.add(id);
    }
  }
  return [...ids].sort().map((conversationId) => ({ ...binding, conversationId }));
}

export async function retireClaudeConversationHistory({ configRoot, binding, beforeDelete, requireIdle }) {
  const id = requireClaudeSessionId(binding.conversationId);
  if (!path.isAbsolute(configRoot)) throw new TypeError("Claude retirement requires an absolute configuration root.");
  const root = path.resolve(configRoot);
  const missing = (error) => { if (error.code === "ENOENT") return null; throw error; };
  const inspect = async () => {
    await requireIdle();
    const rootInfo = await lstat(root).catch(missing);
    if (!rootInfo) return [];
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== root) {
      throw new Error("Claude storage root must be a canonical directory without symlink parents.");
    }
    const directory = await archivedClaudeProjectDirectory(binding.workdir);
    const directories = async (parent) => {
      const info = await lstat(parent).catch(missing);
      if (!info) return [];
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Claude storage contains an unsafe directory.");
      const names = await readdir(parent);
      if (names.length > 10000) throw new Error("Claude storage directory exceeds its inspection limit.");
      return names;
    };
    const projects = path.join(root, "projects");
    const projectNames = await directories(projects);
    const candidates = matchingClaudeProjectDirectories(projectNames, directory);
    const targets = [];
    let matches = 0;
    for (const name of candidates) {
      const parent = path.join(projects, name);
      const names = await directories(parent);
      const owned = names.filter((name) => name === id || name === `${id}.jsonl` ||
        name.startsWith(`${id}.jsonl.superseded-`) || name.startsWith(`${id}.jsonl.orphaned-`));
      if (owned.length) matches += 1;
      targets.push(...owned.map((name) => path.join(parent, name)));
    }
    if (matches > 1) throw new Error("Claude conversation occurs in more than one native project directory.");
    for (const kind of ["file-history", "image-cache", "uploads"]) {
      const parent = path.join(root, kind);
      if ((await directories(parent)).includes(id)) targets.push(path.join(parent, id));
    }
    const files = [];
    const visit = async (file) => {
      const info = await lstat(file);
      if ((!info.isFile() && !info.isDirectory()) || info.isSymbolicLink() || files.length >= 10000) {
        throw new Error("Claude conversation contains unsafe paths or exceeds its inspection limit.");
      }
      files.push({ path: file, directory: info.isDirectory(), inode: info.ino, size: info.size, modified: info.mtimeMs });
      if (info.isDirectory()) for (const name of (await directories(file)).sort()) await visit(path.join(file, name));
    };
    for (const target of targets.sort()) await visit(target);
    return targets.length ? [{ conversationId: id, workdir: binding.workdir, paths: targets, files }] : [];
  };
  return retireNativeConversation({ binding, inspect, beforeDelete, remove: async (records) => {
    await requireIdle();
    for (const target of records[0].paths) await rm(target, { recursive: true, force: true });
  } });
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
  const frames = [];
  const byId = new Map();
  let leafUuid = "";
  let rewound = false;
  // Snapshot the file length. A writer can be in the middle of its last frame;
  // only this native-history read allows that unfinished tail.
  for await (const frame of readClaudeJsonFrames(createReadStream(file.path, { end: file.size - 1 }), {
    allowIncompleteTail: true
  })) {
    if (frame.isSidechain) continue;
    frames.push(frame);
    if (frame.uuid) byId.set(frame.uuid, frame);
    if (["user", "assistant"].includes(frame.type) && frame.uuid) leafUuid = frame.uuid;
    if (frame.type === "last-prompt" && frame.leafUuid) {
      leafUuid = frame.leafUuid;
      rewound ||= frame.rewound === true;
    }
  }
  // Native rewind appends a resume anchor; it retains the discarded branch.
  // Follow the selected branch so restart/admission reads cannot revive it.
  const retained = new Set();
  if (rewound) {
    while (leafUuid && !retained.has(leafUuid)) {
      retained.add(leafUuid);
      leafUuid = byId.get(leafUuid)?.parentUuid;
    }
  }
  for (const frame of frames) {
    if (rewound && frame.uuid && !retained.has(frame.uuid)) continue;
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

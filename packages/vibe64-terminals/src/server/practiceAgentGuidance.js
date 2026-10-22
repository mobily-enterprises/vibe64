import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { practiceIdFromSlug } from "@local/vibe64-core/server/learningSpace";

// Vibe64 writes Genesis agent guidance (skills and assistant hooks) into every
// Genesis project before an assistant turn. An ordinary project commits it; a
// practice project's history is the learner's own work, so the guidance stays
// local to each practice session clone, for every lesson and topic.
const PRACTICE_AGENT_GUIDANCE_EXCLUDES = Object.freeze([".agents/", ".claude/", ".codex/", ".opencode/"]);
const EXCLUDE_HEADER = "# Vibe64 agent guidance stays out of practice history.";

function isPracticeProjectRuntime(runtime = null) {
  return Boolean(practiceIdFromSlug(path.basename(String(runtime?.projectContextRoot || ""))));
}

// Idempotent: appends only missing patterns to the clone's own info/exclude.
// Tracked files (an exercise that ships guidance) remain tracked.
async function excludeAgentGuidanceFromPracticeHistory(projectRoot = "") {
  const gitDirectory = path.join(projectRoot, ".git");
  const stats = await lstat(gitDirectory).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stats?.isDirectory()) return false;
  const excludePath = path.join(gitDirectory, "info", "exclude");
  const current = await readFile(excludePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const lines = new Set(current.split(/\r?\n/u).map((line) => line.trim()));
  const missing = PRACTICE_AGENT_GUIDANCE_EXCLUDES.filter((pattern) => !lines.has(pattern));
  if (!missing.length) return false;
  await mkdir(path.dirname(excludePath), { recursive: true });
  const prefix = current && !current.endsWith("\n") ? `${current}\n` : current;
  await writeFile(excludePath, `${prefix}${lines.has(EXCLUDE_HEADER) ? "" : `${EXCLUDE_HEADER}\n`}${missing.join("\n")}\n`);
  return true;
}

export { PRACTICE_AGENT_GUIDANCE_EXCLUDES, excludeAgentGuidanceFromPracticeHistory, isPracticeProjectRuntime };

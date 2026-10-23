import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { vibe64AgentRunStateIsActive } from "@local/vibe64-runtime/server/sessionStore";
import { PRACTICE_AGENT_GUIDANCE_EXCLUDES } from "@local/vibe64-terminals/server/practiceAgentGuidance";

// The bounded evidence of one learner's practice work that a review check
// (and Colleague's "I'm stuck" help) reads: the practice session's changes
// against the attempt's start commit, uncommitted work included, and, only
// when the step declares it, the end of the coding conversation. Read-only:
// Git runs through managed execution and nothing in the clone is changed.
const EVIDENCE_LIMITS = Object.freeze({
  diffCharacters: 60_000,
  fileDiffCharacters: 20_000,
  untrackedFileBytes: 64 * 1024,
  listedFiles: 200,
  conversationTurns: 20,
  conversationCharacters: 40_000,
  messageCharacters: 8_000,
  // The whole evidence as JSON, so a Colleague tool result stays below its 128 KiB.
  evidenceBytes: 112 * 1024
});
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const commitPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const excludes = PRACTICE_AGENT_GUIDANCE_EXCLUDES.map(folder => `:(exclude)${folder.replace(/\/$/u, "")}`);

function evidenceFailure(message, code = "VIBE64_TRAINING_EVIDENCE_UNREADABLE") {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

const nulList = text => String(text || "").split("\0").filter(Boolean);

function sessionAgentWorking(session) {
  return (Array.isArray(session?.agentRuns) ? session.agentRuns : []).some(run => {
    if (run?.active === true) return true;
    try { return vibe64AgentRunStateIsActive(run?.state); } catch { return false; }
  });
}

// Splits one `git diff` output into its per-file sections.
function fileSections(diff) {
  const sections = new Map();
  for (const part of String(diff || "").split(/^(?=diff --git )/mu)) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/mu.exec(part);
    if (header) sections.set(header[2], part);
  }
  return sections;
}

function createTrainingStepEvidence({ project, actions, runCommand = runVibe64Command } = {}) {
  if (!project?.runInProjectContext || !project?.createRuntime || typeof actions?.execute !== "function") {
    throw new TypeError("Step evidence requires the original project and action owners.");
  }

  async function git(source, slug, args, { maxBuffer = GIT_MAX_BUFFER } = {}) {
    const result = await runCommand({ actor: "daemon", command: "git", args: ["-c", "core.quotePath=false", ...args],
      // Optional locks off: reading never refreshes the clone's index.
      cwd: source, env: { GIT_OPTIONAL_LOCKS: "0" }, allowedRoots: [source], gitSafeDirectories: [source], envPolicy: "session", purpose: "source",
      runtimes: ["git"], mode: "capture", project: { slug }, timeout: GIT_TIMEOUT_MS, maxBuffer });
    if (result?.ok !== true) {
      throw evidenceFailure("Your practice project's changes could not be read. Nothing was recorded; try again in a moment.");
    }
    return String(result.stdout || "");
  }

  // Untracked work is new text the learner added; read it directly, bounded.
  async function untrackedSection(source, relative) {
    const filename = path.join(source, ...relative.split("/"));
    const inside = path.relative(source, filename);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return { omitted: "unsafe" };
    const stat = await lstat(filename).catch(() => null);
    if (!stat?.isFile()) return { omitted: "not-a-file" };
    if (stat.size > EVIDENCE_LIMITS.untrackedFileBytes) return { omitted: "large" };
    const bytes = await readFile(filename);
    if (bytes.includes(0)) return { omitted: "binary" };
    const text = bytes.toString("utf8");
    const lines = text ? text.replace(/\n$/u, "").split("\n") : [];
    return { added: lines.length, section: `diff --git a/${relative} b/${relative}\nnew file (not yet committed)\n--- /dev/null\n+++ b/${relative}\n${lines.map(line => `+${line}`).join("\n")}\n` };
  }

  async function readChanges(source, slug, startCommit) {
    await git(source, slug, ["cat-file", "-e", `${startCommit}^{commit}`]);
    const numstat = nulList(await git(source, slug, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "--numstat", "-z", startCommit, "--", ".", ...excludes]));
    const tracked = numstat.map(row => {
      const [added, removed, ...rest] = row.split("\t");
      const binary = added === "-" || removed === "-";
      return { path: rest.join("\t"), status: "changed", ...(binary ? { binary: true } : { added: Number(added), removed: Number(removed) }) };
    });
    const untracked = nulList(await git(source, slug, ["ls-files", "--others", "--exclude-standard", "-z", "--", ".", ...excludes]))
      .map(relative => ({ path: relative, status: "new" }));
    const all = [...tracked, ...untracked].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const files = all.slice(0, EVIDENCE_LIMITS.listedFiles);
    let truncated = all.length > files.length;
    const textTracked = files.filter(file => file.status === "changed" && !file.binary).map(file => file.path);
    const sections = textTracked.length
      ? fileSections(await git(source, slug, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "-U3", startCommit, "--", ...textTracked]))
      : new Map();
    let used = 0;
    const chunks = [];
    for (const file of files) {
      let section = "";
      if (file.binary) file.omitted = "binary";
      else if (file.status === "new") {
        const read = await untrackedSection(source, file.path);
        if (read.omitted) file.omitted = read.omitted; else { file.added = read.added; file.removed = 0; section = read.section; }
      } else section = sections.get(file.path) || "";
      if (!section) continue;
      if (section.length > EVIDENCE_LIMITS.fileDiffCharacters) { file.omitted = "large"; continue; }
      if (used + section.length > EVIDENCE_LIMITS.diffCharacters) { file.omitted = "budget"; truncated = true; continue; }
      used += section.length;
      chunks.push(section);
    }
    return { files, diff: chunks.join(""), truncated };
  }

  // The last turns of the practice session's Main chat: the learner's and the
  // agent's own words, newest kept first within the budget.
  async function readConversation(attempt, sessionId, context) {
    const result = await actions.execute({ actionId: "vibe64.sessions.conversation-log.read",
      input: { projectSlug: attempt.projectSlug, sessionId, limit: String(EVIDENCE_LIMITS.conversationTurns) }, context });
    if (result?.ok === false || result?.readError) {
      throw evidenceFailure("The lesson's coding conversation could not be read. Nothing was recorded; try again in a moment.");
    }
    const eligible = (result.conversationLog || []).flatMap(turn => (turn.messages || []))
      .filter(message => ["user", "assistant"].includes(message.role) && message.complete !== false && String(message.text || "").trim());
    let remaining = EVIDENCE_LIMITS.conversationCharacters;
    const messages = [];
    for (const message of eligible.toReversed()) {
      if (remaining <= 0) break;
      const value = String(message.text);
      const text = value.slice(0, Math.min(remaining, EVIDENCE_LIMITS.messageCharacters));
      remaining -= text.length;
      messages.unshift({ role: message.role === "user" ? "learner" : "agent", text, ...(text.length < value.length ? { truncated: true } : {}) });
    }
    return { messages, truncated: eligible.length > messages.length || messages.some(message => message.truncated) ||
      result.pagination?.hasMoreBefore === true };
  }

  // Keeps the serialized evidence within its byte budget by dropping the
  // latest diff sections first; the file list always stays.
  function withinBudget(evidence) {
    const size = () => Buffer.byteLength(JSON.stringify(evidence));
    while (size() > EVIDENCE_LIMITS.evidenceBytes && evidence.changes.diff) {
      const sections = [...fileSections(evidence.changes.diff)];
      const [last] = sections.pop();
      const file = evidence.changes.files.find(value => value.path === last);
      if (file) file.omitted = "budget";
      evidence.changes.diff = sections.map(([, text]) => text).join("");
      evidence.changes.truncated = true;
    }
    while (size() > EVIDENCE_LIMITS.evidenceBytes && evidence.conversation?.messages.length) {
      evidence.conversation.messages.shift();
      evidence.conversation.truncated = true;
    }
    return evidence;
  }

  // The attempt's practice session as it is now, and its bounded evidence.
  // conversation is read only when the step's review declares it.
  async function read({ attempt, conversation = false, context = {} } = {}) {
    const startCommit = attempt?.preparation?.startCommit;
    if (attempt?.preparation?.phase !== "ready") {
      throw evidenceFailure("Wait until this lesson's practice project is ready, then try again.", "VIBE64_TRAINING_PRACTICE_NOT_READY");
    }
    if (!commitPattern.test(startCommit || "")) {
      throw evidenceFailure("This lesson started before its work could be reviewed. Restart the lesson to have your work checked.",
        "VIBE64_TRAINING_REVIEW_UNAVAILABLE");
    }
    const sessionId = attempt.preparation.initialSessionId;
    const observed = await project.runInProjectContext(attempt.projectSlug, async () => {
      const runtime = await project.createRuntime({ inspectSource: false });
      const session = await runtime.getSession(sessionId, { inspectSource: false });
      const source = sessionSourcePath(session);
      if (!session || session.sessionId !== sessionId || !source) {
        throw evidenceFailure("This lesson's practice session is unavailable. Resume the lesson, then try again.");
      }
      const working = sessionAgentWorking(session);
      return { agentWorking: working,
        changes: working ? null : await readChanges(source, attempt.projectSlug, startCommit) };
    });
    const session = { sessionId, agentWorking: observed.agentWorking };
    if (observed.agentWorking) return { session, evidence: null, empty: false };
    const evidence = { changes: observed.changes };
    if (conversation) evidence.conversation = await readConversation(attempt, sessionId, context);
    return { session, evidence: withinBudget(evidence), empty: observed.changes.files.length === 0 };
  }

  return Object.freeze({ read });
}

export { EVIDENCE_LIMITS, createTrainingStepEvidence };

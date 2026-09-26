import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const PLAN_SECTIONS = [
  "Outcome and scope", "Findings", "Proposed changes", "Decisions",
  "Implementation steps", "Verification", "Progress and blockers"
];
const PLAN_LIMIT = 256 * 1024;

function workPlanPath(context) {
  const paths = context.runtime.store.paths(context.session.sessionId);
  const id = context.routingConversationId;
  if (id && !/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) throw new Error("Invalid plan conversation.");
  return path.join(id ? path.join(paths.conversationsRoot, id) : paths.sessionRoot, "work-plan", "plan.md");
}

async function readWorkPlan(context) {
  const file = workPlanPath(context);
  let handle;
  try {
    const directory = await lstat(path.dirname(file));
    if (!directory.isDirectory()) throw new Error("The work plan directory must not be a link.");
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > PLAN_LIMIT) throw new Error("The work plan must be a regular Markdown file smaller than 256 KiB.");
    const text = await handle.readFile("utf8");
    if (Buffer.byteLength(text) > PLAN_LIMIT) throw new Error("The work plan is too large.");
    const status = /^Status: (drafting|ready|blocked|implemented)\r?$/mu.exec(text)?.[1];
    const normalizedText = text.replaceAll("\r\n", "\n");
    const complete = PLAN_SECTIONS.every((heading) => {
      const section = normalizedText.split(`## ${heading}\n`)[1]?.split(/\n## /u)[0]?.trim();
      return Boolean(section);
    });
    return {
      text,
      status: !status || (status === "ready" && !complete) ? "drafting" : status,
      revision: createHash("sha256").update(text).digest("hex")
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function prepareWorkPlan(context, planning) {
  const file = workPlanPath(context);
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw new Error("The work plan directory must not be a link.");
  const current = await readWorkPlan(context);
  // A planning turn invalidates the old proposal before inference. A crash or
  // an interrupted revision must never leave yesterday's Implement action live.
  if (planning && current) {
    const text = `Status: drafting\n${current.text.replace(/^Status: (drafting|ready|blocked|implemented)\r?$/mu, "").trimStart()}`;
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return file;
}

function workPlanInstructions(file, role) {
  const common = [
    `The conversation's working plan is ${JSON.stringify(file)}, outside the project repository.`,
    "Never commit or copy it into project source.",
    "It is a detailed working document, not a permanent project document.",
    'Use a line exactly "Status: drafting", "Status: ready", "Status: blocked", or "Status: implemented".',
    `Keep these Markdown sections: ${PLAN_SECTIONS.map((name) => `"## ${name}"`).join(", ")}.`,
    "Human instructions take precedence over the document.",
    "In chat, refer to the View plan action; do not expose or link this internal filesystem path."
  ].join(" ");
  if (role === "senior") {
    const planning = [
      "You may create or update ONLY this plan file; do not edit application files or run state-changing project operations.",
      "For every proposed implementation, inspect the actual project and write a VERY DETAILED plan: enumerate relevant occurrences and affected files/code locations, explain exact proposed changes and boundaries, record decisions and unresolved questions, ordered implementation steps, concrete acceptance criteria and verification, and completed work/blockers.",
      "Do not substitute a chat summary for the file.",
      "Update the same document after steering or discoveries.",
      "Mark ready only when the plan is complete and decisions are resolved, then summarize it for the human and ask whether to implement it.",
      "Do not start or delegate coding.",
      "Pure conversation does not require manufacturing a plan.",
      "The user selected Auto; this request is currently in its planning stage. Do not claim they selected direct Senior chat."
    ].join(" ");
    return `${common}\n${planning}`;
  }
  const implementation = [
    role === "review"
      ? "Read the working plan before reviewing the implementation."
      : "Read and implement the approved plan before changing application files.",
    "Keep its Progress and blockers section current, including files changed and actual checks.",
    "Do not silently revise its agreed scope or approach.",
    "Ordinary implementation problems and failing tests are yours to resolve.",
    "If steering or a discovery requires an unresolved product/architectural decision, contradicts requirements, or invalidates the approach, record the exact blocker and work already completed in the plan, set Status: blocked, explain briefly in chat, and END this turn without requesting a tool that waits for user input.",
    "Vibe64 will return the work to the planner.",
    "Do not discard existing edits.",
    "On successful implementation set Status: implemented.",
    role === "review"
      ? "Review against the detailed plan and accepted steering. You may fix in-scope defects; an unresolved scope or design decision returns to planning."
      : ""
  ].join(" ");
  return `${common}\n${implementation}`;
}

export { readWorkPlan, prepareWorkPlan, workPlanPath, workPlanInstructions };

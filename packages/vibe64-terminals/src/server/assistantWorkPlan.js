import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseWorkPlanLines } from "../shared/assistantWorkPlan.js";

const PLAN_LIMIT = 256 * 1024;
const mutations = new Map();
const digest = (text) => createHash("sha256").update(text).digest("hex");

function planError(message, code = "vibe64_work_plan_invalid") {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

function workPlanPath(context) {
  const paths = context.runtime.store.paths(context.session.sessionId);
  const id = context.routingConversationId;
  if (id && !/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) throw planError("Invalid plan conversation.");
  return path.join(id ? path.join(paths.conversationsRoot, id) : paths.sessionRoot, "plans", "current.md");
}

async function readPlanFile(file) {
  let handle;
  try {
    if (!(await lstat(path.dirname(file))).isDirectory()) throw planError("The plan directory must not be a link.");
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > PLAN_LIMIT) throw planError("The plan must be a regular Markdown file smaller than 256 KiB.");
    const text = await handle.readFile("utf8");
    if (Buffer.byteLength(text) > PLAN_LIMIT) throw planError("The plan is too large.");
    const status = /^Status: (active|completed)\r?$/mu.exec(text)?.[1];
    if (!status) throw planError("This plan needs the stopped-service state upgrade before it can be used.");
    const items = parseWorkPlanLines(text).filter((item) => item.checked !== undefined);
    return {
      text, status, revision: digest(text),
      title: /^# (.+)$/mu.exec(text)?.[1]?.trim() || "Untitled plan",
      checked: items.filter((item) => item.checked).length,
      total: items.length
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readWorkPlan(context) { return readPlanFile(workPlanPath(context)); }

function archivePath(context, id) {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw planError("Invalid archived plan identity.");
  return path.join(path.dirname(workPlanPath(context)), "archive", id + ".md");
}

async function readWorkPlanHistory(context) {
  try {
    if (!(await lstat(path.dirname(workPlanPath(context)))).isDirectory()) throw planError("The plan directory must not be a link.");
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const directory = path.join(path.dirname(workPlanPath(context)), "archive");
  let entries;
  try {
    if (!(await lstat(directory)).isDirectory()) throw planError("Plan history must not be a link.");
    entries = await readdir(directory);
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const history = [];
  for (const name of entries) {
    if (!/^[a-f0-9]{64}\.md$/u.test(name)) continue;
    const id = name.slice(0, -3);
    const file = archivePath(context, id);
    const plan = await readPlanFile(file);
    if (!plan || plan.revision !== id) throw planError("An archived plan has changed. Restore its saved snapshot before continuing.");
    const { text: _text, ...summary } = plan;
    history.push({ ...summary, id, archivedAt: (await lstat(file)).mtime.toISOString() });
  }
  return history.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

async function readWorkPlanPage(context, { offset = 0, limit = 16000, expectedRevision = "", archiveId = "" } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) throw planError("Invalid plan page bounds.");
  if (offset > 0 && !expectedRevision) throw planError("Further plan pages require the revision from the first page.", "vibe64_work_plan_revision_required");
  const current = await readWorkPlan(context);
  const plan = archiveId ? await readPlanFile(archivePath(context, archiveId)) : current;
  const history = offset === 0 ? await readWorkPlanHistory(context) : undefined;
  const summary = current ? { title: current.title, status: current.status, revision: current.revision } : null;
  if (!plan) return { available: false, current: summary, ...(history ? { history } : {}) };
  if (archiveId && plan.revision !== archiveId) throw planError("The archived plan no longer matches its snapshot.");
  if (expectedRevision && expectedRevision !== plan.revision) throw planError("The plan changed. Read it again from the beginning.", "vibe64_work_plan_changed");
  const characters = Array.from(plan.text);
  if (offset > characters.length) throw planError("The plan page begins after the end of the document.", "vibe64_work_plan_offset_invalid");
  const nextOffset = Math.min(offset + limit, characters.length);
  return { ...plan, available: true, archiveId, current: summary, ...(history ? { history } : {}), text: characters.slice(offset, nextOffset).join(""),
    offset, nextOffset, totalCharacters: characters.length, hasMore: nextOffset < characters.length };
}

async function writePlan(file, text) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw planError("The plan directory must not be a link.");
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

async function archiveCurrent(context, current) {
  if (!current) return;
  const file = archivePath(context, current.revision);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!(await lstat(path.dirname(file))).isDirectory()) throw planError("Plan history must not be a link.");
  const previous = await readPlanFile(file);
  if (previous && previous.text !== current.text) throw planError("The archived plan conflicts with the current document.");
  if (!previous) await writePlan(file, current.text);
}

// The helper derives role from the admitted turn, never from command payloads.
async function manageWorkPlan(context, input, role) {
  const file = workPlanPath(context);
  const previous = mutations.get(file) || Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    const { operation, expectedRevision = "", archiveId = "", archiveCurrent: acknowledgeArchive = false } = input;
    if (operation === "read") return readWorkPlanPage(context, input);
    if (operation === "history") return { history: await readWorkPlanHistory(context) };
    if (!["new", "write", "complete", "archive", "reopen"].includes(operation)) throw planError("Unknown plan operation.");
    const canEdit = ["senior", "review"].includes(role) || (role === "junior" && operation === "write") ||
      (role === "user" && (operation === "archive" || (operation === "reopen" && Boolean(archiveId))));
    if (!canEdit) {
      throw planError("Only Senior can create, reopen, archive or complete a plan. Junior can update its checklist and evidence.");
    }
    const current = await readWorkPlan(context);
    if (role === "user" && operation === "reopen" && current) {
      throw planError("There is already a current plan. Archive it before making another plan current.");
    }
    if (current && expectedRevision !== current.revision) throw planError("The plan changed. Read the current plan before editing it.", "vibe64_work_plan_changed");
    if (!current && expectedRevision) throw planError("There is no current plan at that revision.", "vibe64_work_plan_changed");
    if (["write", "complete", "archive"].includes(operation) && !current) throw planError("There is no current plan.");
    if (operation === "write" && current.status !== "active") throw planError("The plan is completed. Senior must explicitly reopen it before changes.");
    let next;
    switch (operation) {
      case "new":
      case "write": {
        const body = String(input.text || "").replace(/^Status: .*\r?\n?/gmu, "").trim();
        if (!/^# .+/mu.test(body) || !parseWorkPlanLines(body).some((item) => item.checked !== undefined)) {
          throw planError("A plan needs a title and Markdown checklists (- [ ] item). No other fixed structure is required.");
        }
        next = "Status: active\n" + body + "\n";
        if (Buffer.byteLength(next) > PLAN_LIMIT) throw planError("The plan is too large.");
        break;
      }
      case "complete":
        if (!current.total || current.checked < current.total) {
          throw planError("The plan still has unchecked requirements. Record their resolution before explicitly completing it.");
        }
        next = current.text.replace(/^Status: active\r?$/mu, "Status: completed");
        break;
      case "reopen": {
        const saved = archiveId ? await readPlanFile(archivePath(context, archiveId)) : current;
        if (!saved || (archiveId && saved.revision !== archiveId)) throw planError("The requested plan snapshot is unavailable.");
        next = saved.text.replace(/^Status: completed\r?$/mu, "Status: active");
        break;
      }
    }
    const replacing = operation === "new" || (operation === "reopen" && Boolean(archiveId));
    if (replacing && current && !acknowledgeArchive) {
      throw planError("Tell the user that “" + current.title + "” will be archived and remain accessible, then repeat with archiveCurrent: true.");
    }
    // Save the exact record before replacement. Content identity makes retry safe.
    if (current && (replacing || operation === "archive")) await archiveCurrent(context, current);
    if (operation === "archive") await rm(file);
    else await writePlan(file, next);
    // Keep the original safe until the reopened current document is written.
    if (operation === "reopen" && archiveId) await rm(archivePath(context, archiveId));
    const result = await readWorkPlanPage(context);
    if (current && (replacing || operation === "archive")) {
      result.notice = "Archived “" + current.title + "”. It remains available in Plan history.";
    }
    return result;
  });
  mutations.set(file, pending);
  try {
    return await pending;
  } finally {
    if (mutations.get(file) === pending) mutations.delete(file);
  }
}

function workPlanInstructions(role) {
  const common = [
    "The conversation has one current plan, active or completed, and preserved archived snapshots outside the project repository.",
    "Use vibe64-helper plan --help, then vibe64-helper plan read or history to inspect it. Use the plan helper for ALL edits and lifecycle operations; never edit its storage files directly or copy them into the repository.",
    "Plan commands take a JSON object on stdin. Writes require expectedRevision from the latest read. New/write take text containing a Markdown title and checklists (- [ ] / - [x]); other headings and structure are your choice.",
    "Make the visible checklist understandable to the user. Track deliverables and acceptance requirements, with evidence and blockers next to the relevant items. Never tick an unverified claim. Update the checklist during work so the user can follow live progress.",
    "Human instructions take precedence. Keep agreed scope and completed evidence; do not invent additional requirements. Discussion alone never changes plan status.",
    "Refer to View plan and Plan history in chat, not internal paths. Read archived plans on demand instead of loading all history. A completed plan remains accessible. A finished turn never completes a plan."
  ].join(" ");
  if (role === "junior") return common + " You are Junior. When asked to implement the active plan, read it first, preserve delivered work, tick completed items and record actual evidence using write. Leave incomplete or failed items unchecked and explain blockers. You cannot create, archive, reopen or complete the plan. Completed implementation in Auto receives a separate Senior review; do not ask the user to request that review or final completion. Stop for changed scope or unresolved product decisions; do not start a planning/review loop yourself.";
  return common + " You are Senior and own the plan's scope and lifecycle. Use new to start a distinct plan, write to revise the active canvas, reopen to resume a completed/current or archived plan, archive when requested, and complete ONLY when every required acceptance item is supported by evidence. Before new or reopening an archived plan replaces a current plan, tell the user which current plan will be archived and that it remains accessible; then pass archiveCurrent:true. Reopening an archive moves it back to current as active, removing that entry from History while retaining its checklist and evidence. During review, uncheck unsupported claims and add missing checks required by the approved scope; fix in-scope defects and verify them. If anything remains unfinished, leave the plan active, explain it, and wait for a user request to continue. Do not silently restart execution, invent requirements, or ask the user to click Implement.";
}

export { readWorkPlan, readWorkPlanPage, readWorkPlanHistory, manageWorkPlan, workPlanPath, workPlanInstructions };

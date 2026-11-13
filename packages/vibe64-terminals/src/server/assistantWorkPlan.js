import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { parseWorkPlanLines, workPlanScope } from "../shared/assistantWorkPlan.js";
import { createKeyedQueue } from "@local/vibe64-core/server/keyedOperations";
import { sha256Hex } from "@local/vibe64-core/server/sha256Hex";

const PLAN_LIMIT = 256 * 1024;
// Process-wide: whole pair reads and publication/cleanup of a plan file run
// one at a time per plan path, whichever service asks.
const workPlanQueue = createKeyedQueue();
// An archived plan does not change: its record names content-addressed plan
// and progress documents. Plan history keeps each archived plan's summary
// while the identities (device, inode, size, times) of its record and
// documents stay the same, so listing history reads in full only the plans
// archived or changed since, not every archived plan on every read.
const HISTORY_SUMMARY_LIMIT = 4096;
/** @type {Map<string, { identities: string, documents: string[], summary: Record<string, unknown> }>} */
const historySummaries = new Map();

function planError(message, code, params) {
  return new AppError(409, message, { code, params });
}

function workPlanPath(context) {
  const paths = context.runtime.store.paths(context.session.sessionId);
  const id = context.routingConversationId;
  if (id && !/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) throw planError("Invalid plan conversation.", "vibe64_work_plan_conversation_invalid");
  return path.join(id ? path.join(paths.conversationsRoot, id) : paths.sessionRoot, "plans", "current.md");
}

async function readPlanFile(file, options = {}) {
  const { plainText = false } = options;
  let handle;
  try {
    if (!(await lstat(path.dirname(file))).isDirectory()) throw planError("The plan directory must not be a link.", "vibe64_work_plan_directory_link");
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > PLAN_LIMIT) throw planError("The plan must be a regular Markdown file smaller than 256 KiB.", "vibe64_work_plan_file_invalid");
    const text = await handle.readFile("utf8");
    if (Buffer.byteLength(text) > PLAN_LIMIT) throw planError("The plan is too large.", "vibe64_work_plan_too_large");
    if (plainText) return text;
    const status = /^Status: (active|completed)\r?$/mu.exec(text)?.[1];
    if (!status) throw planError("This plan needs the stopped-service state upgrade before it can be used.", "vibe64_work_plan_upgrade_required");
    const items = parseWorkPlanLines(text).filter((item) => item.checked !== undefined);
    return {
      text,
      status,
      revision: sha256Hex(text),
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

function planDirectory(context) {
  return path.dirname(workPlanPath(context));
}
function pairPath(context, id = "") {
  if (id && !/^[a-f0-9]{64}$/u.test(id)) throw planError("Invalid archived plan identity.", "vibe64_work_plan_archive_id_invalid");
  return id ? path.join(planDirectory(context), "archive", id + ".json") : path.join(planDirectory(context), "current.json");
}
function pairIdentity(record) {
  return sha256Hex("vibe64-plan-progress-v1\0" + JSON.stringify([record.planRevision, record.progressRevision]));
}
function pairRecord(plan, progressRevision) {
  return { schemaVersion: 1, planRevision: plan.revision, progressRevision };
}
function documentPath(context, kind, revision) {
  if (!["plan", "progress"].includes(kind) || !/^[a-f0-9]{64}$/u.test(revision)) throw planError("Invalid plan document identity.", "vibe64_work_plan_document_id_invalid");
  return path.join(planDirectory(context), kind, revision + ".md");
}
function parsePairRecord(source, id = "") {
  let record;
  try {
    record = JSON.parse(source);
  } catch {
    throw planError("The plan and progress record is invalid. Inspect its saved snapshot.", "vibe64_work_plan_invalid");
  }
  if (!record || record.schemaVersion !== 1 || !/^[a-f0-9]{64}$/u.test(record.planRevision) ||
      !(record.progressRevision === null || /^[a-f0-9]{64}$/u.test(record.progressRevision)) ||
      Object.keys(record)
        .some(key => !["schemaVersion", "planRevision", "progressRevision", "archivedAt", "legacyArchive"].includes(key)) ||
      (record.archivedAt !== undefined && !Number.isFinite(Date.parse(record.archivedAt))) ||
      (record.legacyArchive !== undefined && record.legacyArchive !== true)) throw planError("The plan and progress binding is invalid.", "vibe64_work_plan_binding_invalid");
  if (id && !record.archivedAt) throw planError("The archived pair has no recorded archive time.", "vibe64_work_plan_archive_time_missing");
  if (id && (record.legacyArchive ? record.progressRevision !== null || id !== record.planRevision : id !== pairIdentity(record))) {
    throw planError("The archived plan and progress no longer match their snapshot.", "vibe64_work_plan_archive_snapshot_mismatch");
  }
  return record;
}
async function readPair(context, id = "") {
  const source = await readPlanFile(pairPath(context, id), { plainText: true });
  if (source === null) return null;
  const record = parsePairRecord(source, id);
  const plan = await readPlanFile(documentPath(context, "plan", record.planRevision));
  const progressText = record.progressRevision === null
    ? null
    : await readPlanFile(documentPath(context, "progress", record.progressRevision), { plainText: true });
  if (!plan || plan.revision !== record.planRevision || (record.progressRevision !== null &&
      (progressText === null || sha256Hex(progressText) !== record.progressRevision))) {
    throw planError("A plan or progress document is missing or changed. Restore the saved pair before continuing.", "vibe64_work_plan_pair_missing");
  }
  return {
    ...plan,
    progressText,
    progressRevision: record.progressRevision,
    artifactRevision: pairIdentity(record),
    ...(record.archivedAt ? { archivedAt: record.archivedAt } : {})
  };
}
async function readWorkPlanUnlocked(context) {
  const pair = await readPair(context);
  const legacy = await readPlanFile(workPlanPath(context));
  if (pair && legacy) throw planError("Both legacy and paired current plans exist. Finish the stopped-service state upgrade.", "vibe64_work_plan_current_formats_conflict");
  return pair || (legacy ? { ...legacy, progressText: null, progressRevision: null, legacy: true } : null);
}
function archivePath(context, id) {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw planError("Invalid archived plan identity.", "vibe64_work_plan_archive_id_invalid");
  return path.join(planDirectory(context), "archive", id + ".md");
}
async function readArchived(context, id) {
  const pair = await readPair(context, id);
  const legacy = await readPlanFile(archivePath(context, id));
  if (pair && legacy) throw planError("Both legacy and paired archive records exist. Finish the stopped-service state upgrade.", "vibe64_work_plan_archive_formats_conflict");
  if (legacy && legacy.revision !== id) throw planError("An archived plan has changed. Restore its saved snapshot before continuing.", "vibe64_work_plan_archive_changed");
  return pair || (legacy ? {
    ...legacy,
    progressText: null,
    progressRevision: null,
    legacy: true,
    archivedAt: (await lstat(archivePath(context, id))).mtime.toISOString()
  } : null);
}
async function planFileIdentity(file) {
  try {
    const info = await lstat(file, { bigint: true });
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}
function rememberHistorySummary(key, entry) {
  historySummaries.delete(key);
  historySummaries.set(key, entry);
  while (historySummaries.size > HISTORY_SUMMARY_LIMIT) historySummaries.delete(historySummaries.keys().next().value);
}
/** One archived plan's history entry: its summary, never its text. */
async function readArchivedSummary(context, id) {
  const records = [pairPath(context, id), archivePath(context, id)];
  const cached = historySummaries.get(records[0]);
  if (cached) {
    const identities = await Promise.all([...records, ...cached.documents].map(planFileIdentity));
    if (identities.join("\n") === cached.identities) return { ...cached.summary };
  }
  // Identities are taken before the reads: a file replaced in between is read
  // again next time instead of being kept under its new identity.
  const recordIdentities = await Promise.all(records.map(planFileIdentity));
  const source = await readPlanFile(records[0], { plainText: true });
  const record = source === null ? null : parsePairRecord(source, id);
  const documents = record ? [
    documentPath(context, "plan", record.planRevision),
    ...(record.progressRevision === null ? [] : [documentPath(context, "progress", record.progressRevision)])
  ] : [];
  const documentIdentities = await Promise.all(documents.map(planFileIdentity));
  const plan = await readArchived(context, id);
  if (!plan) throw planError("Plan history changed while it was being read. Read it again.", "vibe64_work_plan_history_changed");
  const { text: _text, progressText: _progress, legacy: _legacy, ...summary } = plan;
  const entry = { ...summary, progressRevision: plan.progressRevision || "", progressAvailable: plan.progressText !== null, id };
  rememberHistorySummary(records[0], { identities: [...recordIdentities, ...documentIdentities].join("\n"), documents, summary: entry });
  return { ...entry };
}
async function readWorkPlanHistoryUnlocked(context) {
  try {
    if (!(await lstat(planDirectory(context))).isDirectory()) throw planError("The plan directory must not be a link.", "vibe64_work_plan_directory_link");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const directory = path.join(planDirectory(context), "archive");
  let entries;
  try {
    if (!(await lstat(directory)).isDirectory()) throw planError("Plan history must not be a link.", "vibe64_work_plan_history_link");
    entries = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const ids = new Set(entries.filter(name => /^[a-f0-9]{64}\.(md|json)$/u.test(name)).map(name => name.slice(0, 64)));
  const history = await Promise.all([...ids].map(id => readArchivedSummary(context, id)));
  return history.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}
function currentPlanSummary(current) {
  return current ? {
    title: current.title,
    status: current.status,
    revision: current.revision,
    progressRevision: current.progressRevision || ""
  } : null;
}
async function readWorkPlanPageUnlocked(context, options = {}) {
  const {
    offset = 0,
    limit = 16000,
    expectedRevision = "",
    expectedProgressRevision = "",
    archiveId = "",
    summary: summaryOnly = false
  } = options;
  if (summaryOnly) {
    const current = await readWorkPlanUnlocked(context);
    return { available: Boolean(current), current: currentPlanSummary(current), history: await readWorkPlanHistoryUnlocked(context) };
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) {
    throw planError("Invalid plan page bounds.", "vibe64_work_plan_page_bounds_invalid");
  }
  if (offset > 0 && !expectedRevision) {
    throw planError("Further plan pages require the revision from the first page.", "vibe64_work_plan_revision_required");
  }
  const current = await readWorkPlanUnlocked(context);
  const plan = archiveId ? await readArchived(context, archiveId) : current;
  const history = offset === 0 ? await readWorkPlanHistoryUnlocked(context) : undefined;
  const summary = currentPlanSummary(current);
  if (!plan) return { available: false, current: summary, ...(history ? { history } : {}) };
  if (expectedRevision && expectedRevision !== plan.revision || (offset > 0 || expectedProgressRevision) &&
      expectedProgressRevision !== (plan.progressRevision || "")) {
    throw planError("The plan or progress changed. Read both again from the beginning.", "vibe64_work_plan_read_changed");
  }
  const characters = Array.from(plan.text);
  const progress = Array.from(plan.progressText || "");
  const totalCharacters = characters.length + progress.length;
  if (offset > totalCharacters) throw planError("The plan page begins after the end of the document.", "vibe64_work_plan_offset_invalid");
  const nextOffset = Math.min(offset + limit, totalCharacters);
  return {
    ...plan,
    available: true,
    archiveId,
    current: summary,
    ...(history ? { history } : {}),
    text: characters.slice(offset, Math.min(nextOffset, characters.length)).join(""),
    progressRevision: plan.progressRevision || "",
    progressAvailable: plan.progressText !== null,
    progressText: progress.slice(Math.max(0, offset - characters.length), Math.max(0, nextOffset - characters.length)).join(""),
    offset,
    nextOffset,
    totalCharacters,
    hasMore: nextOffset < totalCharacters
  };
}

async function writePlan(file, text) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw planError("The plan directory must not be a link.", "vibe64_work_plan_directory_link");
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function saveDocument(context, kind, text) {
  const revision = sha256Hex(text);
  const file = documentPath(context, kind, revision);
  const previous = await readPlanFile(file, { plainText: true });
  if (previous !== null && previous !== text) throw planError("The immutable plan document conflicts with its content identity.", "vibe64_work_plan_document_conflict");
  if (previous === null) await writePlan(file, text);
  return revision;
}
async function publishPair(context, text, progressText) {
  const planRevision = await saveDocument(context, "plan", text);
  const progressRevision = progressText === null ? null : await saveDocument(context, "progress", progressText);
  await writePlan(pairPath(context), JSON.stringify({ schemaVersion: 1, planRevision, progressRevision }) + "\n");
}
async function archiveCurrent(context, current) {
  if (!current) return;
  const record = pairRecord(current, current.progressRevision);
  const id = pairIdentity(record);
  const previous = await readPair(context, id);
  if (previous && (previous.text !== current.text || previous.progressText !== current.progressText)) {
    throw planError("The archived pair conflicts with the current documents.", "vibe64_work_plan_archive_conflict");
  }
  if (!previous) await writePlan(pairPath(context, id), JSON.stringify({ ...record, archivedAt: new Date().toISOString() }) + "\n");
}

/**
 * Retain only current/archived document references, not a second progress journal.
 */
async function retireUnreferencedDocuments(context) {
  const current = await readWorkPlanUnlocked(context);
  const history = await readWorkPlanHistoryUnlocked(context);
  const records = [current, ...history].filter(Boolean);
  const retained = {
    plan: new Set(records.map(record => record.revision)),
    progress: new Set(records.map(record => record.progressRevision).filter(Boolean))
  };
  const retired = [];
  for (const kind of ["plan", "progress"]) {
    const directory = path.join(planDirectory(context), kind);
    let names;
    try {
      if (!(await lstat(directory)).isDirectory()) throw planError("Plan documents must not be stored through a link.", "vibe64_work_plan_documents_link");
      names = await readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.md$/u.test(name)) throw planError("Unknown plan document. Inspect the owned directory before cleanup.", "vibe64_work_plan_document_unknown");
      const revision = name.slice(0, 64);
      const file = documentPath(context, kind, revision);
      const text = await readPlanFile(file, { plainText: true });
      if (text === null || sha256Hex(text) !== revision) throw planError("A plan document has changed; cleanup refused.", "vibe64_work_plan_cleanup_refused");
      if (!retained[kind].has(revision)) retired.push(file);
    }
  }
  for (const file of retired) await rm(file);
}

async function withWorkPlan(context, operation) {
  return workPlanQueue.run(workPlanPath(context), operation);
}

function readWorkPlan(context) {
  return withWorkPlan(context, () => readWorkPlanUnlocked(context));
}
function readWorkPlanPage(context, options) {
  return withWorkPlan(context, () => readWorkPlanPageUnlocked(context, options));
}

/**
 * The helper derives role from the admitted turn, never from command payloads.
 */
async function manageWorkPlan(context, input, role) {
  return withWorkPlan(context, async () => {
    const {
      operation,
      expectedRevision = "",
      expectedProgressRevision = "",
      archiveId = "",
      archiveCurrent: acknowledgeArchive = false
    } = input;
    if (operation === "read") return readWorkPlanPageUnlocked(context, input);
    if (operation === "history") return { history: await readWorkPlanHistoryUnlocked(context) };
    if (!["new", "write", "progress-write", "complete", "archive", "reopen"].includes(operation)) {
      throw planError("Unknown plan operation.", "vibe64_work_plan_operation_unknown");
    }
    const canEdit = ["senior", "review"].includes(role) || (role === "junior" && ["write", "progress-write"].includes(operation)) ||
      (role === "user" && (operation === "archive" || (operation === "reopen" && Boolean(archiveId))));
    if (!canEdit) {
      throw planError(
        "Only Senior can change the scope, create, reopen, archive or complete a plan. Junior can update checklist ticks and Progress.",
        "vibe64_work_plan_senior_required"
      );
    }
    const current = await readWorkPlanUnlocked(context);
    if (current?.legacy) throw planError("This plan needs the stopped-service plan-progress upgrade before it can be changed.", "vibe64_work_plan_progress_upgrade_required");
    if (role === "user" && operation === "reopen" && current) {
      throw planError("There is already a current plan. Archive it before making another plan current.", "vibe64_work_plan_current_exists");
    }
    if (current && expectedRevision !== current.revision) {
      throw planError("The plan changed. Read the current plan before editing it.", "vibe64_work_plan_changed");
    }
    if (current && expectedProgressRevision !== (current.progressRevision || "")) {
      throw planError("Progress changed. Read both documents before editing them.", "vibe64_work_plan_progress_changed");
    }
    if (!current && expectedRevision) throw planError("There is no current plan at that revision.", "vibe64_work_plan_revision_missing");
    if (["write", "progress-write", "complete", "archive"].includes(operation) && !current) throw planError("There is no current plan.", "vibe64_work_plan_missing");
    if (["write", "progress-write"].includes(operation) && current.status !== "active") {
      throw planError("The plan is completed. Senior must explicitly reopen it before changes.", "vibe64_work_plan_completed");
    }
    let next;
    let progressText = operation === "new" ? "# Progress\n\n" : current?.progressText ?? null;
    switch (operation) {
      case "new":
      case "write": {
        const body = String(input.text || "").replace(/^Status: .*\r?\n?/gmu, "").trim();
        if (!/^# .+/mu.test(body) || !parseWorkPlanLines(body).some((item) => item.checked !== undefined)) {
          throw planError("A plan needs a title and Markdown checklists (- [ ] item). No other fixed structure is required.", "vibe64_work_plan_structure_invalid");
        }
        next = "Status: active\n" + body + "\n";
        if (Buffer.byteLength(next) > PLAN_LIMIT) throw planError("The plan is too large.", "vibe64_work_plan_too_large");
        if (role === "junior") {
          const scopes = [current.text, next].map(workPlanScope);
          if (scopes[0] !== scopes[1]) {
            throw planError(
              "Only Senior can change Plan content. Junior may change existing checklist ticks only; record evidence in Progress.",
              "vibe64_work_plan_content_senior_only"
            );
          }
        }
        break;
      }
      case "progress-write":
        next = current.text;
        progressText = String(input.text ?? "");
        if (Buffer.byteLength(progressText) > PLAN_LIMIT) throw planError("Progress is too large.", "vibe64_work_plan_progress_too_large");
        break;
      case "complete":
        if (!current.total) throw planError("A plan needs acceptance requirements before Senior can complete it.", "vibe64_work_plan_requirements_missing");
        next = current.text.replace(/^Status: active\r?$/mu, "Status: completed");
        break;
      case "reopen": {
        const saved = archiveId ? await readArchived(context, archiveId) : current;
        if (saved?.legacy) throw planError("This archive needs the stopped-service plan-progress upgrade before it can be reopened.", "vibe64_work_plan_archive_upgrade_required");
        if (!saved) throw planError("The requested plan snapshot is unavailable.", "vibe64_work_plan_snapshot_unavailable");
        progressText = saved.progressText;
        next = saved.text.replace(/^Status: completed\r?$/mu, "Status: active");
        break;
      }
    }
    const replacing = operation === "new" || (operation === "reopen" && Boolean(archiveId));
    if (replacing && current && !acknowledgeArchive) {
      throw planError(
        `Ask the user whether to update “${current.title}” or archive it and replace it. Explain that the archive remains accessible. Once the user has authorized replacement, repeat with archiveCurrent: true.`,
        "vibe64_work_plan_replacement_unconfirmed",
        { title: current.title }
      );
    }
    // Save the exact record before replacement. Content identity makes retry safe.
    if (current && (replacing || operation === "archive")) await archiveCurrent(context, current);
    if (operation === "archive") await rm(pairPath(context));
    else await publishPair(context, next, progressText);
    // Keep the original safe until the reopened current document is written.
    if (operation === "reopen" && archiveId) await rm(pairPath(context, archiveId));
    await retireUnreferencedDocuments(context);
    const result = await readWorkPlanPageUnlocked(context);
    if (current && (replacing || operation === "archive")) {
      result.notice = "Archived “" + current.title + "”. It remains available in Plan history.";
    }
    return result;
  });
}

/**
 * The plan guidance a main-chat turn receives for its role.
 * @param {string} role senior, review or junior
 * @param {{ autoOutcome?: boolean }} [options] autoOutcome: the turn is Auto's and reports a
 *   workflow outcome (planning, implementation or review), the only turns Senior's line about
 *   reporting unfinished review through the workflow outcome command applies to
 */
function workPlanInstructions(role, { autoOutcome = false } = {}) {
  const common = [
    "Apply this plan guidance when the user asks to create, discuss or work with a plan. Unrelated requests do not need a plan and must leave existing plans unchanged.",
    "A request to make, create, write or prepare a plan means save a Vibe64 checklist through vibe64-helper plan, unless the user explicitly asks for a chat-only draft or another format.",
    "The conversation has one current plan, active or completed, and preserved archived snapshots outside the project repository.",
    "Use vibe64-helper plan --help, then vibe64-helper plan read or history to inspect it. Use the plan helper for ALL edits and lifecycle operations; never edit its storage files directly or copy them into the repository.",
    "Plan commands take a JSON object on stdin. Writes require expectedRevision and expectedProgressRevision from the latest paired read. Read every page of BOTH text and progressText before working; a link is not a read. New/write take text containing a Markdown title and checklists (- [ ] / - [x]); other headings and structure are your choice.",
    "Keep the agreed Plan scope stable: start with a short summary of the proposed changes written for a nontechnical user, followed by a checklist of agreed deliverables and acceptance requirements. Then include a ## Technical details section containing a VERY detailed technical implementation plan that Junior can follow carefully: actual owners/files, ordered steps, constraints, edge cases and verification. The viewer collapses Technical details for the person, who can expand them; this is presentation only. Junior and review MUST read and follow the complete technical section, not just the summary/checklist. Update checklist ticks with write as each item is implemented and verified; do not wait until the whole plan or turn is finished. Leave partial or unverified items unchecked, and untick items when review finds missing evidence or a regression. Keep checklist wording and technical scope unchanged when updating ticks. Record supporting evidence and blockers in the paired Progress document with progress-write, then use its returned paired revisions for the checklist write. Do not append progress logs or evidence to Plan. The optional link in Plan is only a convenience; Plan and Progress are one artifact.",
    "Human instructions take precedence. Keep agreed scope and completed evidence; do not invent additional requirements. Discussion alone never changes plan status.",
    "Refer to View plan and Plan history in chat, not internal paths. Read archived plans on demand instead of loading all history. A completed plan remains accessible. A finished turn never completes a plan. After successful automatic final Senior review and any enabled Deslop and UI pass, Vibe64 archives the exact explicitly completed Plan and Progress once your final explanation is delivered and that review turn ends; do not archive it early during review.",
    "Only report a plan created or updated after the helper succeeds and its returned current plan confirms the requested checklist. If it fails, report the failure; a plan written only in chat is not a saved Vibe64 plan."
  ].join(" ");
  if (role === "junior") {
    return common +
      " You are Junior. When asked to implement the active plan, read all pages of BOTH Plan and Progress first, preserve delivered work, and record actual evidence using progress-write. You may use write to tick or untick existing checklist items only; the server rejects any other Plan content change. You cannot retarget the agreed Plan scope. Complete the authorised scope rather than stopping after a useful slice. Context compaction and task size do not reduce that scope. Continue independent work when one item needs a user decision. Record incomplete or failed work and exact blockers in Progress; lead a partial final response with Implementation incomplete, not Done. You cannot create, archive, reopen or complete the plan. If asked for those operations, explain that Senior must perform them; do not substitute a chat-only outline for a saved plan. Completed implementation in Auto receives a separate Senior review; in a Junior chat you do its finishing turn yourself and leave the plan active for Senior to complete. Do not ask the user to request that review or final completion. Stop for changed scope or unresolved product decisions; do not start a planning/review loop yourself.";
  }
  return common +
    " You are Senior and own the plan's scope and lifecycle. Read all pages of BOTH current Plan and Progress first. If none exists, use new. If a current plan exists and the user has not clearly chosen, ask whether to update it or archive it and start a new plan; wait for their answer before replacing it. Use write for an agreed update, reopen for an agreed return to a completed plan, archive when requested, and complete ONLY when every required acceptance item is supported by evidence. Before new or reopening an archived plan replaces a current plan, identify the plan that will be archived and explain that it remains accessible. Pass archiveCurrent:true only after the user authorizes that replacement; an explicit instruction to archive and replace already counts, so do not ask again. Reopening an archive moves it back to current as active, removing that entry from History while retaining the exact Plan and Progress pair. Replacement archives BOTH old documents and begins fresh Progress. During review, verify each agreed acceptance requirement against actual implementation and evidence. Reconcile checklist ticks against the evidence, unticking unsupported claims. Record missing verification and blockers in Progress without rewriting scope; fix in-scope defects and verify them. If review or checks remain unfinished, leave the plan active and continue authorised review." +
    (autoOutcome ? " In Auto, report continue through the workflow outcome command." : "") +
    " For substantial necessary rework within the agreed outcome, update the Technical details and Progress, then report handoff so Junior implements and Senior reviews again with any enabled Deslop and UI pass. Ask only when a genuinely changed product requirement or required decision blocks progress. Explicit pauses and Stops remain respected. Never invent requirements or mark unverified work completed. In a Senior chat the same workflow outcomes apply, and you do the finishing turn yourself.";
}

/**
 * Pure stopped-writer conversion; the original Runtime inventory/publisher owns paths and backups.
 */
function planProgressUpgradeChanges(files) {
  const saved = new Map(files.map(file => [file.name, file]));
  const changes = new Map();
  const find = name => changes.has(name) ? changes.get(name) : saved.get(name)?.text ?? null;
  const put = (name, text) => {
    const old = find(name);
    if (old !== null && old !== text) throw planError("A prepared plan-progress document conflicts with saved state.", "vibe64_work_plan_upgrade_document_conflict");
    if (old === null) changes.set(name, text);
  };
  const validatePlan = text => {
    if (Buffer.byteLength(text) > PLAN_LIMIT || !/^Status: (active|completed)\r?$/mu.test(text)) {
      throw planError("A legacy plan is malformed. Inspect it before upgrading.", "vibe64_work_plan_legacy_malformed");
    }
  };
  const validateRecord = (source, id = "") => {
    const record = parsePairRecord(source, id);
    const text = find("plan/" + record.planRevision + ".md");
    if (text === null || sha256Hex(text) !== record.planRevision) throw planError("The paired plan document is missing or changed.", "vibe64_work_plan_upgrade_plan_missing");
    validatePlan(text);
    if (record.progressRevision !== null) {
      const progress = find("progress/" + record.progressRevision + ".md");
      if (progress === null || Buffer.byteLength(progress) > PLAN_LIMIT || sha256Hex(progress) !== record.progressRevision) {
        throw planError("The paired progress document is missing or changed.", "vibe64_work_plan_upgrade_progress_missing");
      }
    }
    return record;
  };
  if (saved.has("current.json")) {
    validateRecord(saved.get("current.json").text);
    if (saved.has("current.md")) throw planError("Both current formats exist. Finish the original publication retry before upgrading.", "vibe64_work_plan_upgrade_current_conflict");
  } else if (saved.has("current.md")) {
    const text = saved.get("current.md").text;
    validatePlan(text);
    const planRevision = sha256Hex(text);
    put("plan/" + planRevision + ".md", text);
    put("current.json", JSON.stringify({ schemaVersion: 1, planRevision, progressRevision: null }) + "\n");
    changes.set("current.md", null);
  }
  for (const file of files.filter(entry => /^archive\/[a-f0-9]{64}\.md$/u.test(entry.name))) {
    validatePlan(file.text);
    const id = file.name.slice(8, 72);
    if (sha256Hex(file.text) !== id) throw planError("A legacy archive differs from its saved identity.", "vibe64_work_plan_legacy_archive_changed");
    const next = "archive/" + id + ".json";
    if (saved.has(next)) throw planError("Both archived formats exist. Finish the original publication retry before upgrading.", "vibe64_work_plan_upgrade_archive_conflict");
    put("plan/" + id + ".md", file.text);
    put(next, JSON.stringify({
      schemaVersion: 1,
      planRevision: id,
      progressRevision: null,
      legacyArchive: true,
      archivedAt: file.archivedAt
    }) + "\n");
    changes.set(file.name, null);
  }
  for (const file of files.filter(entry =>
    /^archive\/[a-f0-9]{64}\.json$/u.test(entry.name))) validateRecord(file.text, file.name.slice(8, 72));
  return Array.from(changes, ([name, text]) => ({ name, text }));
}

const __testables = Object.freeze({ workPlanPath });

export {
  readWorkPlan,
  readWorkPlanPage,
  manageWorkPlan,
  workPlanInstructions,
  planProgressUpgradeChanges,
  __testables
};

import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { parseWorkPlanLines, workPlanScope, workPlanStep } from "../shared/assistantWorkPlan.js";
import { writeFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { createKeyedQueue } from "@local/vibe64-core/server/keyedOperations";
import { sha256Hex } from "@local/vibe64-core/server/sha256Hex";
import { PLAN_LIMIT, planError, planFileError, planFileProblem, readPlanFile, withPlanFileProblems } from "./assistantWorkPlanFiles.js";

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

// A refusal names at most this many unproven items, each cut to this many characters.
const UNPROVEN_NAMED = 8;
const UNPROVEN_ITEM_CHARACTERS = 120;

/** Completion's refusal while checklist items are not yet proven: it names each one and its mark. */
function unprovenItemsError(items) {
  const named = items.slice(0, UNPROVEN_NAMED).map((item) => {
    const characters = Array.from(item.text.trim());
    const text = characters.length > UNPROVEN_ITEM_CHARACTERS
      ? characters.slice(0, UNPROVEN_ITEM_CHARACTERS - 1).join("") + "…"
      : characters.join("");
    return `“${text}” (${item.built ? "built, not yet proven" : "not done yet"})`;
  });
  const more = items.length > named.length ? `, and ${items.length - named.length} more` : "";
  return planError(
    `Senior can complete the plan only when every checklist item is proven (- [x]). Not yet proven: ${named.join(", ")}${more}. ` +
      "Full-tick each item once the plan's final proof covers it, or leave the plan active and record the gaps in Progress.",
    "vibe64_work_plan_items_unproven",
    { count: items.length }
  );
}

/**
 * Whether the next plan text differs from the current one only in the
 * checklist ticks the role may change (the caller compares their scope).
 * @param {string} current
 * @param {string} next
 * @param {(item: { text: string, passes?: boolean }) => boolean} mayTick
 */
function changesOnlyTicks(current, next, mayTick) {
  const before = parseWorkPlanLines(current);
  const after = parseWorkPlanLines(next);
  return before.every((line, index) => line.checked === undefined || mayTick(line) ||
    line.checked === after[index].checked && line.built === after[index].built);
}

function workPlanPath(context) {
  const paths = context.runtime.store.paths(context.session.sessionId);
  const id = context.routingConversationId;
  if (id && !/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) throw planError("Invalid plan conversation.", "vibe64_work_plan_conversation_invalid");
  return path.join(id ? path.join(paths.conversationsRoot, id) : paths.sessionRoot, "plans", "current.md");
}

function planDirectory(context) {
  return path.dirname(workPlanPath(context));
}
function pairPath(context, id = "") {
  if (id && !/^[a-f0-9]{64}$/u.test(id)) throw planError("Invalid archived plan identity.", "vibe64_work_plan_archive_id_invalid");
  return id ? path.join(planDirectory(context), "archive", id + ".json") : path.join(planDirectory(context), "current.json");
}
// When the AI last brought the current plan up to date: it wrote the ticks or Progress (or the plan), or checked
// the plan and found nothing to change. It keeps the session's source as it was then, so the plan view can say how
// many files changed since. A plan replaced or archived drops it.
const MARK_LIMIT = 1024 * 1024;
const MARK_HOWS = Object.freeze(["updated", "checked"]);
function markPath(context) {
  return path.join(planDirectory(context), "updated.json");
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
/**
 * The current plan's mark, or null when none is kept (a plan the AI has not updated or checked since it became current).
 * @returns {Promise<{ at: string, how: "updated" | "checked", source: object | null } | null>}
 */
async function readMark(context) {
  const invalid = () => planError("The plan's update record is invalid. Inspect it before continuing.", "vibe64_work_plan_mark_invalid");
  const source = await readPlanFile(markPath(context), { plainText: true, limit: MARK_LIMIT }).catch((error) => {
    // A link, a folder or an oversized file in its place is an invalid record, as unreadable JSON is.
    throw ["vibe64_work_plan_file_invalid", "vibe64_work_plan_too_large"].includes(error?.code) ? invalid() : error;
  });
  if (source === null) return null;
  let mark;
  try {
    mark = JSON.parse(source);
  } catch {
    mark = null;
  }
  if (!mark || mark.schemaVersion !== 1 || !Number.isFinite(Date.parse(mark.at)) || !MARK_HOWS.includes(mark.how) ||
      (mark.source !== null && (typeof mark.source !== "object" || !Array.isArray(mark.source.repositories)))) {
    throw invalid();
  }
  return { at: mark.at, how: mark.how, source: mark.source };
}
async function writeMark(context, how, source) {
  const mark = { schemaVersion: 1, at: source?.at || new Date().toISOString(), how, source: source || null };
  let text = JSON.stringify(mark) + "\n";
  // A source too large to record keeps only when: the plan view then counts no files since.
  if (Buffer.byteLength(text) > MARK_LIMIT) text = JSON.stringify({ ...mark, source: null }) + "\n";
  await writePlan(markPath(context), text);
}
async function readPair(context, id = "") {
  const source = await readPlanFile(pairPath(context, id), { plainText: true });
  if (source === null) return null;
  const record = parsePairRecord(source, id);
  const plan = await readPlanFile(documentPath(context, "plan", record.planRevision));
  const progressText = record.progressRevision === null
    ? null
    : await readPlanFile(documentPath(context, "progress", record.progressRevision), { plainText: true });
  // The refusal names the document that is missing or changed.
  const broken = !plan || plan.revision !== record.planRevision
    ? documentPath(context, "plan", record.planRevision)
    : record.progressRevision !== null && (progressText === null || sha256Hex(progressText) !== record.progressRevision)
      ? documentPath(context, "progress", record.progressRevision)
      : "";
  if (broken) {
    throw planError(
      `The plan document ${broken} is missing or changed. Restore the saved pair before continuing.`,
      "vibe64_work_plan_pair_missing",
      { path: broken, problem: "it is missing or no longer matches its saved plan" }
    );
  }
  return {
    ...plan,
    progressText,
    progressRevision: record.progressRevision,
    artifactRevision: pairIdentity(record),
    ...(record.archivedAt ? { archivedAt: record.archivedAt } : {})
  };
}
/** When a current plan file was last written, or "" when it is gone. */
async function savedAt(file) {
  const info = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  return info ? info.mtime.toISOString() : "";
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
/**
 * Plan history: each archived plan's summary, newest first, and the plan files it could not use. An archived plan
 * whose record or documents Vibe64 cannot read or trust is left out and named instead (`problems`), so one bad file
 * never stops the plan.
 * @returns {Promise<{ history: object[], problems: { path: string, problem: string }[] }>}
 */
async function readWorkPlanHistoryUnlocked(context) {
  try {
    if (!(await lstat(planDirectory(context))).isDirectory()) throw planError("The plan directory must not be a link.", "vibe64_work_plan_directory_link");
  } catch (error) {
    if (error.code === "ENOENT") return { history: [], problems: [] };
    throw error;
  }
  const directory = path.join(planDirectory(context), "archive");
  let entries;
  try {
    if (!(await lstat(directory)).isDirectory()) throw planError("Plan history must not be a link.", "vibe64_work_plan_history_link");
    entries = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return { history: [], problems: [] };
    throw planFileError(directory, error);
  }
  const ids = new Set(entries.filter(name => /^[a-f0-9]{64}\.(md|json)$/u.test(name)).map(name => name.slice(0, 64)));
  const problems = [];
  const read = await Promise.all([...ids].map(id => readArchivedSummary(context, id).catch((error) => {
    problems.push({ path: error.params?.path || pairPath(context, id), problem: planFileProblem(error) });
    return null;
  })));
  const history = read.filter(Boolean).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  return { history, problems: problems.sort((a, b) => a.path.localeCompare(b.path)) };
}
/**
 * The current plan's summary carries its step, read from the plan each time, for the chat's status line, and when it
 * was last brought up to date: when the AI last updated its ticks or Progress, or checked it (updatedHow "updated" or
 * "checked"), otherwise when the plan was last saved ("saved").
 */
async function currentPlanSummary(context, current) {
  if (!current) return null;
  // An unreadable record, an invalid one or one Vibe64 is not allowed to read, leaves when unknown, never the plan
  // unreadable: the AI's next change writes a new one.
  const mark = await readMark(context).catch((error) => (
    ["vibe64_work_plan_mark_invalid", "vibe64_work_plan_file_unreadable"].includes(error?.code) ? false : Promise.reject(error)
  ));
  const saved = mark === null ? await savedAt(current.legacy ? workPlanPath(context) : pairPath(context)) : "";
  return {
    title: current.title,
    status: current.status,
    revision: current.revision,
    progressRevision: current.progressRevision || "",
    step: workPlanStep(current),
    updatedAt: mark ? mark.at : saved,
    updatedHow: mark ? mark.how : mark === null ? "saved" : ""
  };
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
    const { history, problems } = await readWorkPlanHistoryUnlocked(context);
    return withPlanFileProblems({ available: Boolean(current), current: await currentPlanSummary(context, current), history }, problems);
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) {
    throw planError("Invalid plan page bounds.", "vibe64_work_plan_page_bounds_invalid");
  }
  if (offset > 0 && !expectedRevision) {
    throw planError("Further plan pages require the revision from the first page.", "vibe64_work_plan_revision_required");
  }
  const current = await readWorkPlanUnlocked(context);
  const plan = archiveId ? await readArchived(context, archiveId) : current;
  const { history, problems } = offset === 0 ? await readWorkPlanHistoryUnlocked(context) : { problems: [] };
  const summary = await currentPlanSummary(context, current);
  if (!plan) return withPlanFileProblems({ available: false, current: summary, ...(history ? { history } : {}) }, problems);
  if (expectedRevision && expectedRevision !== plan.revision || (offset > 0 || expectedProgressRevision) &&
      expectedProgressRevision !== (plan.progressRevision || "")) {
    throw planError("The plan or progress changed. Read both again from the beginning.", "vibe64_work_plan_read_changed");
  }
  const characters = Array.from(plan.text);
  const progress = Array.from(plan.progressText || "");
  const totalCharacters = characters.length + progress.length;
  if (offset > totalCharacters) throw planError("The plan page begins after the end of the document.", "vibe64_work_plan_offset_invalid");
  const nextOffset = Math.min(offset + limit, totalCharacters);
  return withPlanFileProblems({
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
    hasMore: nextOffset < totalCharacters,
    ...(nextOffset >= totalCharacters && !archiveId && plan.artifactRevision ? { readThrough: readThroughOf(plan) } : {})
  }, problems);
}

// What only a read's last page, or a write's answer, gives: proof that Plan and Progress were read through to the end.
const readThroughOf = (plan) => sha256Hex("vibe64-plan-read-through-v1\0" + plan.artifactRevision);

async function writePlan(file, text) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw planError("The plan directory must not be a link.", "vibe64_work_plan_directory_link");
  await writeFileAtomic(file, text, { fileMode: 0o600 });
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
 * Retain only current/archived document references, not a second progress journal. A file cleanup cannot read or
 * does not recognise is kept and named, and while an archived plan cannot be read nothing is retired at all, since
 * its documents may be among them; the plan's change goes on either way.
 * @returns {Promise<{ path: string, problem: string }[]>} the plan files cleanup skipped
 */
async function retireUnreferencedDocuments(context) {
  const current = await readWorkPlanUnlocked(context);
  const { history, problems } = await readWorkPlanHistoryUnlocked(context);
  if (problems.length) return problems;
  const records = [current, ...history].filter(Boolean);
  const retained = {
    plan: new Set(records.map(record => record.revision)),
    progress: new Set(records.map(record => record.progressRevision).filter(Boolean))
  };
  const retired = [];
  const skipped = [];
  for (const kind of ["plan", "progress"]) {
    const directory = path.join(planDirectory(context), kind);
    let names;
    try {
      if (!(await lstat(directory)).isDirectory()) throw planError("Plan documents must not be stored through a link.", "vibe64_work_plan_documents_link");
      names = await readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw planFileError(directory, error);
    }
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.md$/u.test(name)) {
        skipped.push({ path: path.join(directory, name), problem: "it is not a plan document, so cleanup leaves it" });
        continue;
      }
      const revision = name.slice(0, 64);
      const file = documentPath(context, kind, revision);
      let text;
      try {
        text = await readPlanFile(file, { plainText: true });
      } catch (error) {
        skipped.push({ path: file, problem: planFileProblem(error) });
        continue;
      }
      if (text === null) continue;
      if (sha256Hex(text) !== revision) {
        skipped.push({ path: file, problem: "it no longer matches its saved content, so cleanup leaves it" });
        continue;
      }
      if (!retained[kind].has(revision)) retired.push(file);
    }
  }
  for (const file of retired) {
    try {
      await rm(file);
    } catch (error) {
      skipped.push({ path: file, problem: `cleanup could not remove it (${error.code || error.message})` });
    }
  }
  return skipped.sort((a, b) => a.path.localeCompare(b.path));
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

// The AI's changes that bring the plan up to date, which record the source as it is then (the plan's mark).
const MARKING_OPERATIONS = Object.freeze(["new", "write", "progress-write", "reopen", "checked"]);

// The fields each operation reads. Any other is refused, never ignored: a text sent under a name the operation does not
// read would otherwise be accepted and keep nothing.
const PAIRED = ["expectedRevision", "expectedProgressRevision"];
const OPERATION_FIELDS = Object.freeze({
  read: ["offset", "limit", ...PAIRED, "archiveId"],
  history: [],
  new: ["text", ...PAIRED, "archiveCurrent"],
  write: ["text", ...PAIRED, "readThrough"],
  "progress-write": ["text", ...PAIRED, "readThrough"],
  checked: PAIRED,
  complete: PAIRED,
  archive: PAIRED,
  reopen: [...PAIRED, "archiveId", "archiveCurrent"]
});
// What an operation's text is: the whole new Plan, or the whole new Progress.
const TEXT_OPERATIONS = Object.freeze({
  new: "Plan",
  write: "Plan",
  "progress-write": "Progress"
});

/** Refuses a field the operation does not read, and a text operation's missing or empty text, naming what it takes. */
function refuseUnreadInput(input) {
  const { operation } = input;
  const fields = OPERATION_FIELDS[operation];
  if (!fields) return;
  const unread = Object.keys(input).filter((name) => name !== "operation" && !fields.includes(name));
  if (unread.length) {
    const takes = fields.join(", ") || "no input";
    throw planError(
      `plan ${operation} does not read ${unread.join(", ")}: nothing changed. It takes ${takes}.`,
      "vibe64_work_plan_input_unknown",
      { unread, fields }
    );
  }
  if (TEXT_OPERATIONS[operation] && (typeof input.text !== "string" || !input.text.trim())) {
    const where = operation === "progress-write" ? " A read returns the current Progress as progressText." : "";
    const message = `plan ${operation} takes the whole new ${TEXT_OPERATIONS[operation]} as text, a string that is not empty: nothing changed.${where}`;
    throw planError(message, "vibe64_work_plan_text_required");
  }
}

/**
 * The helper derives role from the admitted turn, never from command payloads. A plan's pass turn
 * ("pass") may write Progress and change only its own Passes item's tick (passItem); Junior may
 * change the ticks outside Passes. Any role that may tick may record that it checked the plan and
 * found nothing to change (checked). With `sourceState`, the AI's change records the session's
 * source as it is now as the plan's mark (MARKING_OPERATIONS); a plan replaced or archived drops it.
 * With `agent` (the agent's plan command), write and progress-write need the readThrough a read's last page or the
 * last write returned: never text built from a first page alone.
 * @param {object} context
 * @param {object} input
 * @param {string} role senior, review, junior, pass or user
 * @param {{ passItem?: string, sourceState?: () => Promise<object | null>, agent?: boolean }} [options]
 */
async function manageWorkPlan(context, input, role, { passItem = "", sourceState, agent = false } = {}) {
  // Read before the plan's queue: Git's status of the source takes longer than the plan's own reads.
  const marking = Boolean(sourceState) && MARKING_OPERATIONS.includes(input.operation);
  const source = marking ? await sourceState().catch(() => null) : null;
  return withWorkPlan(context, async () => {
    const {
      operation,
      expectedRevision = "",
      expectedProgressRevision = "",
      archiveId = "",
      archiveCurrent: acknowledgeArchive = false
    } = input;
    if (["read", "history"].includes(operation)) refuseUnreadInput(input);
    if (operation === "read") return readWorkPlanPageUnlocked(context, input);
    if (operation === "history") {
      const { history, problems } = await readWorkPlanHistoryUnlocked(context);
      return withPlanFileProblems({ history }, problems);
    }
    if (!["new", "write", "progress-write", "checked", "complete", "archive", "reopen"].includes(operation)) {
      throw planError("Unknown plan operation.", "vibe64_work_plan_operation_unknown");
    }
    const canEdit = ["senior", "review"].includes(role) ||
      (["junior", "pass"].includes(role) && ["write", "progress-write", "checked"].includes(operation)) ||
      (role === "user" && (operation === "archive" || (operation === "reopen" && Boolean(archiveId))));
    if (!canEdit) {
      throw planError(
        "Only Senior can change the scope, create, reopen, archive or complete a plan. Junior can update checklist ticks and Progress.",
        "vibe64_work_plan_senior_required"
      );
    }
    refuseUnreadInput(input);
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
    if (agent && current && ["write", "progress-write"].includes(operation) && input.readThrough !== readThroughOf(current)) {
      const fix = "read every page of Plan and Progress (follow nextOffset while hasMore), then write from all of them. Nothing changed.";
      throw planError(
        `plan ${operation} replaces the whole ${TEXT_OPERATIONS[operation]}, so it needs readThrough from the read's last page or your last write's answer: ${fix}`,
        "vibe64_work_plan_read_through_required"
      );
    }
    if (!current && expectedRevision) throw planError("There is no current plan at that revision.", "vibe64_work_plan_revision_missing");
    if (["write", "progress-write", "checked", "complete", "archive"].includes(operation) && !current) throw planError("There is no current plan.", "vibe64_work_plan_missing");
    if (["write", "progress-write", "checked"].includes(operation) && current.status !== "active") {
      throw planError("The plan is completed. Senior must explicitly reopen it before changes.", "vibe64_work_plan_completed");
    }
    let next;
    let progressText = operation === "new" ? "# Progress\n\n" : current?.progressText ?? null;
    switch (operation) {
      case "new":
      case "write": {
        const body = input.text.replace(/^Status: .*\r?\n?/gmu, "").trim();
        if (!/^# .+/mu.test(body) || !parseWorkPlanLines(body).some((item) => item.checked !== undefined)) {
          throw planError("A plan needs a title and Markdown checklists (- [ ] item). No other fixed structure is required.", "vibe64_work_plan_structure_invalid");
        }
        next = "Status: active\n" + body + "\n";
        if (Buffer.byteLength(next) > PLAN_LIMIT) throw planError("The plan is too large.", "vibe64_work_plan_too_large");
        if (role === "pass" && (workPlanScope(current.text) !== workPlanScope(next) ||
            !changesOnlyTicks(current.text, next, (item) => item.passes && item.text === passItem))) {
          throw planError(
            "A pass changes only its own Passes item's tick in Plan. Record findings, questions, choices and Leftovers in Progress.",
            "vibe64_work_plan_pass_item_only"
          );
        }
        if (role === "junior") {
          const scopes = [current.text, next].map((text) => workPlanScope(text));
          if (scopes[0] !== scopes[1]) {
            throw planError(
              "Only Senior can change Plan content. Junior may change existing checklist ticks only (- [ ], - [~] or - [x]); record evidence in Progress.",
              "vibe64_work_plan_content_senior_only"
            );
          }
          if (!changesOnlyTicks(current.text, next, (item) => !item.passes)) {
            throw planError(
              "Only a plan's own pass turn ticks its Passes items. Junior may change the other checklist ticks; record evidence in Progress.",
              "vibe64_work_plan_pass_ticks_refused"
            );
          }
        }
        break;
      }
      case "checked":
        // The plan stays exactly as it is: only its mark records that it was checked.
        await writeMark(context, "checked", source);
        return { ...await readWorkPlanPageUnlocked(context), notice: "Recorded that the plan was checked: its marks and Progress stay as they are." };
      case "progress-write":
        next = current.text;
        progressText = input.text;
        if (Buffer.byteLength(progressText) > PLAN_LIMIT) throw planError("Progress is too large.", "vibe64_work_plan_progress_too_large");
        break;
      case "complete": {
        if (!current.total) throw planError("A plan needs acceptance requirements before Senior can complete it.", "vibe64_work_plan_requirements_missing");
        const unproven = parseWorkPlanLines(current.text).filter((item) => item.checked === false);
        if (unproven.length) throw unprovenItemsError(unproven);
        next = current.text.replace(/^Status: active\r?$/mu, "Status: completed");
        break;
      }
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
    // The mark belongs to the plan it was made for.
    if (replacing || operation === "archive") await rm(markPath(context), { force: true });
    if (operation === "archive") await rm(pairPath(context));
    else await publishPair(context, next, progressText);
    if (marking) await writeMark(context, "updated", source);
    // Keep the original safe until the reopened current document is written.
    if (operation === "reopen" && archiveId) await rm(pairPath(context, archiveId));
    const skipped = await retireUnreferencedDocuments(context);
    const page = await readWorkPlanPageUnlocked(context);
    const known = new Set((page.planFileProblems || []).map(problem => problem.path));
    const result = withPlanFileProblems(page, [...(page.planFileProblems || []), ...skipped.filter(problem => !known.has(problem.path))]);
    // The writer read both documents through and wrote one of them whole: its next write needs no new read.
    if (["write", "progress-write"].includes(operation)) result.readThrough = readThroughOf(result);
    if (current && (replacing || operation === "archive")) {
      result.notice = "Archived “" + current.title + "”. It remains available in Plan history.";
    }
    return result;
  });
}

/**
 * The plan guidance a main-chat turn receives for its role.
 * @param {string} role senior, review or junior
 * @param {{ autoOutcome?: boolean, auto?: boolean }} [options] autoOutcome: the turn is Auto's and reports a
 *   workflow outcome (planning, implementation or review), the only turns Senior's line about
 *   reporting unfinished review through the workflow outcome command applies to; auto: the turn is
 *   Auto's, where Junior hands a plan change it may not make to Senior (plan handoff) rather than back to the person
 */
function workPlanInstructions(role, { autoOutcome = false, auto = false } = {}) {
  const common = [
    "Apply this plan guidance when the user asks to create, discuss or work with a plan. Unrelated requests do not need a plan and must leave existing plans unchanged.",
    "A request to make, create, write or prepare a plan means save a Vibe64 checklist through vibe64-helper plan, unless the user explicitly asks for a chat-only draft or another format.",
    "The conversation has one current plan, active or completed, and preserved archived snapshots outside the project repository.",
    "Use vibe64-helper plan --help, then vibe64-helper plan read or history to inspect it. Use the plan helper for ALL edits and lifecycle operations; never edit its storage files directly or copy them into the repository.",
    "Plan commands take a JSON object on stdin. Writes require expectedRevision and expectedProgressRevision from the latest paired read. write and progress-write replace the whole Plan or Progress, so build them from every page and pass readThrough: only the read's last page (hasMore false) returns it, and so does each write's answer. Read every page of BOTH text and progressText before working; a link is not a read. New/write take text containing a Markdown title and checklists (- [ ] / - [~] / - [x]); other headings and structure are your choice. progress-write takes the whole new Progress as text too, never as progressText.",
    "Keep the agreed Plan scope stable: start with a short summary of the proposed changes written for a nontechnical user, followed by a checklist of agreed deliverables and acceptance requirements; when one item is a foundation that others build on, split it or say so in the item, so the marks can move as the work goes. Then include a ## Technical details section containing a VERY detailed technical implementation plan that Junior can follow carefully: actual owners/files, ordered steps, constraints, edge cases and verification. The viewer collapses Technical details for the person, who can expand them; this is presentation only. Junior and review MUST read and follow the complete technical section, not just the summary/checklist. Each checklist item carries one of three marks: - [ ] not done yet, - [~] built (implemented, and its own focused checks pass) and - [x] proven by the plan's final checks. Update checklist ticks with write as you go; do not wait until the whole plan or turn is finished. Half-tick each item (- [~]) as soon as it is implemented and its own focused checks pass, and full-tick it (- [x]) when the plan's final proof covers it: the whole run, the review or the proof the plan states. Never leave a built item empty: tick each item the moment it is built and its own checks pass, not at the end of the turn, and the last item too before your turn ends. When work on one item also builds others, walk the whole checklist: half-tick each item that is built and checked, note in Progress what is partly built, and never hold every tick until the first item is finished. When a turn changed files but not the marks or Progress, Vibe64's plan check asks you once to walk the checklist and update them, or to run plan checked (paired revisions, nothing changes) when nothing needs a new mark; in Auto and in a Senior chat, Senior's review of the plan follows when every item is built or the check left the plan unchanged, and when every item is built and your turn ends without reporting continue, also if it asked the person something. An item built whose remaining proof can't run in this session (a real phone, a suite only CI runs) is half-ticked (- [~]) with what is unproven and why in Progress; never end your turn asking about it: Senior's review asks the person, as a numbered question with a recommended answer. A partial item stays - [ ]; an item whose evidence is missing or that regressed moves back to - [~] or - [ ], including when review finds it. Keep checklist wording and technical scope unchanged when updating ticks. Record supporting evidence and blockers in the paired Progress document with progress-write, then use its returned paired revisions for the checklist write. Do not append progress logs or evidence to Plan. The optional link in Plan is only a convenience; Plan and Progress are one artifact.",
    "Human instructions take precedence. Keep agreed scope and completed evidence; do not invent additional requirements. Discussion alone never changes plan status.",
    "Refer to View plan and Plan history in chat, not internal paths. Read archived plans on demand instead of loading all history. A completed plan remains accessible. A finished turn never completes a plan.",
    "A plan's steps are Implementation, Senior review, Passes and Completed. Its last section, ## Passes, lists the passes it runs after Senior's review, one checklist item each (- [ ] <pass title>: <scope>, such as - [ ] Security pass: the plan's changes). Vibe64 writes it from the chat's After a plan ticks when the plan is created and adds the passes the person starts; keep it last, and change it only when the person asks to change this plan's passes. Once every item outside Passes is - [x], Vibe64 runs each unticked Passes item in its own Senior turn, then completes and archives the exact Plan and Progress; do not archive it yourself. Never ask the person whether to run the plan's passes or Save, or whether to save before the passes: the passes are the plan's next step and Vibe64 runs them, then saves the work when the plan completes.",
    "Progress holds the plan's one Leftovers list: what is outside the plan's scope or can't be done here, never fixed or mixed in. When the person says not to ask and to pick your recommendation, for this plan or this run, record that in Progress with the time: every later step reads it, picks the recommended answer and records the choice in Progress instead of waiting.",
    "Only report a plan created or updated after the helper succeeds and its returned current plan confirms the requested checklist. If it fails, report the failure; a plan written only in chat is not a saved Vibe64 plan."
  ].join(" ");
  if (role === "junior") {
    return common +
      " You are Junior. When asked to implement the active plan, read all pages of BOTH Plan and Progress first, preserve delivered work, and record actual evidence using progress-write. You may use write to change existing checklist marks among - [ ], - [~] and - [x] outside the Passes section only; the server rejects any other Plan content change. You cannot retarget the agreed Plan scope. Complete the authorised scope rather than stopping after a useful slice. Context compaction and task size do not reduce that scope. Continue independent work when one item needs a user decision. Record incomplete or failed work and exact blockers in Progress; lead a partial final response with Implementation incomplete, not Done. You cannot create, archive, reopen or complete the plan." +
      (auto
        ? " In Auto, when the request asks to make, change, extend, reopen or archive a plan, write nothing, not even a draft or an outline: run vibe64-helper plan handoff and end your turn with one short line saying Senior is making the plan. Vibe64 continues this request as Senior's planning turn, which writes the plan from the request and the conversation. Never tell the person to switch modes or to ask Senior. Senior also checks the plan in its own turn after your implementation."
        : " In a Junior chat, if asked for those operations, write nothing, not even a chat-only outline, and tell the person that plans need Senior or Auto, which they choose in Chat mode. Leave the plan active for Senior to review.") +
      " Do not ask the user to request that check or final completion. Stop for changed scope or unresolved product decisions; do not start a planning/review loop yourself.";
  }
  return common +
    " You are Senior and own the plan's scope and lifecycle. Read all pages of BOTH current Plan and Progress first. If none exists, use new. If a current plan exists and the user has not clearly chosen, ask whether to update it or archive it and start a new plan; wait for their answer before replacing it. Use write for an agreed update, reopen for an agreed return to a completed plan, archive when requested, and complete ONLY when every checklist item is - [x] and every required acceptance item is supported by evidence; the server refuses completion while any item is - [ ] or - [~]. A plan with Passes items is never yours to complete: your review ends with every item outside Passes - [x] and the plan active, and Vibe64 runs its passes and completes it. Before new or reopening an archived plan replaces a current plan, identify the plan that will be archived and explain that it remains accessible. Pass archiveCurrent:true only after the user authorizes that replacement; an explicit instruction to archive and replace already counts, so do not ask again. Reopening an archive moves it back to current as active, removing that entry from History while retaining the exact Plan and Progress pair. Replacement archives BOTH old documents and begins fresh Progress. During review, verify each agreed acceptance requirement against actual implementation and evidence. Reconcile checklist ticks against the evidence: full-tick what the plan's final proof covers, and move unsupported or regressed claims back to - [~] or - [ ]. Record missing verification and blockers in Progress without rewriting scope; fix in-scope defects and verify them. If review or checks remain unfinished, leave the plan active and continue authorised review." +
    (autoOutcome ? " In Auto, report continue through the workflow outcome command." : "") +
    " For substantial necessary rework within the agreed outcome, update the Technical details and Progress, then report handoff so Junior implements and Senior checks the plan again. Ask only when a genuinely changed product requirement or required decision blocks progress. Explicit pauses and Stops remain respected. Never invent requirements or mark unverified work completed. In a Senior chat the same workflow outcomes apply: you implement, verify and complete the plan yourself.";
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

/** The current plan's mark (see readMark), read in the plan's queue. */
function readWorkPlanMark(context) {
  return withWorkPlan(context, () => readMark(context));
}

export {
  readWorkPlan,
  readWorkPlanMark,
  readWorkPlanPage,
  manageWorkPlan,
  workPlanInstructions,
  planProgressUpgradeChanges,
  __testables
};

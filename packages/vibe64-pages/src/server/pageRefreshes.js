// Scheduled page refreshes, owned by Vibe64's server. One timer waits for the
// next refresh due in any project; nothing else runs between refreshes. A
// command refresh runs the page's script in a throwaway checkout of the saved
// project, with no AI. A prompt refresh is an AI task in the session the
// refresh was set from, followed until it ends. Either way only the page's
// data.json changes, so a refresh cannot break the layout, and a failure keeps
// the last good version.
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { projectCommandRequest } from "@local/vibe64-packaging/server/projectCommands";

import { logTail } from "./pageRefreshRecords.js";
import { nextRefreshAt } from "./pageRefreshSchedule.js";
import { readSavedSource, withSavedCheckout } from "./pageRefreshSource.js";
import { currentProjectPages, pageFolder } from "./pageStore.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").PageRefreshTasks} PageRefreshTasks */

const COMMAND_TIMEOUT_MS = 5 * 60_000;
const FAILURES_TO_PAUSE = 3;
const LONGEST_WAIT_MS = 6 * 60 * 60_000;
const DATA_SHOWN_TO_AI = 16 * 1024;
// Where command refreshes' throwaway checkouts live, inside the project's pages folder.
const SCRATCH_DIR = ".refresh-runs";
const INTERPRETERS = Object.freeze({ ".mjs": "node", ".js": "node", ".cjs": "node", ".py": "python3", ".sh": "bash" });

// What a host that decides nothing allows: the person who set a refresh may always run it, an AI
// refresh's task starts with no person, as a task the local person starts from the browser does,
// and refresh scripts run.
const LOCAL_HOST = Object.freeze({ runAs: async () => ({ user: null, blocked: "" }), scriptRefusal: "" });

const keyOf = (slug, pageId) => `${slug}/${pageId}`;
const failure = (message, log = "") => ({ outcome: "failed", message, log });

function runRefusal(message, code) {
  return vibe64Error(message, code, { status: 409 });
}

/**
 * Why a command refresh's run failed, in a person's words.
 * @param {{ timedOut?: boolean, exitCode?: number | null, error?: string }} result
 */
function commandFailure(result) {
  if (result.timedOut) return "The refresh script ran for more than 5 minutes and was stopped.";
  if (Number.isInteger(result.exitCode)) return `The refresh script stopped with exit status ${result.exitCode}.`;
  return `The refresh script could not run: ${String(result.error || "it did not start")}.`;
}

/**
 * The new data a script wrote, checked: present, JSON, and not larger than a page allows.
 * @param {Buffer | null} data
 */
function dataProblem(data) {
  if (!data) return "The refresh script wrote no data. It writes the page's new data.json to the file $VIBE64_PAGE_DATA names.";
  try {
    JSON.parse(data.toString("utf8"));
  } catch (error) {
    return `The refresh script's data.json is not valid JSON: ${error.message}`;
  }
  return "";
}

/**
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {ReturnType<typeof import("./pageStore.js").createPageStore>} dependencies.store
 * @param {ReturnType<typeof import("./pageRefreshRecords.js").createPageRefreshRecords>} dependencies.records
 * @param {(pagesRoot: string, pageId: string, data: Buffer, by: object, sessionId: string) => Promise<object>} dependencies.writeData
 * @param {RuntimeLogger} dependencies.logger
 * @param {() => number} dependencies.clock
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 * @param {number} [dependencies.taskPollMs] how often a running prompt refresh's task is read
 */
function createPageRefreshes({ project, store, records, writeData, logger, clock, runCommand = runVibe64Command, taskPollMs = 10_000 }) {
  const due = new Map();
  // The runs this server is starting, or running a script for: cancelling one aborts it.
  const stops = new Map();
  // The prompt refreshes whose AI task is followed until it ends.
  const watched = new Map();
  let tasks = null;
  let host = LOCAL_HOST;
  let timer = null;
  let pollTimer = null;
  let closed = false;
  const iso = (ms) => new Date(ms).toISOString();

  function warn(event, error, fields = {}) {
    logOperationalEvent(logger, "warn", {
      component: "vibe64.pages", event: `vibe64.pages.refresh.${event}`, code: error?.code, error: error?.message, ...fields
    }, "A page refresh did not go as planned.");
  }

  function arm() {
    clearTimeout(timer);
    timer = null;
    if (closed || !due.size) return;
    const wait = Math.min(Math.max(0, Math.min(...due.values()) - clock()), LONGEST_WAIT_MS);
    timer = setTimeout(() => {
      timer = null;
      void fire();
    }, wait);
    timer.unref();
  }

  /**
   * Keeps the next time this page refreshes, or forgets it while it can't.
   * @param {string} slug
   * @param {string} pageId
   * @param {object | null} record
   * @param {{ archived: boolean } | null} page
   */
  function track(slug, pageId, record, page) {
    const key = keyOf(slug, pageId);
    if (record && !record.paused && page && !page.archived) due.set(key, Date.parse(record.nextAt));
    else due.delete(key);
    arm();
  }

  async function readPage(pagesRoot, pageId) {
    return store.read(pagesRoot, pageId).catch((error) => {
      if (error?.code === "vibe64_pages_not_found") return null;
      throw error;
    });
  }

  /**
   * Ends a run with its outcome: three failures in a row, or a reason only a person can settle,
   * pause the schedule; a refresh clears the count.
   * @param {string} folder
   * @param {string} runId
   * @param {{ outcome: string, message: string, log?: string, version?: number, pause?: string }} result
   */
  async function finish(folder, runId, result) {
    const { pagesRoot, slug } = currentProjectPages();
    const record = await records.change(folder, (current) => {
      if (!current || current.running?.id !== runId) return null;
      const failed = result.outcome === "failed";
      const failures = failed ? current.failures + 1 : result.outcome === "refreshed" ? 0 : current.failures;
      const pause = result.pause || (failed && failures >= FAILURES_TO_PAUSE ? `The last ${FAILURES_TO_PAUSE} refreshes failed.` : "");
      const { running } = current;
      return {
        ...current,
        running: null,
        failures,
        ...(pause ? { paused: true, pausedReason: pause, pausedAt: iso(clock()) } : {}),
        runs: [...current.runs, {
          id: runId,
          kind: running.kind,
          startedAt: running.startedAt,
          endedAt: iso(clock()),
          outcome: result.outcome,
          message: result.message,
          log: logTail(result.log),
          ...(result.version ? { version: result.version } : {}),
          ...(running.taskId ? { taskId: running.taskId, sessionId: current.sessionId } : {})
        }]
      };
    });
    const pageId = path.basename(folder);
    track(slug, pageId, record, await readPage(pagesRoot, pageId));
    return record;
  }

  async function runCommandRefresh({ slug, pagesRoot, folder, page, record, signal }) {
    const saved = await readSavedSource(project);
    const script = await records.readScript(folder, record.script);
    return withSavedCheckout(saved, path.join(pagesRoot, SCRATCH_DIR), async (temporary) => {
      const checkout = path.join(temporary, "project");
      const work = path.join(checkout, ".vibe64-refresh");
      const scriptPath = path.join(work, record.script);
      const dataPath = path.join(work, "data.json");
      await writeFile(scriptPath, script, { mode: 0o700 });
      const result = await runCommand(projectCommandRequest({
        command: INTERPRETERS[path.extname(record.script)],
        args: [scriptPath],
        cwd: checkout,
        env: { HOME: path.join(work, "home"), CI: "1", GIT_TERMINAL_PROMPT: "0", VIBE64_PAGE_DATA: dataPath, VIBE64_PAGE_ID: page.id },
        signal,
        projectSlug: slug,
        operationId: "page-refresh",
        timeout: COMMAND_TIMEOUT_MS
      }));
      const log = [`Saved version ${saved.commit.slice(0, 12)} on ${saved.branch}.`, result?.stdout, result?.stderr]
        .map((text) => String(text || "").trimEnd()).filter((text) => text.trim()).join("\n");
      if (signal.aborted) return { outcome: "cancelled", message: "The refresh was cancelled.", log };
      if (result?.ok !== true) return failure(commandFailure(result || {}), log);
      const data = await readFile(dataPath).catch(() => null);
      const problem = dataProblem(data);
      if (problem) return failure(problem, log);
      const updated = await writeData(pagesRoot, page.id, data, record.scheduledBy, "");
      return { outcome: "refreshed", message: `Refreshed: version ${updated.version}.`, version: updated.version, log };
    });
  }

  async function startPromptRefresh({ slug, folder, pagesRoot, page, record, run, user, signal }) {
    if (!tasks) return failure("AI refreshes are unavailable here.");
    const saved = await readSavedSource(project).catch(() => null);
    const current = await store.currentVersion(pagesRoot, page.id);
    const data = current ? await readFile(path.join(current.versionFolder, "data.json"), "utf8").catch(() => "") : "";
    if (signal.aborted) return { outcome: "cancelled", message: "The refresh was cancelled." };
    let task;
    try {
      task = await tasks.start(record.sessionId, {
        pageId: page.id,
        title: page.title,
        prompt: record.prompt,
        runId: run.id,
        startVersion: page.version,
        saved: saved ? { branch: saved.branch, commit: saved.commit } : null,
        data: data.length > DATA_SHOWN_TO_AI ? `${data.slice(0, DATA_SHOWN_TO_AI)}\n…` : data
      }, user);
    } catch (error) {
      if (error?.code === "vibe64_ai_task_open") {
        return { outcome: "skipped", message: "Skipped: another AI task was open in the session that runs this refresh." };
      }
      if (error?.code === "vibe64_ai_task_session_closed") {
        return {
          ...failure("The session that runs this refresh is no longer open."),
          pause: "Its session is no longer open. Ask the AI in an open session to set this refresh again."
        };
      }
      return failure(`The AI refresh could not start: ${error?.message || "unknown reason"}`);
    }
    const entry = watch(slug, page.id, { sessionId: record.sessionId, taskId: task.id, runId: run.id });
    await records.change(folder, (latest) => latest?.running?.id === run.id
      ? { ...latest, running: { ...latest.running, taskId: task.id } }
      : null);
    // Cancelled while its task was starting: the task is cancelled as soon as it exists.
    if (signal.aborted) await cancelTask(entry).catch((error) => warn("cancel_failed", error, { pageId: page.id }));
    return null;
  }

  /**
   * Whether this refresh may run now, and as whom: a host that doesn't run refresh scripts, or a
   * person who can no longer run what they set, pauses the schedule with why.
   * @returns {Promise<{ user: object | null, refusal: string }>}
   */
  async function access(slug, record) {
    if (record.kind === "command" && host.scriptRefusal) {
      return { user: null, refusal: `${host.scriptRefusal} Ask the AI to refresh this page with AI instead.` };
    }
    const { user, blocked } = await host.runAs(record.scheduledBy, slug);
    return { user, refusal: blocked };
  }

  /**
   * Runs one refresh that `begin` recorded as running, and records how it ended.
   */
  async function perform(slug, pageId, record, run) {
    const key = keyOf(slug, pageId);
    const stop = new AbortController();
    stops.set(key, stop);
    const { pagesRoot } = currentProjectPages();
    const folder = pageFolder(pagesRoot, pageId);
    let result;
    try {
      const page = await readPage(pagesRoot, pageId);
      if (!page) return;
      const { user, refusal } = await access(slug, record);
      if (refusal) result = { ...failure(refusal), pause: refusal };
      else if (record.kind === "command") result = await runCommandRefresh({ slug, pagesRoot, folder, page, record, signal: stop.signal });
      else result = await startPromptRefresh({ slug, folder, pagesRoot, page, record, run, user, signal: stop.signal });
    } catch (error) {
      result = stop.signal.aborted ? { outcome: "cancelled", message: "The refresh was cancelled." } : failure(error?.message || "The refresh failed.");
    } finally {
      if (stops.get(key) === stop) stops.delete(key);
    }
    if (result) await finish(folder, run.id, result);
  }

  /**
   * Starts a refresh now, unless one is running, the page is archived or its schedule is paused. A
   * scheduled turn that can't start is skipped; a person's Refresh now is refused with why.
   * @param {string} slug
   * @param {string} pageId
   * @param {{ scheduled: boolean }} options
   */
  async function begin(slug, pageId, { scheduled }) {
    const { pagesRoot } = currentProjectPages();
    const folder = pageFolder(pagesRoot, pageId);
    const page = await readPage(pagesRoot, pageId);
    let run = null;
    const record = await records.change(folder, (current) => {
      if (!current) return null;
      const nextAt = iso(nextRefreshAt(current.schedule, { after: clock(), anchor: Date.parse(current.scheduledAt) }));
      if (!scheduled) {
        if (current.running) throw runRefusal("A refresh of this page is running. Wait for it, or cancel it.", "vibe64_pages_refresh_running");
        if (!page || page.archived) throw runRefusal("Restore this page before refreshing it.", "vibe64_pages_archived");
      } else if (current.running || current.paused || !page || page.archived) {
        return { ...current, nextAt };
      }
      run = { id: randomUUID(), kind: current.kind, startedAt: iso(clock()), startVersion: page.version };
      return { ...current, ...(scheduled ? { nextAt } : {}), running: run };
    });
    track(slug, pageId, record, page);
    if (run) void perform(slug, pageId, record, run).catch((error) => warn("run_failed", error, { pageId }));
    return record;
  }

  async function fire() {
    const at = clock();
    for (const [key, when] of [...due]) {
      if (when > at || closed) continue;
      due.delete(key);
      const [slug, pageId] = key.split("/");
      await project.runInProjectContext(slug, () => begin(slug, pageId, { scheduled: true }))
        .catch((error) => warn("start_failed", error, { pageId, slug }));
    }
    arm();
  }

  function pollIn(wait) {
    if (closed) return;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void poll();
    }, wait);
    pollTimer.unref();
  }

  function watch(slug, pageId, entry) {
    const watching = { slug, pageId, ...entry };
    watched.set(keyOf(slug, pageId), watching);
    if (!pollTimer) pollIn(taskPollMs);
    return watching;
  }

  /** Cancels a followed refresh's task once, and reads how it ended at once. */
  async function cancelTask(entry) {
    if (entry.cancelled) return;
    entry.cancelled = true;
    await tasks?.cancel(entry.sessionId, entry.taskId);
    pollIn(0);
  }

  /**
   * Follows one prompt refresh's task. A task that needs a person gets none: nobody is there, so
   * it is cancelled and counts as a failure, unless the page already has its new data.
   * @param {{ slug: string, pageId: string, sessionId: string, taskId: string, runId: string, stopping?: string, pause?: string, cancelled?: boolean }} entry
   */
  async function follow(entry) {
    const { pagesRoot } = currentProjectPages();
    const folder = pageFolder(pagesRoot, entry.pageId);
    const state = await tasks.read(entry.sessionId, entry.taskId);
    const page = await readPage(pagesRoot, entry.pageId);
    const record = await records.read(folder);
    if (record?.running?.id !== entry.runId) return true;
    const startVersion = record.running.startVersion;
    const refreshed = page && page.version > startVersion;
    const log = (state?.log || []).map((line) => `${line.at}  ${line.text}`).join("\n");
    if (refreshed && (!state || state.ended || state.needsYou)) {
      if (state && !state.ended) await tasks.cancel(entry.sessionId, entry.taskId).catch(() => {});
      else if (state) await tasks.close(entry.sessionId, entry.taskId).catch(() => {});
      await finish(folder, entry.runId, { outcome: "refreshed", message: `Refreshed: version ${page.version}.`, version: page.version, log });
      return true;
    }
    if (!state) {
      await finish(folder, entry.runId, failure("The refresh's AI task was closed before it finished.", log));
      return true;
    }
    if (state.ended) {
      // Cancelled from the Pages list, or by someone in the session's AI task window.
      const result = entry.cancelled || (state.cancelled && !entry.stopping)
        ? { outcome: "cancelled", message: "The refresh was cancelled.", log }
        : { ...failure(entry.stopping || state.message || "The AI could not refresh the page.", log), ...(entry.pause ? { pause: entry.pause } : {}) };
      await finish(folder, entry.runId, result);
      return true;
    }
    if (state.needsYou && !entry.stopping) {
      entry.stopping = state.message || "The AI stopped before the page had new data.";
      if (state.unavailable) entry.pause = `The AI account isn't available: ${state.message}`;
      await tasks.cancel(entry.sessionId, entry.taskId);
    }
    return false;
  }

  async function poll() {
    for (const [key, entry] of [...watched]) {
      if (closed) return;
      const settled = await project.runInProjectContext(entry.slug, () => follow(entry)).catch((error) => {
        warn("follow_failed", error, { pageId: entry.pageId });
        return false;
      });
      if (settled && watched.get(key) === entry) watched.delete(key);
    }
    if (watched.size && !pollTimer) pollIn(taskPollMs);
  }

  /**
   * Cancels a running refresh: a script is stopped, an AI task cancelled, one still starting is
   * cancelled as it starts. The run records how it ended once it has.
   * @param {string} slug
   * @param {string} pageId
   */
  async function cancel(slug, pageId) {
    const key = keyOf(slug, pageId);
    stops.get(key)?.abort();
    const entry = watched.get(key);
    if (entry) await cancelTask(entry);
  }

  /**
   * Picks up every project's refreshes when the server starts: each due time is kept, a time that
   * passed while Vibe64 was stopped becomes one catch-up now, a prompt refresh still running is
   * followed again, and a script that was running when Vibe64 stopped has ended, its checkout with it.
   */
  async function resume() {
    const listed = await project.listProjects();
    for (const { slug } of listed?.projects || []) {
      await project.runInProjectContext(slug, async () => {
        const { pagesRoot } = currentProjectPages();
        // Checkouts a stopped Vibe64 left behind.
        await rm(path.join(pagesRoot, SCRATCH_DIR), { force: true, recursive: true });
        for (const page of await store.list(pagesRoot)) {
          const folder = pageFolder(pagesRoot, page.id);
          const record = await records.read(folder);
          if (!record) continue;
          if (record.running?.taskId) {
            watch(slug, page.id, { sessionId: record.sessionId, taskId: record.running.taskId, runId: record.running.id });
          } else if (record.running) {
            await finish(folder, record.running.id, { outcome: "cancelled", message: "Vibe64 stopped while this refresh ran." });
            continue;
          }
          track(slug, page.id, record, page);
        }
      }).catch((error) => warn("resume_failed", error, { slug }));
    }
  }

  /** A closed scheduler starts nothing more and stops the scripts it runs; AI tasks carry on, followed again on the next start. */
  function close() {
    closed = true;
    clearTimeout(timer);
    clearTimeout(pollTimer);
    due.clear();
    for (const stop of stops.values()) stop.abort();
  }

  function running(slug, pageId) {
    return stops.has(keyOf(slug, pageId)) || watched.has(keyOf(slug, pageId));
  }

  /** The AI task window's machinery, which runs prompt refreshes; null while it is away. */
  function setTasks(value) {
    tasks = value;
  }

  /**
   * What the host decides about refreshes; the local default decides nothing.
   * @param {import("./types.js").PageRefreshHost | null} value
   */
  function setHost(value) {
    host = value || LOCAL_HOST;
  }

  /** Why refresh scripts don't run on this host, or "". */
  function scriptRefusal() {
    return host.scriptRefusal;
  }

  return Object.freeze({
    begin,
    cancel,
    close,
    resume,
    running,
    scriptRefusal,
    // readable-check: allow setter-seam - cross-repository slot vibe64.pages: a host decides who may run a scheduled refresh, as whom, and whether scripts run
    setHost,
    // readable-check: allow setter-seam - cycle: vibe64.ai-tasks requires vibe64.pages, and runs a prompt refresh as an AI task
    setTasks,
    track
  });
}

export { createPageRefreshes, INTERPRETERS };

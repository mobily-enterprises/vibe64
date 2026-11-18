// Who may run `vibe64-helper session save`, and what it answers. The command runs the session's own Save, the one its
// Save button and automatic save run, for the main chat's AI while that chat's Automatically save changes is on: a
// session working through a long plan saves each finished, checked stage, so the project's other sessions can
// update onto it. Every chat of a session shares the session's command control, so whose command it is comes from
// the session's own records, never from the command line: which of its chats are at work while it runs.
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { fileCount } from "./agentSessionUpdate.js";
import { savesAutomatically } from "./assistantRoutingRequests.js";
import { sessionAssistantWorking } from "./serviceSessionRecords.js";
import { shortCommit } from "./sessionConnectedCopies.js";

const LISTED_FILE_LIMIT = 20;
const OWN_REPOSITORY = "this session";
const SAVE_COMMAND = "vibe64-helper session save";
const UPDATE_COMMAND = "vibe64-helper session update";
// The saved turn statuses of a temporary chat whose AI is working.
const TURN_RUNNING_STATUSES = new Set(["starting", "inProgress"]);
// The AI tasks a Fix it with AI button opens: on the Update, Save, workspace preparation, Preview sign-in and project
// setup problems.
const FIX_IT_KINDS = new Set(["update", "save", "workspace-setup", "preview-identity", "project-setup"]);
const MAIN_CHAT_ONLY = "Only the main chat saves with it, while its Automatically save changes is on: " +
  "temporary chats, AI tasks, Fix it with AI and lessons never save by themselves.";
const LEAVE_TO_PERSON = "Don't run it again here. When the work is ready, tell the person it is ready to save: they choose Save.";
const TELL_OTHER_SESSIONS = "Tell the other sessions you are working with (vibe64-helper session message-project) that this " +
  `work is saved, so they run ${UPDATE_COMMAND} before building on the old code.`;
const SAVE_UPDATE_REQUIRED = "vibe64_session_save_update_required";
const SAVE_NO_CHANGES = "vibe64_session_save_no_changes";
// Save's own message says why; the AI needs no list of its codes to act on it.
const FAILED_NEXT = `Read what it says. If something else is running, run ${SAVE_COMMAND} again in a moment. ` +
  "If the cause is in this session's files, fix it and run it again. Otherwise tell the person what it says.";

const listed = names => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

function refusal(code, message, next) {
  return { ok: false, status: "not_allowed", code, message: `Not saved: ${message}`, next };
}

/**
 * The session's other chats at work now, as their saved records say: a temporary chat whose turn runs, and an AI
 * task with work under way, Fix it with AI among them.
 * @param {object[]} conversations the session's temporary chat and AI task records
 * @returns {{ kind: "temporary" | "ai-task" | "fix", name: string }[]}
 */
function otherChatsAtWork(conversations) {
  return conversations.filter(record => record.state !== "closing").flatMap((record) => {
    if (record.task) {
      if (record.task.active !== true) return [];
      const fix = FIX_IT_KINDS.has(record.task.kind);
      const title = normalizeText(record.task.title);
      return [{ kind: fix ? "fix" : "ai-task", name: `${fix ? "Fix it with AI" : "the AI task"}${title ? ` "${title}"` : ""}` }];
    }
    if (!TURN_RUNNING_STATUSES.has(record.status)) return [];
    const title = normalizeText(record.title) || (Number.isInteger(record.number) ? `Temporary ${record.number}` : "");
    return [{ kind: "temporary", name: `the temporary chat${title ? ` "${title}"` : ""}` }];
  });
}

const CHAT_KIND_REFUSALS = {
  temporary: ["vibe64_agent_session_save_temporary_chat", "temporary chats never save by themselves."],
  "ai-task": ["vibe64_agent_session_save_ai_task", "AI tasks never save by themselves."],
  fix: ["vibe64_agent_session_save_fix_it", "Fix it with AI never saves by itself."]
};

/**
 * Why `vibe64-helper session save` may not run Save now, or null when it may: only in the main chat, during its own
 * turn, with its Automatically save changes on, and never in a lesson. A temporary chat, an AI task or Fix it with AI
 * at work alone ran the command itself; at work beside the main chat, nothing tells which chat ran it.
 * @param {{ session: { agentRuns?: object[], metadata?: Record<string, string> }, conversations: object[] }} input
 *   the session as its records read now, and its temporary chat and AI task records
 */
function agentSessionSaveRefusal({ session, conversations }) {
  const metadata = session.metadata || {};
  if (Object.hasOwn(metadata, "learning_session")) {
    return refusal(
      "vibe64_agent_session_save_lesson",
      "this session is a lesson, and a lesson never saves by itself: saving is part of what it teaches.",
      LEAVE_TO_PERSON
    );
  }
  const others = otherChatsAtWork(conversations);
  const names = listed(others.map(other => other.name));
  const mainWorking = sessionAssistantWorking(session);
  if (others.length && mainWorking) {
    const one = others.length === 1;
    return refusal(
      "vibe64_agent_session_save_chat_unknown",
      `${names} ${one ? "is" : "are"} working in this session as well as the main chat, ` +
        `so Vibe64 can't tell which chat ran this command. ${MAIN_CHAT_ONLY}`,
      `If this is the main chat, run ${SAVE_COMMAND} again once ${one ? "it has" : "they have"} finished. ` +
        "Otherwise leave Save to the person."
    );
  }
  if (others.length === 1) {
    const [code, never] = CHAT_KIND_REFUSALS[others[0].kind];
    return refusal(code, `this command ran in ${names}, and ${never} ${MAIN_CHAT_ONLY}`, LEAVE_TO_PERSON);
  }
  if (others.length) {
    return refusal(
      "vibe64_agent_session_save_other_chat",
      `this command ran in one of ${names}, and none of them saves by itself. ${MAIN_CHAT_ONLY}`,
      LEAVE_TO_PERSON
    );
  }
  if (!mainWorking) {
    return refusal(
      "vibe64_agent_session_save_no_turn",
      `no main chat turn is running, and the main chat's AI saves with this command only during its own turn. ${MAIN_CHAT_ONLY}`,
      LEAVE_TO_PERSON
    );
  }
  if (!savesAutomatically(metadata)) {
    return refusal(
      "vibe64_agent_session_save_off",
      "Automatically save changes is off in this chat's settings, so the person saves its work with the Save button.",
      "Don't run it again in this chat. When the work is ready, tell the person it is ready to save."
    );
  }
  return null;
}

/**
 * What Save saved: each repository it published (this session's own first) with its saved commit, the files saved
 * (a copy's as ../connected/<name>/...), the first ones listed, the files Save regenerated in the session, the files
 * written while it ran (still unsaved), and whether the session is on the saved version.
 * @param {{ changedPaths?: string[], connected?: object[], reconciled?: boolean, refreshedPaths?: string[], saveCommit?: string, unsavedPathCount?: number }} result
 */
function savedBy(result) {
  const copies = result.connected || [];
  const files = [...(result.saveCommit ? result.changedPaths || [] : []), ...copies.flatMap(copy => copy.changedPaths || [])];
  return {
    repositories: [
      ...(result.saveCommit ? [{ name: OWN_REPOSITORY, commit: shortCommit(result.saveCommit) }] : []),
      ...copies.map(copy => ({ name: copy.name, commit: shortCommit(copy.saveCommit) }))
    ],
    savedFileCount: files.length,
    savedFiles: files.slice(0, LISTED_FILE_LIMIT),
    regeneratedFiles: (result.refreshedPaths || []).slice(0, LISTED_FILE_LIMIT),
    unsavedFileCount: result.unsavedPathCount || 0,
    onSavedVersion: result.reconciled === true
  };
}

function savedLines(saved) {
  const repositories = saved.repositories.map(({ commit, name }) => `${name} saved at ${commit}`).join("; ");
  const more = saved.savedFileCount - saved.savedFiles.length;
  return [
    `Saved: ${repositories}.`,
    saved.savedFileCount ? `${fileCount(saved.savedFileCount)} saved: ${saved.savedFiles.join(", ")}${more > 0 ? ` and ${more} more` : ""}.` : "",
    saved.unsavedFileCount
      ? `${fileCount(saved.unsavedFileCount)} changed while Save ran and ${saved.unsavedFileCount === 1 ? "stays" : "stay"} unsaved.`
      : "",
    saved.onSavedVersion ? "" : "A Git commit was made in this session while Save ran, so the session stays on that commit, with every change kept."
  ].filter(Boolean).join(" ");
}

function afterSaveSteps(saved) {
  return [
    saved.regeneratedFiles.length
      ? `Save regenerated ${saved.regeneratedFiles.join(", ")} in this session: re-read ${saved.regeneratedFiles.length === 1 ? "it" : "them"} before editing.`
      : "",
    saved.onSavedVersion ? "" : `Run ${UPDATE_COMMAND} to bring this session onto the saved version.`,
    TELL_OTHER_SESSIONS
  ].filter(Boolean).join(" ");
}

/**
 * The answer to `vibe64-helper session save`, from Save's own result: what it saved and what follows, or why it did
 * not save and what to do next. Nothing to save says so plainly and an Update needed first names the Update; every
 * other refusal or failure is Save's own message.
 * @param {object} result what the session's Save returned
 */
function agentSessionSaveAnswer(result) {
  if (result?.ok !== true) {
    const code = normalizeText(result?.code);
    if (code === SAVE_NO_CHANGES) {
      return {
        ok: false,
        status: "nothing_to_save",
        code,
        message: "Nothing to save: this session and its connected repositories have no unsaved work.",
        next: "Nothing to do: their saved versions already hold this work."
      };
    }
    return {
      ok: false,
      status: code === SAVE_UPDATE_REQUIRED ? "update_first" : "failed",
      code,
      message: `Not saved: ${normalizeText(result?.error) || "Save did not finish."}`,
      next: code === SAVE_UPDATE_REQUIRED
        ? `Run ${UPDATE_COMMAND} first, deal with anything it reports, then run ${SAVE_COMMAND} again.`
        : FAILED_NEXT
    };
  }
  const saved = savedBy(result);
  // Nothing reported is not a Save.
  if (!saved.repositories.length) return agentSessionSaveAnswer({ error: "Save finished without saying what it saved." });
  return { ok: true, status: "saved", message: savedLines(saved), next: afterSaveSteps(saved), ...saved };
}

/**
 * `vibe64-helper session save` in one bound session: whose command it is, from the session's records as they stand
 * now, then the session's own Save for the person the AI works for, and the answer. A refusal runs nothing. The AI
 * waits for the answer inside its own turn, so Save captures its files as they are at the command; Save holds the
 * session only while it saves, and steers no turn (`requestedByAgent`), since the answer says what it saved.
 * @param {object} input
 * @param {() => Promise<object | null>} input.actor the person whose request the AI works on
 * @param {(sessionId: string, input: object) => Promise<object>} input.saveSessionWork the session's own Save
 * @param {string} input.sessionId
 * @param {{ readSession: Function, listSessionConversations: Function }} input.store the session's store
 */
async function runAgentSessionSave({ actor, saveSessionWork, sessionId, store }) {
  const [session, conversations] = await Promise.all([
    store.readSession(sessionId),
    store.listSessionConversations(sessionId)
  ]);
  const refused = agentSessionSaveRefusal({ session, conversations });
  if (refused) return refused;
  return agentSessionSaveAnswer(await saveSessionWork(sessionId, { requestedByAgent: true, vibe64User: await actor() }));
}

export { agentSessionSaveAnswer, agentSessionSaveRefusal, runAgentSessionSave };

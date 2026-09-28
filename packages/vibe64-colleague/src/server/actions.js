import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

const text = { type: "string", noTrim: false, maxLength: 256, required: false };
const focusSchema = createSchema({
  ...Object.fromEntries(["projectSlug", "sessionId", "conversationId", "pane", "route"].map((key) => [key, text])),
  previewScreen: { type: "string", required: false, enum: ["existing-project-setup", "new-project-setup", "checking-project-setup", "outputs", "outputs-with-setup-warning"] }
});
const focusField = { type: "object", schema: focusSchema, required: false };
const navigationOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    error: { ...text, maxLength: 2000 },
    focus: focusField
  })
};
const clientId = { ...text, minLength: 1, maxLength: 128, required: true };
const watchFields = {
  watchId: clientId, projectSlug: { ...text, required: true }, sessionId: { ...text, required: true }, conversationId: text,
  condition: { type: "string", enum: ["reply", "finished", "attention"], required: true },
  question: { ...text, maxLength: 1000, required: true }, once: { type: "boolean", required: false }
};
const watchSchema = createSchema({ ...watchFields, status: { ...text, required: true }, error: { ...text, maxLength: 512 } });
const watchOutput = { mode: "replace", schema: createSchema({ ok: { type: "boolean", required: true },
  watch: { type: "object", schema: watchSchema, required: false },
  watches: { type: "array", items: watchSchema, required: false } }) };

function createColleagueActions(colleague) {
  const definition = (name, fields, execute, assistant, projectScoped = false) => withVibe64ActionContext({
    id: `vibe64.colleague.${name}`, version: 1,
    kind: name.endsWith("read") ? "query" : "command",
    input: { schema: createSchema(fields), mode: "create" },
    output: null, idempotency: name === "message.send" ? "domain_native" : "none",
    ...(assistant ? { extensions: { assistant } } : {}),
    execute
  }, { projectScoped });
  return [
    definition("state.read", { clientId: { ...clientId, required: false } }, (input, context) => colleague.read(input, context)),
    definition("focus.update", { clientId, focus: { ...focusField, required: true } }, (input, context) => colleague.focus(input, context)),
    definition("message.send", {
      clientId, focus: focusField,
      messageId: clientId,
      message: { type: "string", noTrim: false, minLength: 1, maxLength: 24000, required: true },
      assistantSelection: { type: "object", additionalProperties: true, required: false }
    }, (input, context) => colleague.send(input, context)),
    definition("turn.stop", {}, (input, context) => colleague.stop(input, context)),
    definition("model.select", {
      assistantSelection: { type: "object", additionalProperties: true, required: true }
    }, (input, context) => colleague.selectModel(input, context)),
    definition("watches.read", {}, (input, context) => colleague.listWatches(input, context), {
      description: "List your conversation watches and their active, pending, delivered, paused or cancelled status. Paused reads need attention; silence does not prove an agent is blocked.", output: watchOutput
    }),
    definition("conversation-summary.read", {
      projectSlug: { ...text, required: true }, sessionId: { ...text, required: true }, conversationId: text,
      beforeTurnId: text, beforeMessageId: text, question: { ...text, maxLength: 2000, required: true }
    }, (input, context) => colleague.summarize(input, context), {
      description: "Answer a specific question from a larger authorized conversation range. Reads up to 20 Main turns or 12 temporary messages; nextBefore is the corresponding beforeTurnId or beforeMessageId for the next older page. Small ranges return text directly. Large ranges use the configured inexpensive, tool-free Helper and return a summary with real message citations. Failures fall back to bounded excerpts, explicitly marked. Never infer an answer from text outside the returned range.",
      output: { mode: "replace", schema: createSchema({
        ok: { type: "boolean", required: true }, mode: { type: "string", enum: ["summary", "excerpts"], required: true },
        summary: { ...text, maxLength: 1600 }, error: { ...text, maxLength: 512 }, nextBefore: text,
        hasMoreBefore: { type: "boolean", required: false }, truncated: { type: "boolean", required: false },
        citations: { type: "array", maxLength: 6, items: { type: "string", maxLength: 128 }, required: false },
        messages: { type: "array", required: true, items: createSchema({ id: text, role: text,
          text: { type: "string", maxLength: 8000, required: true }, truncated: { type: "boolean", required: true }
        }) }
      }) }
    }, true),
    definition("watch.create", watchFields, (input, context) => colleague.watch(input, context), {
      description: "Watch a Main or temporary conversation using code, without repeated model calls. Supply exact project/session IDs and optional temporary conversationId, a unique watchId (reuse it on retry), and the user's question. reply reports a completed answer; finished reports work ending; attention reports explicit failures, interruptions or structured input requests, not inferred inactivity. All conditions also report failures. once defaults to true. If the answer already exists, report it immediately. Watches only authorize reporting, never further coding or stopping agents.", output: watchOutput
    }, true),
    definition("watch.cancel", { watchId: clientId }, (input, context) => colleague.cancelWatch(input, context), {
      description: "Cancel your watch by its watchId. Does not stop the watched coding agent.", output: watchOutput
    }),
    definition("watch.resume", { watchId: clientId }, (input, context) => colleague.resumeWatch(input, context), {
      description: "Resume a paused watch, checking current access and reconciling changes since its last observation.", output: watchOutput
    }),
    definition("navigation.acknowledge", {
      clientId, commandId: clientId, ok: { type: "boolean", required: true },
      error: { ...text, maxLength: 2000 }, focus: focusField
    }, (input, context) => colleague.acknowledgeNavigation(input, context)),
    definition("navigation.open", { projectSlug: text, sessionId: text, conversationId: text,
      pane: { type: "string", required: false, enum: ["preview", "settings", "repository-settings", "env", "integrations", "access", "resources", "deploy", "history", "health", "session", "changes", "repository", "files", "database", "system", "ai-terminal", "issues", "pull-requests"] }
    }, (input, context) => colleague.navigate(input, context), {
      description: "Open a project, session, saved temporary conversation or project view in the user's active browser. Provide exact IDs. pane defaults to preview; settings means Project settings, repository-settings means hosted repository settings, access means App access, history means Session History, system means Subsystems. Session views (session, changes, repository, files, database, system, ai-terminal) require sessionId. A temporary conversation also requires sessionId. Omitting conversationId selects Main when sessionId is supplied; include the current conversationId to keep a temporary chat selected. This opens existing UI and does not grant you repository or screen tools. Wait for the returned browser acknowledgement before claiming the view opened.",
      output: navigationOutput
    }, true),
    definition("navigation.open-management", {
      managementView: { type: "string", enum: ["launcher", "projects", "studio-health", "accounts", "assistant", "users", "vps-access"], required: true }
    }, (input, context) => colleague.navigate(input, context), {
      description: "Open a global Vibe64 Management page, without requiring a project or session. projects opens the project chooser; launcher shows project work; accounts opens AI Accounts; assistant opens Speech and Colleague settings; users opens user management; vps-access opens owner SSH access; studio-health runs the existing read-only platform checks. This only opens a page, it does not change its settings. Wait for the browser acknowledgement.",
      output: navigationOutput
    }),
    definition("context.read", {}, (input, context) => colleague.context(input, context), {
      alwaysAvailable: true,
      description: "Read the project, session, conversation and displayed view targeted by this Colleague request. previewScreen identifies what the Preview pane actually shows: existing-project-setup asks what the project does, with Set up project and Inspect it for me choices; new-project-setup offers starters or starting through conversation; checking-project-setup is still loading; outputs-with-setup-warning includes a setup problem. outputs is the output controls, not proof an app is running. Read project onboarding for current setup details and available actions. An empty focus means the project chooser. Navigation does not silently retarget a pending request.",
      output: { schema: createSchema({ ok: { type: "boolean", required: true }, focus: { ...focusField, required: true } }), mode: "replace" }
    })
  ];
}

export { createColleagueActions };

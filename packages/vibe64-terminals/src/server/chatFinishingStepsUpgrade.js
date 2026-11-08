import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

// Frozen for this published upgrade: the defaults when each chat first chose its
// own finishing steps (a Custom chat saved no choice before), and the none that
// temporary chats, Fix it with AI and lessons keep.
const DEFAULTS = Object.freeze({ review: true, deslop: true, uiPass: false, autoSave: true });
const NONE = Object.freeze({ review: false, deslop: false, uiPass: false, autoSave: false });
const MODES = new Set(["custom", "senior", "junior", "auto", "fix"]);

/**
 * One saved chat mode in the current shape. Before, review meant Auto's
 * optional Deslop (its review was mandatory), the UI pass was saved only while
 * on, and only Auto ran any of them; Senior and Junior chats kept those choices
 * for a return to Auto, so they keep them now. A lesson runs none: Deslop must
 * never rewrite a learner's code, and a lesson teaches Save. A value that
 * already saves deslop is current.
 * @param {Record<string, unknown>} saved
 * @param {{ none?: boolean }} [options]
 */
function finishingPreferences(saved, options = {}) {
  const { none = false } = options;
  if (!isRecord(saved) || !MODES.has(saved.mode)) throw new Error("Saved chat mode is unsupported. Inspect it before upgrading.");
  if (Object.hasOwn(saved, "deslop")) return saved;
  const { review, uiPass, autoSave, ...value } = saved;
  if (none || saved.mode === "fix") return { ...value, ...NONE };
  if (saved.mode === "custom") return { ...value, ...DEFAULTS };
  return { ...value, review: true, deslop: review !== false, uiPass: uiPass === true, autoSave: autoSave !== false };
}

function changedPreferences(raw, options) {
  if (!raw) return raw;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    throw new Error("Saved chat mode is unreadable. Inspect it before upgrading.");
  }
  const next = finishingPreferences(saved, options);
  return next === saved ? raw : JSON.stringify(next);
}

/**
 * Main chat, its temporary chats and a pending renewal's successor; requests,
 * goals and everything else stay as they are. A lesson is a session bound to
 * its learner's attempt (its learning_session metadata).
 */
function chatFinishingStepsChanges({ metadata = {}, conversations = [], renewal }) {
  const lesson = { none: Object.hasOwn(metadata, "learning_session") };
  const result = {
    metadata: metadata.assistant_routing ? { assistant_routing: changedPreferences(metadata.assistant_routing, lesson) } : {},
    conversations: conversations.map((record) => !record.routingMetadata?.assistant_routing ? record : {
      ...record,
      routingMetadata: {
        ...record.routingMetadata,
        assistant_routing: changedPreferences(record.routingMetadata.assistant_routing, { none: true })
      }
    })
  };
  const successor = renewal?.successor?.assistantRouting;
  if (successor) {
    const assistantRouting = finishingPreferences(successor, lesson);
    if (assistantRouting !== successor) result.renewal = { ...renewal, successor: { ...renewal.successor, assistantRouting } };
  }
  return result;
}

/**
 * 20261107: every chat saves review, deslop, uiPass and autoSave on its own.
 * Auto, Senior and Junior chats keep Auto's mandatory review and their Deslop,
 * UI pass and save choices; Custom chats start with the defaults; temporary
 * chats, Fix it with AI and lessons run none. Retained requests are untouched; nothing is replayed.
 */
async function upgradeChatFinishingSteps(context) {
  return publishStateUpgradeFiles({
    ...context,
    prepareUpdates: async (temporaryRoot) => {
      const updates = [];
      for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
        const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
        const staged = await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot, transform: chatFinishingStepsChanges });
        context.report(
          "info",
          `${path.basename(projectRuntimeRoot)}: ${staged.length} session file change(s) for each chat's own finishing steps.`
        );
        updates.push(...staged);
      }
      return updates;
    }
  });
}

const __testables = Object.freeze({ chatFinishingStepsChanges });

export { upgradeChatFinishingSteps, __testables };

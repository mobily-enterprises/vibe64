import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { appCredentialContext } from "@local/vibe64-execution/server";
import { readClaudeHistory } from "@jskit-ai/assistant-core/server/claude-history";
import { nativeConversationBindings } from "./nativeConversationRetirement.js";

// Stopped-service repair only. Exact native UUID and output bytes establish
// command identity; visible wording never establishes management provenance.
export async function upgradeClaudeCommandMessages(context) {
  const configRoot = process.env.CLAUDE_CONFIG_DIR || path.join(appCredentialContext().home, ".claude");
  return publishStateUpgradeFiles({ ...context, async prepareUpdates(temporaryRoot) {
    const updates = [];
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
      const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
      updates.push(...await store.prepareConversationMessageDataUpgrade({ temporaryRoot,
        async transform({ sessionId, metadata, conversation, messages }) {
          const candidates = messages.filter(message => ["assistant", "commentary"].includes(message.role) &&
            /^claude_.+_0$/u.test(message.messageId || ""));
          if (!candidates.length) return [];
          const bindings = conversation ? [
            ...Object.values(conversation.nativeBindings || {}),
            ...(conversation.providerConversationId ? [{ conversationId: conversation.providerConversationId,
              assistantSelection: conversation.assistantSelection }] : [])
          ].filter(binding => binding.assistantSelection?.engineId === "claude").map(binding => ({
            conversationId: binding.conversationId, workdir: metadata.source_path
          })) : nativeConversationBindings({ metadata }).filter(binding => binding.engineId === "claude");
          const label = `${path.basename(projectRuntimeRoot)}/${sessionId}/${conversation?.conversationId || "main"}`;
          const patches = new Map();
          const read = new Set();
          for (const binding of bindings) {
            const key = JSON.stringify([binding.workdir, binding.conversationId]);
            if (read.has(key)) continue;
            read.add(key);
            if (!path.isAbsolute(binding.workdir || "")) throw new Error(`${label}: Claude history has no absolute workdir. Inspect its saved binding before upgrading.`);
            let history;
            try {
              history = await readClaudeHistory({ configRoot, workdir: binding.workdir,
                conversationId: binding.conversationId, allowIncompleteTail: false, includeCommandMessages: true });
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
            if (!history?.exists) {
              context.report("warning", `${label}: native Claude history is unavailable; unproven command messages remain unchanged.`);
              continue;
            }
            for (const command of history.commandMessages) {
              const matches = candidates.filter(message => message.messageId === command.id);
              if (!matches.length) continue;
              const savedNative = matches[0].data?.native;
              const earlierOutput = savedNative?.engineId === "claude" && savedNative.type === "system" &&
                savedNative.subtype === "local_command_output" && savedNative.command === undefined && savedNative.output === undefined;
              const data = earlierOutput ? {
                native: { ...savedNative, command: command.data.native.command, output: command.data.native.output }
              } : command.data;
              if (matches.length !== 1 || matches[0].text !== command.text ||
                  savedNative && !earlierOutput && (savedNative.engineId !== "claude" || savedNative.command !== command.data.native.command ||
                    savedNative.output !== command.data.native.output) ||
                  patches.has(command.id) && !isDeepStrictEqual(patches.get(command.id).data, data)) {
                throw new Error(`${label}: native command evidence conflicts with its saved message. Inspect the original history before upgrading.`);
              }
              if (savedNative && !earlierOutput) continue;
              patches.set(command.id, { messageId: command.id, data });
            }
          }
          context.report("info", `${label}: ${patches.size} native command message(s) verified; text, receipts and native history are retained.`);
          return [...patches.values()];
        }
      }));
    }
    return updates;
  } });
}

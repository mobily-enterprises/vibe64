import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { claudeConfigRoot } from "./claudeCodeProcess.js";
import { claudeNativeMessageId } from "@jskit-ai/assistant-core/server/claude-turn";
import { readClaudeHistory } from "@jskit-ai/assistant-core/server/claude-history";

const rejectedBeforeWrite = "Claude has no active turn for this message.";
const object = value => value && typeof value === "object" && !Array.isArray(value);

// Only this original pre-write guard is affirmative nondelivery evidence. A
// timeout, an absent native receipt or a generic interrupted run is not proof.
export async function rejectedClaudeInputChanges({ metadata, runs, configRoot }) {
  const raw = metadata.assistant_routing_request;
  if (!raw) return {};
  const request = JSON.parse(raw);
  if (!object(request)) throw new Error("Saved routing request must be an object.");
  if (request.delivery !== "uncertain") return {};
  const run = runs.findLast(value => value.engineId === "claude");
  if (run?.error !== rejectedBeforeWrite) return {};
  const refuse = () => { throw new Error("Rejected Claude input has conflicting delivery evidence. Inspect its original request and native receipt before retrying."); };
  if (request.schemaVersion !== 5 || request.status !== "waiting" ||
      typeof request.messageId !== "string" || !request.messageId ||
      request.attemptedMessageId !== request.messageId || request.followup ||
      !object(request.input) || (request.input.messageId !== undefined && request.input.messageId !== request.messageId) ||
      run.id !== "claude_stream_json" || run.active !== false || run.state !== "interrupted" ||
      run.threadId !== request.threadId || runs.some(value => value.active)) refuse();
  const native = JSON.parse(metadata[`claude_conversation_${request.threadId}`] || "null");
  const uuid = claudeNativeMessageId(request.messageId);
  if (!object(native) || native.executionId !== "" || native.state !== "interrupted" ||
      native.main !== true || native.lastMessageId !== uuid || native.turnId !== uuid || run.turnId !== uuid ||
      typeof native.nativeWorkdir !== "string" || !path.isAbsolute(native.nativeWorkdir)) refuse();
  // The original guard proves rejection. Current-branch native admission is an
  // additional conflict check, not proof inferred from a missing receipt.
  const history = await readClaudeHistory({ configRoot, workdir: native.nativeWorkdir,
    conversationId: request.threadId, allowIncompleteTail: false });
  if (!history.exists || history.userIds.includes(uuid)) refuse();
  const next = { ...request, status: "waiting", delivery: "failed", error: rejectedBeforeWrite };
  delete next.attemptedMessageId;
  return { assistant_routing_request: JSON.stringify(next) };
}

export async function upgradeClaudeRejectedInput(context) {
  const configRoot = claudeConfigRoot();
  const manifestPath = path.join(context.backupRoot, "manifest.json");
  await verifyUpgradeParents(context.systemRoot, manifestPath);
  const resuming = await readUpgradeFile(manifestPath) !== null;
  async function prepareUpdates(temporaryRoot) {
    const updates = [];
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
      const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
      const changes = await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot,
        async transform({ sessionId, metadata }) {
          // This correction targets retained Main chat requests. Restorable
          // archives are inventoried by their owner but remain unchanged.
          const routePath = await store.withReadableSessionPaths(sessionId,
            paths => path.join(paths.metadataRoot, "assistant_routing_request"));
          const relative = path.relative(context.systemRoot, routePath);
          if (relative.startsWith("..") || path.isAbsolute(relative)) return {};
          const beforePath = path.join(context.backupRoot, "before", relative);
          await verifyUpgradeParents(context.backupRoot, beforePath);
          const original = resuming ? await readUpgradeFile(beforePath) : null;
          const patch = await rejectedClaudeInputChanges({ metadata: original === null ? metadata
            : { ...metadata, assistant_routing_request: original }, runs: await store.readAgentRuns(sessionId), configRoot });
          if (resuming && patch.assistant_routing_request) {
            if (original === null) throw new Error("A new rejected Claude input appeared after preparation. Keep writers stopped and inspect before retrying.");
            const afterPath = path.join(context.backupRoot, "after", relative);
            await verifyUpgradeParents(context.backupRoot, afterPath);
            if ((await readUpgradeFile(afterPath)) !== `${patch.assistant_routing_request}\n`) {
              throw new Error("Prepared Claude repair no longer matches its original evidence. Inspect the backup before retrying.");
            }
          } else if (original !== null) throw new Error("Original Claude repair evidence is no longer eligible. Inspect before retrying.");
          return { metadata: patch };
        } });
      context.report("info", `${path.basename(projectRuntimeRoot)}: ${changes.length} rejected Claude routing file(s); explicit Retry is required and nothing is sent.`);
      updates.push(...changes);
    }
    return updates;
  }
  // Re-prove native nondelivery on interrupted publication, including when the
  // product file already contains the prepared replacement. The publisher then
  // verifies all immutable backup/destination bytes before completing writes.
  if (resuming) {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-claude-repair-"));
    try { await prepareUpdates(temporaryRoot); }
    finally { await rm(temporaryRoot, { recursive: true, force: true }); }
  }
  return publishStateUpgradeFiles({ ...context, prepareUpdates });
}

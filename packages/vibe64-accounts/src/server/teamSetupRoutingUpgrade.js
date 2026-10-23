import path from "node:path";
import { validateAssistantRoutingConfiguration } from "@local/vibe64-core/server/assistantRoutingStore";
import { V4_ENGINE_ORDER, validateAssistantRoutingConfiguration as validateV4, v4OwnerSetup, v4SourceEngineId }
  from "@local/vibe64-core/server/stateUpgrades/routingV4Format";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { CURATED_CODEX_PROVIDERS } from "@local/vibe64-core/shared/curatedCodexProviders";
import { createAiConnectionStore } from "./aiConnectionStore.js";

const ENGINE_LABELS = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
const ROLE_LABELS = { senior: "Senior", junior: "Junior", router: "Router", helper: "Helper", sharedBackup: "Shared backup" };

// Offline, without live access: a plan sign-in is personal, and so is any
// provider or saved OpenCode connection marked for its owner. Codex with
// OpenAI counts as personal because offline can't prove API-key sign-in.
function offlinePersonal(selection, openCodeConnections) {
  if (selection.engineId === "claude" && selection.modelProviderId === "anthropic") return true;
  if (selection.engineId === "codex" && selection.modelProviderId === "openai") return true;
  if (CURATED_CODEX_PROVIDERS.some(({ id, ownerOnly }) => id === selection.modelProviderId && ownerOnly)) return true;
  return selection.engineId === "opencode" &&
    openCodeConnections.some(({ id, ownerOnly }) => id === selection.modelProviderId && ownerOnly);
}

/**
 * 20261023: model routing becomes the owner's setup and the team setup. The
 * owner's setup takes the workflow block with Senior and Junior; the team setup
 * takes the shared backup when it is a Workspace-use model, and is otherwise
 * left empty so team members wait until the owner sets up team AI. Other
 * workflow blocks stay only in the backup. Offline, backed-up publish.
 */
export async function upgradeTeamSetupRouting({ systemRoot, apply, backupRoot, report }) {
  const filePath = path.join(systemRoot, "ai-connections", "routing.json");
  await verifyUpgradeParents(systemRoot, filePath);
  await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, prepareUpdates: async () => {
    const original = await readUpgradeFile(filePath);
    if (original === null) return [];
    let saved;
    try { saved = JSON.parse(original); } catch { throw new Error("Saved model routing is unreadable. Inspect it before upgrading."); }
    if (saved?.schemaVersion === 5) return [];
    if (!apply && saved?.schemaVersion !== 4) {
      report("info", "Earlier upgrades will prepare the saved model routing first; apply checks it again.");
      return [];
    }
    try { validateV4(saved); }
    catch { throw new Error("Saved model routing is not in the schema-4 format. Inspect it before upgrading."); }
    const { orchestrators } = saved;
    const sourceEngineId = v4SourceEngineId(orchestrators);
    for (const engineId of V4_ENGINE_ORDER) {
      if (engineId === sourceEngineId || !orchestrators[engineId]) continue;
      const roles = Object.keys(ROLE_LABELS).filter((role) => orchestrators[engineId][role]).map((role) => ROLE_LABELS[role]);
      report("warning", `${ENGINE_LABELS[engineId]} routing${roles.length ? ` (${roles.join(", ")})` : ""} is left in the backup, not carried over.`);
    }
    const backup = orchestrators[sourceEngineId]?.sharedBackup ??
      V4_ENGINE_ORDER.map((engineId) => orchestrators[engineId]?.sharedBackup).find(Boolean);
    const openCodeConnections = backup?.engineId === "opencode"
      ? await createAiConnectionStore({ filePath: path.join(systemRoot, "ai-connections", "connections.json"),
        verifyConnection: () => { throw new Error("Offline routing upgrade cannot call a provider."); } }).listConnections()
      : [];
    let nonOwner = {};
    if (backup && !offlinePersonal(backup, openCodeConnections)) {
      nonOwner = { colleague: backup, quickHelper: backup, fix: { follows: "colleague" }, explain: { follows: "quickHelper" } };
    } else {
      report("warning", "Team members will be asked to wait until the owner sets up team AI.");
    }
    const next = validateAssistantRoutingConfiguration({ schemaVersion: 5, revision: saved.revision + 1,
      owner: v4OwnerSetup(orchestrators[sourceEngineId]), nonOwner });
    return [{ filePath, original, contents: `${JSON.stringify(next)}\n` }];
  } });
}

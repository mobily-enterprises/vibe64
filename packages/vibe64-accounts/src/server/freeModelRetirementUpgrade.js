import path from "node:path";
import { validateAssistantRoutingConfiguration } from "@local/vibe64-core/server/stateUpgrades/routingV4Format";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";

const ROLES = ["senior", "junior", "helper", "router", "sharedBackup"];
const retiredModel = selection => selection?.engineId === "opencode" &&
  selection.modelProviderId === "opencode" && selection.modelId === "big-pickle";

/**
 * 20261022: Vibe64 no longer offers OpenCode Zen's free Big Pickle model.
 * Routing roles that name it become unset, so the next use recommends a model
 * from the person's connected AI (as on first use) or asks them to set one up.
 * An explicitly disabled role (null) stays disabled. Offline, backed-up publish.
 */
export async function retireFreeModelRouting({ systemRoot, apply, backupRoot, report }) {
  const filePath = path.join(systemRoot, "ai-connections", "routing.json");
  await verifyUpgradeParents(systemRoot, filePath);
  await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, prepareUpdates: async () => {
    const original = await readUpgradeFile(filePath);
    if (original === null) return [];
    let saved;
    try { saved = JSON.parse(original); } catch { throw new Error("Saved model routing is unreadable. Inspect it before upgrading."); }
    if (!apply && saved?.schemaVersion !== 4) {
      report("info", "Earlier upgrades will prepare the saved model routing first; apply checks it again.");
      return [];
    }
    try { validateAssistantRoutingConfiguration(saved); }
    catch { throw new Error("Saved model routing is not in the current format. Inspect it before upgrading."); }
    const orchestrators = structuredClone(saved.orchestrators);
    let retired = 0;
    for (const [engineId, roles] of Object.entries(orchestrators)) {
      for (const role of ROLES) {
        if (retiredModel(roles[role])) { delete roles[role]; retired += 1; }
      }
      if (retiredModel(roles.helperRoutingReview?.proposed)) { roles.helperRoutingReview.proposed = null; retired += 1; }
      if (!Object.keys(roles).length) delete orchestrators[engineId];
    }
    if (!retired) return [];
    const next = validateAssistantRoutingConfiguration({ ...saved, revision: saved.revision + 1, orchestrators });
    report("info", `${retired} routing choice(s) named the retired free model and become unset.`);
    return [{ filePath, original, contents: `${JSON.stringify(next)}\n` }];
  } });
}

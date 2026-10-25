import path from "node:path";
import { publishStateUpgradeFiles, readUpgradeFile } from "../stateUpgradeFiles.js";

const KEPT = "colleagueName";

// Workspace assistant settings (assistant-settings.json) keep only the shared
// Colleague name. Avatar, voice, talk, send and narration values there are
// retired: each person's preferences hold them. A file without a name is
// removed, so the default name applies; a file with only the name is untouched.
export default {
  id: "20261025-workspace-assistant-name-only",
  async run({ systemRoot, apply, backupRoot, report }) {
    await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, async prepareUpdates() {
      const filePath = path.join(systemRoot, "assistant-settings.json");
      const original = await readUpgradeFile(filePath);
      if (original === null) return [];
      let saved = null;
      try { saved = JSON.parse(original); } catch { /* Reported below without its content. */ }
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
        throw new Error("Workspace assistant settings are invalid: assistant-settings.json. Inspect them before upgrading state.");
      }
      const keys = Object.keys(saved);
      if (keys.length === 1 && keys[0] === KEPT) return [];
      return [{
        filePath,
        original,
        contents: typeof saved[KEPT] === "string" ? `${JSON.stringify({ [KEPT]: saved[KEPT] }, null, 2)}\n` : null
      }];
    } });
  }
};

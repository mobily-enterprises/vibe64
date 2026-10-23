import { readdir } from "node:fs/promises";
import path from "node:path";
import { publishStateUpgradeFiles, readUpgradeFile } from "../stateUpgradeFiles.js";

const RETIRED = "welcomeTourDone";

// Personal Colleague preferences (assistant-preferences/<person>/colleague.json)
// drop the retired welcomeTourDone flag: the tour it remembered became the
// course's orientation lesson, whose own progress replaced it. Every other
// preference is kept as saved; profiles without the flag are not touched.
export default {
  id: "20261023-retired-tour-preference",
  async run({ systemRoot, apply, backupRoot, report }) {
    await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, async prepareUpdates() {
      const root = path.join(systemRoot, "assistant-preferences");
      let people = [];
      try { people = await readdir(root, { withFileTypes: true }); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const updates = [];
      for (const person of people.filter(entry => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
        const filePath = path.join(root, person.name, "colleague.json");
        const original = await readUpgradeFile(filePath);
        if (original === null) continue;
        let saved = null;
        try { saved = JSON.parse(original); } catch { /* Reported below without its content. */ }
        if (!saved || typeof saved !== "object" || Array.isArray(saved) || !saved.settings || typeof saved.settings !== "object") {
          throw new Error(`Personal Colleague preferences are invalid: assistant-preferences/${person.name}/colleague.json. Inspect them before upgrading state.`);
        }
        if (!Object.hasOwn(saved.settings, RETIRED)) continue;
        const { [RETIRED]: _retired, ...settings } = saved.settings;
        updates.push({ filePath, original, contents: `${JSON.stringify({ ...saved, settings }, null, 2)}\n` });
      }
      return updates;
    } });
  }
};

import path from "node:path";
import { listProjectRuntimeRoots, resolveProjectRecordPath } from "../projectState.js";
import { publishStateUpgradeFiles, readUpgradeFile } from "../stateUpgradeFiles.js";

const RETIRED = "bootstrap";

// Project records (projects/<slug>/project.json) drop the retired `bootstrap`
// creation record: nothing has read it since Genesis-first projects, and
// project metadata no longer accepts it. Every other field is kept as saved;
// records without it are not touched.
export default {
  id: "20261025-retired-project-bootstrap",
  async run({ systemRoot, apply, backupRoot, report }) {
    await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, async prepareUpdates() {
      const updates = [];
      for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
        const filePath = resolveProjectRecordPath({ projectRuntimeRoot });
        const label = path.relative(systemRoot, filePath);
        const original = await readUpgradeFile(filePath);
        if (original === null) continue;
        let saved = null;
        try { saved = JSON.parse(original); } catch { /* Reported below without its content. */ }
        if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
          throw new Error(`Project record is invalid: ${label}. Inspect it before upgrading state.`);
        }
        if (!Object.hasOwn(saved, RETIRED)) continue;
        const { [RETIRED]: _retired, ...record } = saved;
        updates.push({ filePath, original, contents: `${JSON.stringify(record, null, 2)}\n` });
      }
      return updates;
    } });
  }
};

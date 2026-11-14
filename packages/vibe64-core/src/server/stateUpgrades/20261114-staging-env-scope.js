import path from "node:path";
import { isPlainObject } from "../isPlainObject.js";
import { listProjectRuntimeRoots } from "../projectState.js";
import { publishStateUpgradeFiles, readUpgradeFile } from "../stateUpgradeFiles.js";

const RENAMED_SCOPE = "prod";
const STAGING_SCOPE = "staging";

// A project's Env values (projects/<slug>/env/user-values.json) keep each
// scope's values under `environments.<scope>`. The published application's
// scope was `prod` until production was renamed staging, and Env now refuses
// `prod`, so its values move to `staging` exactly as saved. Every other field
// and scope is kept; files without `prod` are not touched. A file that already
// has `staging` beside `prod`, which no release wrote, stops the upgrade.
export default {
  id: "20261114-staging-env-scope",
  async run({ systemRoot, apply, backupRoot, report }) {
    await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, async prepareUpdates() {
      const updates = [];
      for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
        const filePath = path.join(projectRuntimeRoot, "env", "user-values.json");
        const label = path.relative(systemRoot, filePath);
        const original = await readUpgradeFile(filePath);
        if (original === null) continue;
        let saved = null;
        try { saved = JSON.parse(original); } catch { /* Reported below without its content. */ }
        if (!isPlainObject(saved) || (saved.environments !== undefined && !isPlainObject(saved.environments))) {
          throw new Error(`Project Env values are invalid: ${label}. Inspect them before upgrading state.`);
        }
        const environments = saved.environments || {};
        if (!Object.hasOwn(environments, RENAMED_SCOPE)) continue;
        if (Object.hasOwn(environments, STAGING_SCOPE)) {
          throw new Error(`Project Env values hold both the prod and the staging scope: ${label}. ` +
            "Inspect them before upgrading state.");
        }
        const { [RENAMED_SCOPE]: values, ...others } = environments;
        report("info", `${label}: ${isPlainObject(values) ? Object.keys(values).length : 0} value(s) move from the prod scope to staging.`);
        updates.push({
          filePath,
          original,
          contents: `${JSON.stringify({ ...saved, environments: { ...others, [STAGING_SCOPE]: values } }, null, 2)}\n`
        });
      }
      return updates;
    } });
  }
};

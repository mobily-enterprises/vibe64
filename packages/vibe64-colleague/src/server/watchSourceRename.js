import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { validateColleagueConversationRecord } from "./conversationRecord.js";
import { parseConversationState } from "./parseConversationState.js";
import { isWatchConditionName, isWatchSourceId } from "./watchSources.js";

// <learner>/learn/lobby.json or <learner>/learn/<attempt id>.json (core's learnThreads.js); each thread's
// runtime folder beside it has the same name without .json.
const LEARN_THREAD_FILE = /^(lobby|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/u;

/**
 * For the numbered upgrade of an owner that renamed a watch source it
 * registers, and perhaps some of its conditions: every Colleague watch on
 * source `from` names `to` instead, and a condition named in `conditions`
 * (old name -> new name) its new name, in the watch, in its cursor's
 * conditionsMet and in each queued observation it made. History and
 * everything else in the record are kept. It reads each person's Develop
 * record and their Learn threads, and checks each record's shape before and
 * after. Check reports how many watches move in each project; apply publishes
 * the changed records with a backup under backupRoot. Offline, with all
 * writers stopped; a second apply changes nothing. Returns { watches }: how
 * many watches were still on `from` when it began, which it renames, or would
 * rename in a check (0 once every one is renamed).
 */
export async function renameColleagueWatchSource({
  systemRoot,
  apply,
  backupRoot,
  report,
  from,
  to,
  conditions
}) {
  if (!isWatchSourceId(from) || !isWatchSourceId(to) || from === to) {
    throw new TypeError("Renaming a Colleague watch source takes two different source names.");
  }
  const renames = conditionRenames(conditions);
  const condition = name => renames.get(name) || name;
  const root = path.join(systemRoot, "colleague");
  await verifyUpgradeParents(systemRoot, path.join(root, "placeholder"));
  const updates = [];
  const moved = new Map();
  for (const person of await directoryEntries(root)) {
    if (!person.isDirectory() || !/^[\w-]+$/u.test(person.name)) {
      throw new Error("Unexpected Colleague state entry. Inspect it before upgrading.");
    }
    const records = [{ filePath: path.join(root, person.name, "conversation.json"), ownerKey: person.name }];
    const learnRoot = path.join(root, person.name, "learn");
    await verifyUpgradeParents(systemRoot, path.join(learnRoot, "placeholder"));
    for (const thread of await directoryEntries(learnRoot)) {
      if (!LEARN_THREAD_FILE.test(thread.name)) continue;
      const name = thread.name.slice(0, -".json".length);
      records.push({ filePath: path.join(learnRoot, thread.name), ownerKey: `${person.name}:learn${name === "lobby" ? "" : `:${name}`}` });
    }
    for (const { filePath, ownerKey } of records) {
      await verifyUpgradeParents(systemRoot, filePath);
      const original = await readUpgradeFile(filePath);
      if (original === null) continue;
      const label = path.relative(systemRoot, filePath);
      const saved = checkedRecord(label, () => parseConversationState(original), ownerKey);
      const watches = saved.watches === undefined ? [] : saved.watches;
      if (!Array.isArray(watches) || watches.some(watch => !watch || typeof watch !== "object") ||
          (saved.observations !== undefined && !Array.isArray(saved.observations))) {
        throw new Error(`${label}: Colleague history has an unsupported shape. Inspect it before upgrading.`);
      }
      const renamed = watches.filter(watch => watch.source === from);
      if (!renamed.length) continue;
      const renamedIds = new Set(renamed.map(watch => watch.watchId));
      const next = checkedRecord(label, () => ({
        ...saved,
        watches: watches.map(watch => watch.source !== from ? watch : {
          ...watch,
          source: to,
          ...(typeof watch.condition === "string" ? { condition: condition(watch.condition) } : {}),
          ...(Array.isArray(watch.cursor?.conditionsMet) ? {
            cursor: { ...watch.cursor, conditionsMet: watch.cursor.conditionsMet.map(condition) }
          } : {})
        }),
        ...(saved.observations ? {
          observations: saved.observations.map(item => item?.source !== from || !renamedIds.has(item.watchId) ? item : {
            ...item,
            source: to,
            ...(typeof item.reason === "string" ? { reason: condition(item.reason) } : {})
          })
        } : {})
      }), ownerKey);
      for (const watch of renamed) {
        const project = typeof watch.projectSlug === "string" ? watch.projectSlug : "";
        const counts = moved.get(project) || { watches: 0, conditions: 0 };
        counts.watches += 1;
        if (renames.has(watch.condition)) counts.conditions += 1;
        moved.set(project, counts);
      }
      updates.push({ filePath, original, contents: JSON.stringify(next) });
    }
  }
  let total = 0;
  for (const [project, counts] of [...moved].sort(([left], [right]) => left.localeCompare(right))) {
    report("info", `${project ? `Project ${project}` : "No project"}: ${counts.watches} watch(es) on ${from} now watch ${to}` +
      `${counts.conditions ? `, ${counts.conditions} with a renamed condition` : ""}.`);
    total += counts.watches;
  }
  // A retry with this backup's manifest finishes its publication and ignores these updates.
  await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, prepareUpdates: async () => updates });
  return { watches: total };
}

// The condition renames as a map, refused unless a plain object of condition names whose new names all differ.
function conditionRenames(conditions) {
  const plain = conditions && typeof conditions === "object" && !Array.isArray(conditions) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(conditions));
  const entries = plain ? Object.entries(conditions) : [];
  if (!plain || entries.some(([before, after]) => !isWatchConditionName(before) || !isWatchConditionName(after)) ||
      new Set(entries.map(([, after]) => after)).size !== entries.length) {
    throw new TypeError("Renaming a Colleague watch source takes its condition renames as old name -> new name, each new name once.");
  }
  return new Map(entries);
}

// A record read or made through `make`, refused with its file's path when its shape is wrong.
function checkedRecord(label, make, ownerKey) {
  try {
    const record = make();
    validateColleagueConversationRecord(record, ownerKey);
    return record;
  } catch (error) {
    throw new Error(`${label}: ${error.message}`, { cause: error });
  }
}

// A folder's entries by name, none when it does not exist.
async function directoryEntries(folder) {
  try {
    if (!(await lstat(folder)).isDirectory()) throw new Error(`State upgrade requires a regular directory: ${folder}`);
    return (await readdir(folder, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

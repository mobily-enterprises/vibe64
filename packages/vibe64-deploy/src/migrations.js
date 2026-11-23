// A Deploy's migrations, where its provider runs a release's task once per refresh (the adapter's `taskOf`): which
// release carries them, what the record keeps once they ran, and what the Deploy's reports say of them. Where the
// provider runs no release task (an adapter without taskOf), every serve script migrates as its instance starts and
// none of this applies.
import { createHash } from "node:crypto";

// What a step that hands a release with the migrations says: they run once, before that release starts any instance.
const MIGRATING = ", which first runs the migrations once";
// What a failure says once this Deploy's migrations ran: the version still serving now runs on the migrated database.
const MIGRATED_NOTE = " Its migrations ran, so the version before serves on the migrated database: an app's migrations must work with the "
  + "version before them (add first, remove in a later release).";
// What a failed task's outcome (the adapter's readRefresh) says the migrations did.
const FAILED_WORDS = Object.freeze({ failed: "they exited with an error", timeout: "they ran past their time limit", machine_failed: "their machine failed" });
// The most migrated releases the record keeps, newest first: a Deploy of one of them (an earlier version deployed
// again) runs no migrations, its database having run them and more.
const MIGRATED_KEPT = 50;

/**
 * What a Deploy's migrations are: the services whose declaration runs the migrate task (`taskOf`), and the fingerprint of the code they migrate (the archive, its scripts with it), which the
 * record keeps once they ran. Null where they run as each instance starts or the app has no Migrate step.
 * @param {any} adapter @param {any} needs @param {{ archive: Buffer, declarations: Record<string, any> }} release
 */
function migrationsOf(adapter, needs, release) {
  if (typeof adapter.taskOf !== "function") return null;
  const services = needs.services.filter((service) => adapter.taskOf(release.declarations[service.id]) === "migrate").map((service) => service.id);
  if (services.length === 0) return null;
  return { services, fingerprint: `sha256:${createHash("sha256").update(release.archive).digest("hex")}` };
}

/**
 * Whether the release handed to a service carries the migrations: the first this Deploy hands, of code the database
 * hasn't run. @param {any} migrations migrationsOf's @param {any} record @param {string} serviceId
 */
function migrationDue(migrations, record, serviceId) {
  return Boolean(migrations) && !record.run.migration && migrations.services.includes(serviceId)
    && !(record.migrated ?? []).some((one) => one.fingerprint === migrations.fingerprint);
}

/**
 * Notes in the record's run the migrations the first hand-over of this Deploy asked for (`handed.task`), or that it
 * skips them, and answers what its report says.
 * @param {any} record @param {any} migrations @param {{ service: string, task?: string }} handed
 */
function noteHandOver(record, migrations, handed) {
  const { run } = record;
  if (!migrations || run.migration) return null;
  if (handed.task) {
    run.migration = { service: handed.service, state: "asked" };
    run.services[handed.service].migrating = migrations.fingerprint;
    return "Its refresh runs the migrations once, on a temporary machine of the new release, before any instance starts.";
  }
  run.migration = { service: handed.service, state: "skipped" };
  const [latest] = record.migrated ?? [];
  if (latest && latest.fingerprint !== migrations.fingerprint) {
    return `Migrations skipped: the database already ran this code's migrations, and those of a later release (${latest.release}), `
      + "so this code runs on the later schema: deploying an earlier version returns its code, never its schema.";
  }
  return "Migrations skipped: the database already ran this code's migrations.";
}

/**
 * How the migrations a service's refresh ran went, once that refresh is read: the record keeps those that ran (the
 * release of its run), and the run says whether they ran or failed. Answers the task (the adapter's readRefresh
 * `task: { name, state, instanceId, outcome }`, `state` `asked`, `running`, `succeeded` or `failed`) with the
 * report's message, which names the instance whose logs hold their output, or `{ task: null }` where the refresh ran
 * none of this Deploy's.
 * @param {any} record @param {{ migrating?: string }} state the service's state in the run @param {any} refresh
 */
function noteTask(record, state, refresh) {
  const task = state.migrating ? refresh?.task : null;
  if (!task) return { task: null };
  if (task.state === "succeeded") {
    record.migrated = [{ fingerprint: state.migrating, release: record.run.release, at: refresh.finishedAt ?? null },
      ...(record.migrated ?? []).filter((one) => one.fingerprint !== state.migrating)].slice(0, MIGRATED_KEPT);
  }
  if (["succeeded", "failed"].includes(task.state)) record.run.migration = { ...record.run.migration, state: task.state === "failed" ? "failed" : "ran" };
  const where = task.instanceId ? ` Their output is in the logs of ${task.instanceId}.` : "";
  const message = task.state === "succeeded" ? `The migrations ran once.${where}`
    : task.state === "failed" ? `The migrations failed${FAILED_WORDS[task.outcome] ? `: ${FAILED_WORDS[task.outcome]}` : ""}.${where}`
      : "The migrations did not run: the refresh ended before them.";
  return { task, message };
}

export { MIGRATED_NOTE, MIGRATING, migrationDue, migrationsOf, noteHandOver, noteTask };

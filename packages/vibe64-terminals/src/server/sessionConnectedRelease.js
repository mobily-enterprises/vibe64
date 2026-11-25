// Save's part for the session's connections in its own source, between pushing the copies and its
// own commit: each composition copy's saved commit is pinned in the project's connections lock, so
// the project's main names exactly what it was saved with; typed dependencies move to newly
// published versions; the Stack's Save entries run. Only a Save that saves something does it, and
// whether a session has something to save is answered here, once, for Save and its status alike.
import { rm } from "node:fs/promises";
import path from "node:path";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { connectedRepositoryName, sessionConnectedCopies } from "@local/vibe64-core/server/projectRepository";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { GENESIS_DERIVED_ARTIFACT_PATHS } from "@local/vibe64-genesis/server";
import { CONNECTIONS_LOCK_FILE } from "@local/vibe64-genesis/shared/connectedPackageTypes";
import { connectedCopyError, inspectConnectedCopies, shortCommit } from "./sessionConnectedCopies.js";
import { runGit } from "./sessionSource.js";
import { saveError } from "./sessionWorkCommands.js";
import { inspectSessionWork } from "./sessionWorkSave.js";

/**
 * Whether a session has work to save: the one answer Save gives, which its status shows and every
 * check of it reads. Its work is changes in its own source, a connected copy's (files, or commits
 * its main lacks), or a connections lock behind the copies, as after Update moves a composition
 * copy onto its main's newer commit: Save records that pin, and nothing else writes the lock.
 * @param {{ ownUnsaved: boolean, copiesUnsaved: boolean, pins: { changed: boolean } }} work
 */
function sessionHasWorkToSave({ ownUnsaved, copiesUnsaved, pins }) {
  return ownUnsaved || copiesUnsaved || pins.changed;
}

/**
 * What Save would pin from these copies' recorded commits: Project's plan of the connections lock.
 * @param {{ copies: object[], project: ProjectService, session: object }} input
 * @returns {Promise<{ changed: boolean, compositions: string[], pinsToRecord: Array<{ fullName: string, commit: string }> }>}
 */
async function planCopyPins({ copies, project, session }) {
  if (!copies.length) return { changed: false, compositions: [], pinsToRecord: [] };
  return project.planCompositionPins({
    session,
    commits: Object.fromEntries(copies.map(copy => [copy.repository, copy.canonicalCommit]))
  });
}

/**
 * The session's work to save, read without changing anything: its own repository's (`own`), each
 * connected copy's (`connected`), the pins Save would record (`pinsToRecord`) and the answer
 * (`unsaved`).
 * @param {{ project: ProjectService, projectRecord: object, session: object }} input
 */
async function inspectSessionWorkToSave({ project, projectRecord, session }) {
  const copies = sessionConnectedCopies(session);
  const own = await inspectSessionWork({ derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS, project: projectRecord, session });
  const connected = await inspectConnectedCopies({
    copies,
    derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
    project: projectRecord,
    session
  });
  const pins = await planCopyPins({ copies, project, session });
  return {
    connected,
    own,
    pinsToRecord: pins.pinsToRecord,
    unsaved: sessionHasWorkToSave({ ownUnsaved: own.unsaved === true, copiesUnsaved: connected.some(copy => copy.unsaved), pins })
  };
}

/**
 * A failure after Save pushed connected copies: they are on their main, and the project's own
 * source does not name them yet. It keeps the failure's own fields, says what was saved, and stays
 * retryable: the next Save has nothing to push and records them.
 * @param {unknown} error
 * @param {Array<{ name: string, saveCommit: string }>} connected the copies this Save pushed
 * @param {string[]} compositions the composition connections, as GitHub owner/name
 */
function savedCopiesPending(error, connected, compositions) {
  const saved = connected.map(copy => `${copy.name} at ${shortCommit(copy.saveCommit)}`).join(", ");
  const pinned = connected.filter(copy => compositions.some(fullName => connectedRepositoryName(fullName) === copy.name));
  const consequence = pinned.length
    ? `so its main still pins the earlier commit of ${pinned.map(copy => copy.name).join(" and ")}`
    : "so this session's own work is not saved yet";
  const reason = toText(error?.message) || "It failed.";
  // Its own message replaces the failure's translated one; every other field stays.
  const { messageCode: _messageCode, messageParams: _messageParams, ...fields } = typeof error === "object" && error ? { ...error } : {};
  const code = toText(error?.code) || "vibe64_session_save_failed";
  const where = connected.length === 1 ? "its" : "their";
  const pending = saveError(
    `Saved ${saved} to ${where} main, but this project's own source is not saved, ${consequence}. ${reason} Save again to finish.`,
    code,
    {},
    { status: Number(fields.status) || 409 }
  );
  return Object.assign(pending, fields, { cause: error, code, connected, retryable: error?.retryable !== false });
}

/**
 * The commit and tree each of these copies pins in the project's connections lock: its saved
 * commit on its main, as the session's record names it after Save.
 * @param {object} input
 * @param {Array<object>} input.copies the session's copy records
 * @param {(copy: object) => Promise<{ runCommand: Function }>} input.executionFor
 * @returns {Promise<Array<{ fullName: string, commit: string, tree: string }>>}
 */
async function connectedCopyPins({ copies, executionFor }) {
  const pins = [];
  for (const copy of copies) {
    try {
      const { runCommand } = await executionFor(copy);
      const tree = await runGit(copy.path, ["rev-parse", "--verify", `${copy.canonicalCommit}^{tree}`], [path.dirname(copy.path), copy.path], {
        runCommand
      });
      pins.push({ fullName: copy.repository, commit: copy.canonicalCommit, tree });
    } catch (error) {
      throw connectedCopyError(copy.name, error);
    }
  }
  return pins;
}

/**
 * The connected release of a session's Saves, and its connections lock on Update.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {WorkspaceSetupRunner} dependencies.workspaceSetup
 */
function createSessionConnectedRelease({ project, workspaceSetup }) {
  /**
   * Records the connections in the session's own source: each composition copy's pin (the
   * connections lock), the published versions of its typed dependencies (Project moves the manifest
   * and lock only to a published one), and the Stack's Save entries, which stop the commit when they
   * fail. Resolves to its lines.
   */
  async function recordRelease({ compositions, execution, onProgress, runtime, session, sessionId }) {
    const lines = [];
    const say = async (line) => {
      lines.push(line);
      await onProgress({ kind: "connected", message: line, stage: "connected-recording" });
    };
    if (compositions.length) {
      // The copies' records after this Save's push name their new main commits.
      const records = sessionConnectedCopies(await runtime.getSessionWithoutSource(sessionId))
        .filter(copy => compositions.includes(copy.repository));
      const pins = await connectedCopyPins({ copies: records, executionFor: execution.executionFor });
      if ((await project.recordCompositionPins({ session, pins })).changed) {
        await say(`[Connected] ${CONNECTIONS_LOCK_FILE} pins ${pins.map(pin => `${pin.fullName} at ${shortCommit(pin.commit)}`).join(", ")}.`);
      }
    }
    const runner = await workspaceSetup.connectedSaveRunner({ runtime, session });
    if (!runner) return lines;
    if (runner.dependencies) {
      const bumps = await project.bumpConnectedDependencies({ session, runCommand: runner.runCommand }).catch(error => ({
        lines: [`[Connected] Vibe64 could not check the connected dependencies for published versions: ${toText(error?.message) || "it failed"}.`]
      }));
      for (const line of bumps.lines) await say(line);
    }
    for (const step of runner.saveSteps) {
      const result = await runner.runCommand({ command: step.argv[0], args: step.argv.slice(1), cwd: step.cwd });
      const output = toText(result?.stdout || result?.output);
      if (output) await say(`[${step.label}] ${output.split("\n").slice(-20).join("\n")}`);
      if (result?.ok !== true) {
        throw saveError(
          `The connected Save step ${step.label} failed: ${toText(result?.stderr || result?.error) || "it exited with an error"}.`,
          "vibe64_connected_save_step_failed"
        );
      }
    }
    return lines;
  }

  /**
   * One Save's connected release, planned before its copies push from the lock and the copies'
   * records.
   * @param {object} input
   * @param {object[]} input.copies the session's copy records
   * @param {{ executionFor: Function }} input.execution the copies' Git execution
   * @param {Function} input.onProgress
   * @param {object} input.runtime
   * @param {object} input.session
   * @param {string} input.sessionId
   */
  async function planConnectedSave({ copies, execution, onProgress, runtime, session, sessionId }) {
    const pins = await planCopyPins({ copies, project, session });
    // Whatever stops the Save once copies pushed leaves their main ahead of what the project names,
    // so it says so and stays retryable.
    const finishing = async (connected, operation) => {
      try {
        return await operation();
      } catch (error) {
        throw connected.length ? savedCopiesPending(error, connected, pins.compositions) : error;
      }
    };
    return Object.freeze({
      finishing,
      // Whether this Save has work, given the copies about to push: Save refuses before any push when not.
      hasWork: (ownUnsaved, ready) => sessionHasWorkToSave({ ownUnsaved, copiesUnsaved: ready.length > 0, pins }),
      // The session's own repository saves too when it has work, when the lock is behind the copies
      // or when a composition is about to push: its Save is then refused first, before any push.
      ownSaves: (ownUnsaved, ready) => ownUnsaved || pins.changed || ready.some(copy => pins.compositions.includes(copy.repository)),
      // A Save with copies records once they pushed; one with nothing to save was refused before.
      record: async (connected) => {
        if (!copies.length) return [];
        const recording = { compositions: pins.compositions, execution, onProgress, runtime, session, sessionId };
        return finishing(connected, () => recordRelease(recording));
      }
    });
  }

  /**
   * Save writes the connections lock from the copies, so one an unfinished Save left changed is put
   * back as the session's last commit has it before Update merges: it never conflicts, the session
   * takes its main's pins, and the next Save writes the copies' again.
   */
  async function restoreUnsavedConnectionsLock(session, execution) {
    const sourcePath = sessionSourcePath(session);
    const git = (args) => runGit(sourcePath, args, [path.dirname(sourcePath), sourcePath], { runCommand: execution.runCommand });
    if (!(await git(["status", "--porcelain=v1", "--untracked-files=all", "--", CONNECTIONS_LOCK_FILE]))) return;
    if (await git(["ls-tree", "--name-only", "HEAD", "--", CONNECTIONS_LOCK_FILE])) {
      await git(["checkout", "HEAD", "--", CONNECTIONS_LOCK_FILE]);
    } else {
      await rm(path.join(sourcePath, CONNECTIONS_LOCK_FILE), { force: true });
    }
  }

  return Object.freeze({
    planConnectedSave,
    restoreUnsavedConnectionsLock
  });
}

export { createSessionConnectedRelease, inspectSessionWorkToSave };

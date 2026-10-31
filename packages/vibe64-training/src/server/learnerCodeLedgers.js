import { mkdir } from "node:fs/promises";
import path from "node:path";

import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";

import { failure, inspectPath, MAX_CODE_LEDGER_BYTES, readRecord, uuidPattern, validateCodeLedger } from "./learnerRecords.js";

/**
 * The code authorship ledger of each practice attempt, read and updated
 * under its own lock.
 * @param {object} dependencies
 * @param {(request: { actor: object, attemptId: string }) => Promise<object | null>} dependencies.activeAttemptForProject
 * @param {(paths: object) => Promise<void>} dependencies.createNamespace
 * @param {(paths: object) => Promise<object>} dependencies.loadState
 * @param {(actor: object) => object} dependencies.userPaths
 */
function createLearnerCodeLedgers({ activeAttemptForProject, createNamespace, loadState, userPaths }) {
  // Code ledgers: one private record per attempt in progress, so autosaves
  // never advance the learning revision. Ending the attempt removes it.
  function ledgerPath(paths, attemptId) {
    if (!uuidPattern.test(attemptId || "")) throw new Error("Use an exact attempt ID.");
    return path.join(paths.codeLedgers, `${attemptId}.json`);
  }

  async function readCodeLedgerRecord(paths, attemptId) {
    const value = await readRecord(ledgerPath(paths, attemptId), MAX_CODE_LEDGER_BYTES);
    if (!value) return null;
    const ledger = validateCodeLedger(value);
    if (ledger.learnerId !== paths.learner.id || ledger.attemptId !== attemptId) {
      throw new Error("The code authorship ledger belongs to another learner or attempt.");
    }
    return ledger;
  }

  async function readCodeLedger({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    ledgerPath(paths, attemptId);
    await loadState(paths);
    return readCodeLedgerRecord(paths, attemptId);
  }

  async function withLedgerLock(paths, operation) {
    await createNamespace(paths);
    await mkdir(paths.codeLedgers, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    await inspectPath(paths.codeLedgers, true);
    await inspectPath(paths.codeLedgerLock, false);
    const release = await tryAcquireExclusiveFileLock(paths.codeLedgerLock);
    if (!release) {
      throw failure("VIBE64_TRAINING_CODE_LEDGER_BUSY", "Another save of this lesson's code is being recorded. Save again in a moment.", 409);
    }
    try { return await operation(); } finally { await release(); }
  }

  async function updateCodeLedger({ actor, attemptId } = {}, operation) {
    const paths = userPaths(actor);
    if (typeof operation !== "function") throw new Error("Update the code ledger of an exact attempt.");
    const attempt = await activeAttemptForProject({ actor, attemptId });
    if (!attempt) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "Continue this practice project's lesson before recording code work.", 404);
    }
    return withLedgerLock(paths, async () => {
      const current = await readCodeLedgerRecord(paths, attemptId);
      const result = await operation(current ? structuredClone(current) : null, { learnerId: paths.learner.id, attempt });
      if (!result?.ledger) return { ledger: current, value: result?.value };
      const ledger = validateCodeLedger({ ...result.ledger, schemaVersion: 2, learnerId: paths.learner.id, attemptId });
      await writeJsonFileAtomic(ledgerPath(paths, attemptId), ledger, { directoryMode: 0o700, fileMode: 0o600 });
      return { ledger, value: result.value };
    });
  }

  return { ledgerPath, readCodeLedger, updateCodeLedger, withLedgerLock };
}

export { createLearnerCodeLedgers };

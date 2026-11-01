import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import process from "node:process";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { normalizeTargetRoot, vibe64Error } from "@local/vibe64-core/server/core";
import { validateLearningSessionScope } from "./sessionRecordRules.js";
import { createClockNow, systemClock } from "./sessionStoreLayout.js";

const sessionMutationContext = new AsyncLocalStorage();

/**
 * One store's settings, resolved once from its options: the admitted learning
 * scope, its roots, clock and renewal step hooks, its lock options, and the
 * mutation context that nested session mutations of this process share.
 * @param {object} options
 * @param {() => Date | string | number} [options.clock]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [options.logger]
 * @param {object | null} [options.learningScope] the admitted learning session scope
 * @param {(step: object) => Promise<unknown>} [options.onRenewalArchiveCommitStep]
 * @param {(step: object) => Promise<unknown>} [options.onRenewalQuiesceStep]
 * @param {string} [options.projectContextRoot]
 * @param {string} [options.projectRuntimeRoot]
 * @param {string} [options.projectSessionSourceRoot]
 * @param {string} [options.sessionLockProcessPlatform]
 */
function createSessionStoreState({
  clock = systemClock,
  logger = silentLogger,
  learningScope = null,
  onRenewalArchiveCommitStep = null,
  onRenewalQuiesceStep = null,
  projectContextRoot = process.cwd(),
  projectRuntimeRoot = "",
  projectSessionSourceRoot = "",
  sessionLockProcessPlatform = process.platform
} = {}) {
  const admittedLearningScope = validateLearningSessionScope(learningScope);
  // A practice scope is accepted, with its actual source root, only for the published
  // 20261008-learning-practice-history readers, which verify adoption with it.
  if (admittedLearningScope && !projectSessionSourceRoot) {
    throw vibe64Error("A practice learning runtime requires its actual project session source root.", "vibe64_learning_scope_invalid");
  }
  const normalizedProjectContextRoot = normalizeTargetRoot(projectContextRoot);
  const resolvedProjectRuntimeRoot = String(projectRuntimeRoot || "").trim();
  if (!resolvedProjectRuntimeRoot) {
    throw vibe64Error("Vibe64 session store requires projectRuntimeRoot.", "vibe64_project_runtime_root_required");
  }
  const normalizedStateRoot = path.resolve(resolvedProjectRuntimeRoot);
  const now = createClockNow(clock);
  const renewalArchiveCommitStep = typeof onRenewalArchiveCommitStep === "function"
    ? onRenewalArchiveCommitStep
    : async () => undefined;
  const renewalQuiesceStep = typeof onRenewalQuiesceStep === "function"
    ? onRenewalQuiesceStep
    : async () => undefined;

  return Object.freeze({
    admittedLearningScope,
    logger,
    normalizedProjectContextRoot,
    normalizedStateRoot,
    now,
    projectSessionSourceRoot,
    renewalArchiveCommitStep,
    renewalQuiesceStep,
    sessionLockProcessPlatform,
    sessionMutationContext
  });
}

export {
  createSessionStoreState
};

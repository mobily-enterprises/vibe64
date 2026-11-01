import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";

import { byteSize, failure, inspectPath, MAX_REVIEW_HELPER_BYTES, readRecord } from "./learnerRecords.js";

/**
 * One step review at a time per learner, with its Helper's private root and
 * receipt.
 * @param {object} dependencies
 * @param {(paths: object) => Promise<void>} dependencies.createNamespace
 * @param {(actor: object) => object} dependencies.userPaths
 */
function createLearnerReviews({ createNamespace, userPaths }) {
  /**
   * One AI review at a time per learner. The review owner keeps its retained
   * Helper below its own root, and the Helper's receipt in this learner's
   * record, so a review that stopped part-way is cleaned before the next.
   */
  async function readReviewHelperRecord(paths) {
    const value = await readRecord(paths.reviewHelper, MAX_REVIEW_HELPER_BYTES);
    if (!value) return null;
    if (value.schemaVersion !== 1 ||
        value.learnerId !== paths.learner.id ||
        Object.keys(value).sort().join() !== "helper,learnerId,schemaVersion" ||
        value.helper !== null && (typeof value.helper !== "object" || Array.isArray(value.helper))) {
      throw new Error("The review Helper receipt is invalid or belongs to another learner.");
    }
    return value.helper;
  }

  async function runReviewExclusive({ actor }, operation) {
    const paths = userPaths(actor);
    if (typeof operation !== "function") throw new Error("Run a review with an admitted server operation.");
    await createNamespace(paths);
    const lock = await inspectPath(paths.reviewLock, false);
    if (lock && lock.size !== 0) throw new Error("Learning state lock contains unexplained data; inspect it before retrying.");
    const release = await tryAcquireExclusiveFileLock(paths.reviewLock);
    if (!release) {
      throw failure(
        "A review of your work is already running. Wait for it to finish, then check again.",
        "VIBE64_TRAINING_REVIEW_BUSY",
        409
      );
    }
    try {
      const receipt = {
        read: () => readReviewHelperRecord(paths),
        async write(helper) {
          const record = { schemaVersion: 1, learnerId: paths.learner.id, helper: helper ?? null };
          if (byteSize(record) > MAX_REVIEW_HELPER_BYTES) throw new Error("The review Helper receipt exceeds its record limit.");
          await writeJsonFileAtomic(paths.reviewHelper, record, { directoryMode: 0o700, fileMode: 0o600 });
        }
      };
      return await operation({ root: paths.reviewHelpers, receipt });
    } finally {
      await release();
    }
  }

  return Object.freeze({ runReviewExclusive });
}

export { createLearnerReviews };

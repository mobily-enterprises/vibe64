
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";

import { LEARNER_NOTES_MAX_CHARS as MAX_NOTES_CHARS, TRAINING_NOTES_CHANGED_CODE } from "../shared/learnerContract.js";
import { validateContent } from "./contentSchemas.js";
import {
  failure,
  inspectDirectoryChain,
  inspectPath,
  isoTime,
  MAX_NOTES_BYTES,
  MAX_NOTES_REQUESTS,
  notesSchema,
  readRecord,
  requestPattern,
  sha256Pattern,
  validNotesText
} from "./learnerRecords.js";
import { sha256Hex } from "@local/vibe64-core/server/sha256Hex";

/**
 * A learner's teacher notes: read and saved under their own lock.
 * @param {object} dependencies
 * @param {(lockPath: string, code: string, message: string) => Promise<() => Promise<void>>} dependencies.acquireRecordLock
 * @param {(paths: object) => Promise<void>} dependencies.createNamespace
 * @param {string} dependencies.systemRoot
 * @param {(actor: object) => object} dependencies.userPaths
 */
function createLearnerNotes({
  acquireRecordLock,
  createNamespace,
  systemRoot,
  userPaths
}) {
  /**
   * Learner notes: the teacher's private summary of this one
   * learner, in that learner's own Learning state with its own lock. The
   * authenticated actor alone selects the file, so no caller can name another
   * learner. Notes never take part in admission, step results or completion.
   */
  async function readNotesRecord(paths) {
    await inspectDirectoryChain(systemRoot);
    for (const directory of paths.directories) await inspectPath(directory, true);
    const value = await readRecord(paths.notes, MAX_NOTES_BYTES);
    if (!value) return null;
    const record = validateContent(notesSchema, value, "Learner notes");
    const identities = new Set(record.requests.map(request => request.requestId));
    if (record.learnerId !== paths.learner.id || !isoTime(record.updatedAt) || !validNotesText(record.text) ||
        identities.size !== record.requests.length || record.requests.some(request => !requestPattern.test(request.requestId) ||
          !sha256Pattern.test(request.textHash) || request.revision > record.revision)) {
      throw new Error("The notes belong to another learner or contain an invalid time, text or request.");
    }
    return record;
  }

  const notesProjection = record => record
    ? { text: record.text, revision: record.revision, updatedAt: record.updatedAt, updatedBy: record.updatedBy }
    : { text: "", revision: 0, updatedAt: null, updatedBy: null };

  async function readTeacherNotes({ actor } = {}) {
    const paths = userPaths(actor);
    try {
      return notesProjection(await readNotesRecord(paths));
    } catch (cause) {
      throw failure(
        `Learner notes are invalid: ${cause.message} Keep the file and ask the owner to inspect it.`,
        "VIBE64_TRAINING_NOTES_STATE_INVALID",
        null,
        { cause }
      );
    }
  }

  /**
   * Replaces the whole summary (clearing is the empty text). The same request
   * ID with the same text replays the saved result; expectedRevision, when
   * given, refuses to overwrite a newer change by the learner or Colleague.
   */
  async function saveTeacherNotes({ actor, text: value, requestId, updatedBy, expectedRevision } = {}) {
    const paths = userPaths(actor);
    if (typeof value !== "string" || value.length > MAX_NOTES_CHARS || !validNotesText(value) ||
        !requestPattern.test(requestId || "") || !["colleague", "learner"].includes(updatedBy) ||
        (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0))) {
      throw failure(
        `Save learner notes as text of at most ${MAX_NOTES_CHARS} characters without control characters, with an exact request ID.`,
        "VIBE64_TRAINING_NOTES_INVALID",
        400
      );
    }
    const textHash = sha256Hex(value);
    await createNamespace(paths);
    const release = await acquireRecordLock(
      paths.notesLock,
      "VIBE64_TRAINING_NOTES_BUSY",
      "The learner notes are being saved. Retry the same request in a moment."
    );
    try {
      let record;
      try {
        record = await readNotesRecord(paths);
      } catch (cause) {
        throw failure(
          `Learner notes are invalid: ${cause.message} Keep the file and ask the owner to inspect it; nothing was saved.`,
          "VIBE64_TRAINING_NOTES_STATE_INVALID",
          null,
          { cause }
        );
      }
      const replay = record?.requests.find(request => request.requestId === requestId);
      if (replay) {
        if (replay.textHash !== textHash) {
          throw failure(
            "This request ID already saved different notes. Use a new request ID.",
            "VIBE64_TRAINING_NOTES_REQUEST_REUSED",
            409
          );
        }
        return { notes: notesProjection(record), replayed: true, changed: false };
      }
      const current = record?.revision || 0;
      if (expectedRevision !== undefined && expectedRevision !== current) {
        throw failure(
          "The notes changed since they were read. Read them again and save the combined summary; nothing was saved.",
          TRAINING_NOTES_CHANGED_CODE,
          409
        );
      }
      if (current === Number.MAX_SAFE_INTEGER) {
        throw failure("Learner notes reached their revision limit. Nothing was saved.", "VIBE64_TRAINING_NOTES_REVISION_LIMIT", null);
      }
      const next = {
        schemaVersion: 1,
        learnerId: paths.learner.id,
        revision: current + 1,
        text: value,
        updatedAt: new Date().toISOString(),
        updatedBy,
        requests: [...record?.requests || [], { requestId, textHash, revision: current + 1 }].slice(-MAX_NOTES_REQUESTS)
      };
      const validated = validateContent(notesSchema, next, "Learner notes");
      if (Buffer.byteLength(JSON.stringify(validated)) > MAX_NOTES_BYTES) {
        throw failure(
          "The learner notes exceed their storage bound. Shorten them; nothing was saved.",
          "VIBE64_TRAINING_NOTES_INVALID",
          400
        );
      }
      try {
        await writeJsonFileAtomic(paths.notes, validated, { directoryMode: 0o700, fileMode: 0o600 });
      } catch (cause) {
        throw failure(
          "The notes save was not confirmed; the atomic rename may have succeeded. Read the notes or retry the same request ID.",
          "VIBE64_TRAINING_NOTES_SAVE_UNCONFIRMED",
          null,
          { cause }
        );
      }
      return { notes: notesProjection(validated), replayed: false, changed: true };
    } finally {
      await release();
    }
  }

  return Object.freeze({ readTeacherNotes, saveTeacherNotes });
}

export { createLearnerNotes };

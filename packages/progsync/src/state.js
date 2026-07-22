import crypto from "node:crypto";

import { ProgSyncError } from "./errors.js";

function sourceHash(file) {
  if (!file?.exists) {
    return null;
  }
  return crypto.createHash("sha256").update(file.source).digest("hex");
}

function pairDigest(pair) {
  return crypto
    .createHash("sha256")
    .update(pair.programPath)
    .update("\0")
    .update(pair.implementationPath)
    .digest("hex");
}

function fileChanged(previous, current) {
  if (Boolean(previous?.exists) !== Boolean(current?.exists)) {
    return true;
  }
  if (!previous?.exists && !current?.exists) {
    return false;
  }
  return previous.source !== current.source || previous.mode !== current.mode;
}

function classifyPair(snapshot) {
  const { P0, P1, I0, I1 } = snapshot;

  if (!P1.exists && !I1.exists) {
    throw new ProgSyncError(
      "PAIR_MISSING",
      "Neither Program nor managed implementation exists."
    );
  }
  if (!P1.exists && I1.exists) {
    if (P0.exists) {
      throw new ProgSyncError(
        "EXPLICIT_PROGRAM_DELETION_REQUIRED",
        "Program disappeared after the accepted baseline. Use an explicit delete or rename operation."
      );
    }
    return "CREATE_PROGRAM";
  }
  if (P1.exists && !I1.exists) {
    if (I0.exists) {
      throw new ProgSyncError(
        "EXPLICIT_IMPLEMENTATION_DELETION_REQUIRED",
        "Managed implementation disappeared after the accepted baseline. Use an explicit delete or rename operation."
      );
    }
    return "CREATE_IMPLEMENTATION";
  }

  const programChanged = fileChanged(P0, P1);
  const implementationChanged = fileChanged(I0, I1);
  if (!programChanged && !implementationChanged) {
    return "NO_CHANGE";
  }
  if (programChanged && implementationChanged) {
    return "RECONCILE_BOTH";
  }
  if (programChanged) {
    return "PROGRAM_TO_IMPLEMENTATION";
  }
  return "IMPLEMENTATION_TO_PROGRAM";
}

function snapshotSummary(snapshot) {
  return {
    acceptedCommit: snapshot.checkpoint?.applicable
      ? snapshot.checkpoint.stateCommit
      : snapshot.baseCommit,
    baseCommit: snapshot.baseCommit,
    baselineKind: snapshot.baselineKind || "git",
    baselineReason: snapshot.baselineReason || null,
    branch: snapshot.currentGit?.branch || null,
    head: snapshot.currentGit?.head || snapshot.baseCommit || null,
    P0: { exists: snapshot.P0.exists, hash: sourceHash(snapshot.P0), mode: snapshot.P0.mode },
    P1: { exists: snapshot.P1.exists, hash: sourceHash(snapshot.P1), mode: snapshot.P1.mode },
    I0: { exists: snapshot.I0.exists, hash: sourceHash(snapshot.I0), mode: snapshot.I0.mode },
    I1: { exists: snapshot.I1.exists, hash: sourceHash(snapshot.I1), mode: snapshot.I1.mode }
  };
}

export {
  classifyPair,
  fileChanged,
  pairDigest,
  snapshotSummary,
  sourceHash
};

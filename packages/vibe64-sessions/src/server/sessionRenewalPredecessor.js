import {
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  createSessionRenewalDraft,
  mutateSessionRenewalState
} from "./sessionRenewalState.js";
import { assertWorkspaceIdle, manualDraftTemplate, renewalError, sourceEnvelopesMatch, statePatch } from "./sessionRenewalRules.js";

/** @typedef {ReturnType<typeof import("./sessionRenewalAccess.js").createRenewalSessionAccess>} RenewalSessionAccess */
/** @typedef {ReturnType<typeof import("./sessionWorkspaceSetup.js").createTerminalsSetupRunner>} WorkspaceSetupRunner */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

/**
 * The session being renewed: its terminal admission, its terminals and
 * process-exit proof, its idleness, and the handover reviewed from it.
 * @param {object} dependencies
 * @param {RenewalSessionAccess} dependencies.renewalAccess
 * @param {WorkspaceSetupRunner} dependencies.setupRunner
 * @param {TerminalsService} dependencies.terminals
 */
function createRenewalPredecessorSession({ renewalAccess, setupRunner, terminals }) {
  async function freezePredecessorTerminalAdmission(state = {}) {
    return terminals.freezeSessionTerminalAdmissionForRenewal(state.sessionId, {
      renewalId: state.renewalId
    });
  }

  async function thawPredecessorTerminalAdmission(state = {}) {
    return terminals.thawSessionTerminalAdmissionForRenewal(state.sessionId, {
      renewalId: state.renewalId
    });
  }

  async function closePredecessorTerminals(runtime, state, session = null) {
    const predecessor = session || await renewalAccess.readInternalSession(runtime, state.sessionId);
    return terminals.closeRenewalPredecessorSessionTerminals(predecessor, {
      renewalId: state.renewalId,
      runtime
    });
  }

  async function releasePredecessorProcessExitProof(runtime, state, session = null) {
    const predecessor = session || await renewalAccess.readInternalSession(runtime, state.sessionId);
    return terminals.releaseRenewalPredecessorProcessExitProof(predecessor, {
      renewalId: state.renewalId,
      runtime
    });
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} [sessionId]
   * @param {object | null} [session]
   */
  async function assertPredecessorIdle(runtime, sessionId = "", session = null) {
    const predecessor = session || await runtime.getSession(sessionId, {
      inspectSource: false
    });
    assertWorkspaceIdle(predecessor, setupRunner);
    await terminals.assertSessionRenewalIdle(sessionId, {
      runtime,
      session: predecessor
    });
    return predecessor;
  }

  async function returnToRenewalReview(runtime, state, basis) {
    const savedDraft = state.approved || state.draft;
    let text = savedDraft.text;
    if (!sourceEnvelopesMatch(basis.source, state.basis?.source)) {
      const sourceSection = /^## Saved source\n([\s\S]*?)(?=^## Touched areas$)/mu;
      const sourceField = /^- (Authority|Repository|Ref|Commit): /u;
      const templateSource = manualDraftTemplate(terminals, basis).match(sourceSection)[1];
      const sourceLines = templateSource.split("\n").filter((line) => sourceField.test(line));
      text = text.replace(sourceSection, (_match, content) => {
        const notes = content.split("\n").filter((line) => !sourceField.test(line));
        return `## Saved source\n${sourceLines.join("\n")}\n${notes.join("\n")}`;
      });
    }
    const draft = createSessionRenewalDraft(text, {
      origin: savedDraft.origin,
      revision: Math.max(savedDraft.revision, state.draft?.revision || 0) + 1
    });
    validateReviewedHandover({ ...state, basis }, draft);
    return mutateSessionRenewalState(runtime, state.sessionId, (latest) => statePatch(latest, {
      approved: null,
      basis,
      confirmedBy: null,
      draft,
      error: {
        code: "vibe64_session_renewal_review_stale",
        message: "This session changed. Your saved handover has been kept with current source details. Review it before continuing; no new AI handover was requested.",
        retryable: true
      },
      stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
      status: SESSION_RENEWAL_STATUS.REVIEW,
      successor: null
    }));
  }

  function validateReviewedHandover(state = {}, draft = {}) {
    if (state.manualRequired) {
      const template = manualDraftTemplate(terminals, state.basis);
      const placeholderLines = template
        .split("\n")
        .filter((line) => (
          line &&
          !line.startsWith("#") &&
          !line.startsWith("- ")
        ));
      const draftLines = new Set(String(draft.text || "").split("\n"));
      const remainingPlaceholders = placeholderLines.filter((line) => draftLines.has(line));
      if (remainingPlaceholders.length > 0) {
        throw renewalError(
          "Complete every handover section before creating the fresh session.",
          "vibe64_session_renewal_manual_handover_incomplete",
          {
            details: { remainingSectionCount: remainingPlaceholders.length },
            retryable: false,
            statusCode: 400
          }
        );
      }
    }
    return terminals.validateSessionRenewalHandover(draft.text, {
      source: state.basis?.source || null
    });
  }

  return Object.freeze({ freezePredecessorTerminalAdmission, thawPredecessorTerminalAdmission, closePredecessorTerminals, releasePredecessorProcessExitProof, assertPredecessorIdle, returnToRenewalReview, validateReviewedHandover });
}

export { createRenewalPredecessorSession };

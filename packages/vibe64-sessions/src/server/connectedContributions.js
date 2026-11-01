import crypto from "node:crypto";
import {
  assertSessionRepositoryReview,
  serializeSessionConnectedSources,
  serializeSessionConnectedSubmissions,
  sessionConnectedSources,
  sessionConnectedSubmissions
} from "@local/vibe64-core/server/projectRepository";
import { assertProjectEffectAdmission, currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import {
  ACTION_ALLOCATE_CONNECTED_SOURCE,
  ACTION_CHECK_CONTRIBUTION_UPDATES,
  ACTION_INSPECT_CONTRIBUTION_INCOMING,
  ACTION_INSPECT_CONTRIBUTION_INPUTS,
  ACTION_INSPECT_CONTRIBUTION_SOURCE,
  ACTION_INSPECT_CONTRIBUTION_WORK,
  ACTION_SAVE_CONTRIBUTION_WORK,
  ACTION_UPDATE_CONTRIBUTION_WORK
} from "./connectedContributionActions.js";
import { sessionResult } from "./sessionResults.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

/**
 * A preparation that reports no progress.
 */
async function reportNoProgress() {}

/**
 * The reported result of bringing one connected checkout up to date.
 */
function connectedUpdateOutcome(update, branch) {
  if (update?.status === "updated" || update?.status === "current") {
    return { status: update.status, commit: normalizeText(update.commit) };
  }
  if (update?.status === "skipped") return { status: "skipped", reason: normalizeText(update.reason) };
  return { status: "skipped", reason: normalizeText(update?.error) || `It could not be updated to ${branch}.` };
}

/**
 * Connected-source orchestration: a working session's contributions to the
 * projects it is connected to, through each receiving project's own actions
 * (receivingContributions.js answers them there).
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {TerminalsService} dependencies.terminals
 */
function createConnectedContributions({
  actions,
  logger,
  project,
  terminals
}) {
  function executeConnectedAction(projectSlug, actionId, input, requestContext = {}) {
    const origin = currentProjectRequestContext();
    if (!origin?.slug || origin.learningScope || origin.slug === projectSlug || !requestContext.requestMeta?.request) {
      throw Object.assign(new Error("Use the originating working project's authenticated session for connected work."), {
        code: "vibe64_connected_source_authority_required"
      });
    }
    return actions.execute({
      actionId,
      input: { ...input, projectSlug },
      context: {
        surface: "app",
        channel: "internal",
        requestMeta: {
          ...requestContext.requestMeta,
          request: {
            ...requestContext.requestMeta.request,
            headers: requestContext.requestMeta.request.headers,
            params: { slug: projectSlug }
          }
        }
      }
    });
  }

  async function inspectConnectedWork(session, requestContext, bindings = sessionConnectedSources(session), captureSnapshots = false) {
    const submissions = sessionConnectedSubmissions(session);
    const connected = [];
    for (const binding of bindings) {
      const submittedCommit = submissions.find(item => item.contribution.id === binding.contribution.id)?.submittedCommit || "";
      const work = await executeConnectedAction(binding.projectSlug, ACTION_INSPECT_CONTRIBUTION_WORK, {
        contribution: binding.contribution,
        ...(submittedCommit ? { submittedCommit } : {})
      }, requestContext);
      if (work?.ok !== true) throw Object.assign(new Error(work?.error || "The connected source could not be inspected."), {
        code: work?.code || "vibe64_connected_source_unavailable",
        details: {
          repository: binding.contribution.repository,
          projectSlug: binding.projectSlug,
          sessionId: binding.contribution.id,
          ...work?.details
        }
      });
      const publishedCommit = work.publishedCommit === binding.contribution.baseCommit ? "" : normalizeText(work.publishedCommit);
      connected.push({
        ...binding,
        sessionId: work.sessionId,
        destination: work.destination,
        ...(captureSnapshots ? {
          snapshot: {
            contribution: binding.contribution,
            sessionId: work.sessionId,
            worktreePath: work.worktreePath,
            baseCommit: work.baseCommit,
            canonicalCommit: work.canonicalCommit,
            sessionHead: work.sessionHead,
            worktreeTree: work.worktreeTree
          }
        } : {}),
        unsaved: work.unsaved === true || work.ahead > 0,
        publishedCommit,
        submittedCommit,
        needsSave: work.unsaved === true || work.ahead > 0 || Boolean(publishedCommit && publishedCommit !== submittedCommit),
        reconciled: work.operation?.status !== "running" && work.operation?.reconciled !== false
      });
    }
    return connected;
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sessionId
   * @param {object} requestContext
   */
  async function assertConnectedWorkSaved(runtime, sessionId, requestContext) {
    const current = await runtime.getSessionWithoutSource(sessionId);
    // Read each integration branch live before taking snapshots, so Save
    // publishes only work tested against every connected branch's latest commit.
    const checks = [];
    for (const binding of sessionConnectedSources(current)) {
      const check = await executeConnectedAction(binding.projectSlug, ACTION_CHECK_CONTRIBUTION_UPDATES,
        { contribution: binding.contribution }, requestContext);
      if (check?.ok !== true) throw Object.assign(new Error(check?.error || "The connected source could not be checked for updates."), {
        code: check?.code || "vibe64_connected_source_unavailable",
        details: { repository: binding.contribution.repository, projectSlug: binding.projectSlug, ...check?.details }
      });
      checks.push({ binding, check });
    }
    const connected = await inspectConnectedWork(current, requestContext, sessionConnectedSources(current), true);
    const pending = connected.find(item => item.needsSave || !item.reconciled);
    if (pending) throw Object.assign(new Error(
      pending.needsSave
        ? `Save connected work in ${pending.contribution.repository} before saving the main project.`
        : `Reconcile the pushed work in ${pending.contribution.repository} before saving the main project.`
    ), {
      code: "vibe64_connected_save_required",
      details: {
        repository: pending.contribution.repository,
        projectSlug: pending.projectSlug,
        sessionId: pending.sessionId
      }
    });
    const behind = checks.find(({ check }) => check.behind > 0);
    if (behind) {
      const { binding, check } = behind;
      throw Object.assign(new Error(`${binding.contribution.repository} is behind ${binding.contribution.integrationBranch} ` +
        `by ${check.behind} commit${check.behind === 1 ? "" : "s"}. Choose Update connected repositories, check your work, then Save.`), {
        code: "vibe64_connected_source_behind",
        details: { repository: binding.contribution.repository, projectSlug: binding.projectSlug, sessionId: check.sessionId }
      });
    }
    return connected.map(item => item.snapshot);
  }

  async function saveConnectedWork(sessionId, input, requestContext) {
    const saved = [];
    let failedRepository = "";
    const result = await sessionResult(() => terminals.runConnectedSessionSave(sessionId, input, async ({ runtime, session }) => {
      assertProjectEffectAdmission();
      assertSessionRepositoryReview(await project.readCurrentProject(), session, input.destinationReview);
      const connected = await inspectConnectedWork(session, requestContext);
      if (!Array.isArray(input.connectedReview) || input.connectedReview.length !== connected.length ||
          connected.some((item, index) => {
            const review = input.connectedReview[index];
            return review?.projectSlug !== item.projectSlug ||
              Object.entries(item.destination).some(([key, value]) => review.destination?.[key] !== value);
          })) {
        throw Object.assign(new Error("The connected Save destinations changed. Inspect work and review them again."), {
          code: "vibe64_connected_save_review_changed"
        });
      }
      const submissions = sessionConnectedSubmissions(session);
      for (const reviewed of connected) {
        failedRepository = reviewed.contribution.repository;
        // Earlier repositories can take time to publish. Recheck this source
        // at its turn rather than skipping work from the initial review snapshot.
        const [item] = await inspectConnectedWork(
          await runtime.getSessionWithoutSource(sessionId), requestContext, [reviewed]
        );
        if (Object.entries(reviewed.destination).some(([key, value]) => item.destination?.[key] !== value)) {
          throw Object.assign(new Error("The connected Save destination changed. Inspect work and review it again."), {
            code: "vibe64_connected_save_review_changed"
          });
        }
        if (!item.needsSave) continue;
        const publication = item.unsaved
          ? await executeConnectedAction(item.projectSlug, ACTION_SAVE_CONTRIBUTION_WORK, {
            contribution: item.contribution,
            destinationReview: item.destination
          }, requestContext)
          : { ok: true, status: "already_published", saveCommit: item.publishedCommit, reconciled: item.reconciled };
        if (publication?.ok !== true) throw Object.assign(new Error(publication?.error || "Connected Save was not confirmed."), {
          code: publication?.code || "vibe64_connected_save_failed",
          details: publication?.details
        });
        const entry = { contribution: item.contribution, submittedCommit: publication.saveCommit };
        const previous = submissions.findIndex(value => value.contribution.id === item.contribution.id);
        if (previous < 0) submissions.push(entry);
        else submissions[previous] = entry;
        const serialized = serializeSessionConnectedSubmissions(submissions);
        const completed = {
          projectSlug: item.projectSlug,
          repository: item.contribution.repository,
          sessionId: item.sessionId,
          saveCommit: publication.saveCommit,
          status: publication.status,
          reconciled: publication.reconciled,
          recorded: false
        };
        saved.push(completed);
        // Persist every confirmed publication before attempting the next repository.
        // If this write fails, the receiving session's normal Save recovery remains
        // authoritative and a retry records that same commit without republishing.
        await runtime.store.writeMetadataValue(sessionId, "connected_submissions", serialized);
        completed.recorded = true;
      }
      return { ok: true, status: "connected_saved", connected: saved };
    }), "Connected work could not be saved.");
    return result?.ok === false
      ? { ...result, details: { ...result.details, connected: saved, failedRepository } }
      : result;
  }

  /**
   * @param {{ runtime: Vibe64SessionRuntime, session: { sessionId: string } }} target
   * @param {object} input
   * @param {object} requestContext
   * @param {{ onProgress?: (label: string) => Promise<void> }} [options]
   */
  async function prepareConnectedSourcesInsideAgentWrite({ runtime, session }, input, requestContext, options = {}) {
    const { onProgress = reportNoProgress } = options;
    const sessionId = session.sessionId;
    const prepared = [];
    const resolvedSources = [];
    let preparingRepository = "";
    let progress = Promise.resolve();
    const report = label => {
      progress = progress.then(() => onProgress(label)).catch((error) => {
        logger.warn({ error, sessionId, label }, "A connected-source progress report failed; preparation continues.");
      });
    };
    const result = await sessionResult(async () => {
      assertProjectEffectAdmission();
      const origin = currentProjectRequestContext();
      if (!origin?.slug || origin.learningScope || !requestContext.requestMeta?.request) {
        throw Object.assign(new Error("Prepare connected sources from the originating working project's authenticated session."), {
          code: "vibe64_connected_source_authority_required"
        });
      }
      const targets = await project.connectedProjectTargets({ sessionId, vibe64User: trustedAssistantUser(input) });
      const sources = sessionConnectedSources(session);
      const self = targets.find(target => target.projectSlug === origin.slug);
      if (self) {
        preparingRepository = self.repository;
        throw Object.assign(new Error(
          "A project cannot prepare itself as a connected contribution."), { code: "vibe64_connected_source_self_reference" });
      }
      const names = targets.map(target => target.repository.split("/").pop());
      if (targets.length) report(`Preparing connected projects: ${names.join(", ")}`);
      const remaining = new Set(names);
      let reservation = Promise.resolve();
      // Connected projects are independent, so each one is prepared at the same
      // time. Reservations are written one at a time, each with every binding
      // reserved so far; results are still reported in target order.
      const allocated = await Promise.allSettled(targets.map(async (target, index) => {
        const repository = target.fullName;
        const source = await executeConnectedAction(target.projectSlug, ACTION_INSPECT_CONTRIBUTION_SOURCE, {}, requestContext);
        if (source.repository !== repository) throw Object.assign(new Error(
          "The receiving project changed repositories. Review the connection before preparing it."), {
          code: "vibe64_contribution_authority_changed"
        });
        let binding = sources.find(item => item.contribution.repository === repository);
        if (binding &&
            (binding.projectSlug !== target.projectSlug || binding.contribution.integrationBranch !== source.integrationBranch)) {
          throw Object.assign(new Error(
            "This connection already owns a different source binding. Preserve its work and reconcile that binding before changing its project or target."
          ), {
            code: "vibe64_contribution_authority_changed"
          });
        }
        if (!binding) {
          binding = {
            projectSlug: target.projectSlug,
            contribution: {
              schemaVersion: 1,
              id: crypto.randomUUID(),
              ...source
            }
          };
          sources.push(binding);
          // Reserve the exact identity before creation, so a lost response or
          // partial preparation retries the same source instead of cloning again.
          const write = reservation.then(() => {
            const serialized = serializeSessionConnectedSources(sources);
            return runtime.store.writeMetadataValue(sessionId, "connected_sources", serialized);
          });
          // Queue tail: the write's own failure reaches this caller through `await write`.
          reservation = write.catch(() => {});
          await write;
        }
        const allocate = () => executeConnectedAction(binding.projectSlug, ACTION_ALLOCATE_CONNECTED_SOURCE, {
          contribution: binding.contribution,
          sessionName: (normalizeText(session.sessionName) || sessionId).slice(0, 120)
        }, requestContext);
        let allocation = await allocate();
        let update = null;
        if (allocation?.ok !== false && allocation?.sourceReady === true) {
          // Bring the checkout up to its integration branch when that cannot
          // affect anyone's work. A refusal never stops preparation; the
          // checkout is used as it is and the outcome is reported.
          report(`Updating connected project ${names[index]} to ${binding.contribution.integrationBranch}`);
          try {
            update = await executeConnectedAction(binding.projectSlug, ACTION_UPDATE_CONTRIBUTION_WORK,
              { contribution: binding.contribution }, requestContext);
          } catch (error) {
            update = { ok: false, error: normalizeText(error?.message) };
          }
          if (update?.status === "updated") allocation = await allocate();
        }
        remaining.delete(names[index]);
        if (remaining.size) {
          report(
            `Preparing connected projects: ${[...remaining].join(", ")} (${targets.length - remaining.size} of ${targets.length} ready)`
          );
        }
        return { repository, binding, allocation, update };
      }));
      for (const [index, target] of targets.entries()) {
        preparingRepository = target.repository;
        if (allocated[index].status === "rejected") throw allocated[index].reason;
        const { repository, binding, allocation, update } = allocated[index].value;
        if (allocation?.ok === false) return { ...allocation, prepared };
        prepared.push({
          repository,
          projectSlug: binding.projectSlug,
          sessionId: allocation.sessionId,
          sourceReady: allocation.sourceReady === true,
          workspaceSetup: allocation.workspaceSetup,
          update: connectedUpdateOutcome(update, binding.contribution.integrationBranch)
        });
        if (allocation.sourceReady !== true) return {
          ok: false,
          code: "vibe64_connected_source_unavailable",
          error: `The contribution source for ${repository} is not ready. Open its session in ${binding.projectSlug} and recover the source before retrying.`
        };
        resolvedSources.push({ repository: target.repository, projectSlug: binding.projectSlug, session: allocation });
      }
      if (targets.length) report("Linking connected sources");
      preparingRepository = "";
      const development = await project.prepareConnectedDevelopmentInputs({
        session: await runtime.getSessionWithoutSource(sessionId),
        projects: resolvedSources,
        environment: await runtime.resolvePromptEnvironment()
      });
      return { ok: true, prepared, development };
    });
    await progress;
    return result?.ok === false ? {
      ...result,
      prepared,
      ...(preparingRepository ? { failedRepository: preparingRepository } : {})
    } : result;
  }

  async function inspectConnectedReplacement(session, input, requestContext) {
    const binding = sessionConnectedSources(session).find(item => item.contribution.repository === input.repository);
    if (!binding) throw Object.assign(new Error("This session no longer uses that connected source. Refresh its work before retrying."), {
      code: "vibe64_connected_replacement_changed"
    });
    const targets = await project.connectedProjectTargets({ sessionId: session.sessionId, vibe64User: trustedAssistantUser(input) });
    if (!targets.some(target => target.projectSlug === binding.projectSlug &&
        target.fullName === binding.contribution.repository)) {
      throw Object.assign(new Error("Restore this repository's connection before replacing its contribution."), {
        code: "vibe64_connected_replacement_changed"
      });
    }
    const incoming = await executeConnectedAction(binding.projectSlug, ACTION_INSPECT_CONTRIBUTION_INCOMING, {
      contribution: binding.contribution
    }, requestContext);
    if (incoming?.ok !== true) throw Object.assign(new Error(incoming?.error || "The discarded contribution could not be inspected."), {
      code: incoming?.code || "vibe64_connected_replacement_unavailable"
    });
    const entry = incoming.contributions.find(item => item.id === binding.contribution.id);
    if (entry?.status !== "discarded" || entry.activeHead || !entry.discardedHead) {
      throw Object.assign(new Error("Only a discarded, unmerged contribution can be replaced. Refresh its Incoming changes."), {
        code: "vibe64_connected_replacement_changed"
      });
    }
    return { binding, incoming, entry };
  }

  async function prepareConnectedSources(sessionId, input, requestContext) {
    return sessionResult(() => terminals.runConnectedSourcePreparation(sessionId, input,
      context => prepareConnectedSourcesInsideAgentWrite(context, input, requestContext)));
  }

  async function reviewConnectedReplacement(sessionId, input, requestContext) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
      const { incoming } = await inspectConnectedReplacement(session, input, requestContext);
      return incoming;
    });
  }

  async function replaceConnectedSource(sessionId, input, requestContext) {
    return sessionResult(() => terminals.runConnectedSourcePreparation(sessionId, input, async ({ runtime, session }) => {
      assertProjectEffectAdmission();
      const sources = sessionConnectedSources(session);
      const previous = sources.find(item => item.contribution.repository === input.repository);
      // A lost allocation response retries the already reserved replacement.
      // Neither the discarded source nor prior submission requirements change.
      if (!previous || previous.contribution.replaces !== input.review.id ||
          previous.contribution.baseCommit !== input.review.discardedHead ||
          previous.contribution.integrationBranch !== input.review.targetBranch ||
          previous.contribution.repository !== input.review.repository) {
        const { binding, entry } = await inspectConnectedReplacement(session, input, requestContext);
        if (Object.entries(entry.review).some(([key, value]) => input.review[key] !== value)) {
          throw Object.assign(new Error("The discarded contribution changed. Review its replacement again."), {
            code: "vibe64_connected_replacement_changed"
          });
        }
        const replacement = {
          ...binding,
          contribution: {
            ...binding.contribution,
            id: crypto.randomUUID(),
            replaces: binding.contribution.id,
            baseCommit: entry.discardedHead
          }
        };
        sources[sources.indexOf(previous)] = replacement;
        const serialized = serializeSessionConnectedSources(sources);
        await runtime.store.writeMetadataValue(sessionId, "connected_sources", serialized);
      }
      const current = await runtime.getSessionWithoutSource(sessionId);
      const result = await prepareConnectedSourcesInsideAgentWrite({ runtime, session: current }, input, requestContext);
      return { ...result, sessionId: result.prepared?.find(item => item.repository === input.repository)?.sessionId };
    }));
  }

  async function inspectConnectedDevelopmentInputs(sessionId, input, requestContext) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
      const targets = await project.connectedProjectTargets({ sessionId, vibe64User: trustedAssistantUser(input) });
      const bindings = sessionConnectedSources(session);
      const projects = [];
      for (const target of targets) {
        const binding = bindings.find(item => item.contribution.repository === target.fullName);
        if (!binding || binding.projectSlug !== target.projectSlug) throw Object.assign(new Error(
          "The connected project list no longer matches this task. Prepare connected sources again."), {
          code: "vibe64_connected_inputs_required"
        });
        const receiving = await executeConnectedAction(binding.projectSlug, ACTION_INSPECT_CONTRIBUTION_INPUTS, {
          contribution: binding.contribution
        }, requestContext);
        if (receiving?.ok === false) return receiving;
        projects.push({ repository: target.repository, projectSlug: binding.projectSlug, session: receiving });
      }
      return project.inspectConnectedDevelopmentInputs({ session, projects, environment: await runtime.resolvePromptEnvironment() });
    });
  }

  return Object.freeze({
    assertConnectedWorkSaved,
    inspectConnectedDevelopmentInputs,
    inspectConnectedWork,
    prepareConnectedSources,
    prepareConnectedSourcesInsideAgentWrite,
    replaceConnectedSource,
    reviewConnectedReplacement,
    saveConnectedWork
  });
}

export { createConnectedContributions };

import crypto from "node:crypto";
import {
  assertSessionRepositoryReview,
  CONNECTED_LINK_REQUIRED,
  contributionSessionId,
  serializeSessionConnectedSources,
  serializeSessionConnectedSubmissions,
  sessionConnectedSources,
  sessionConnectedSubmissions
} from "@local/vibe64-core/server/projectRepository";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { assertProjectEffectAdmission, currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import {
  ACTION_CHECK_CONTRIBUTION_UPDATES,
  ACTION_CREATE_CONNECTED_REPLACEMENT,
  ACTION_INSPECT_CONTRIBUTION_INCOMING,
  ACTION_INSPECT_CONTRIBUTION_INPUTS,
  ACTION_INSPECT_CONTRIBUTION_SOURCE,
  ACTION_INSPECT_CONTRIBUTION_WORK,
  ACTION_RESOLVE_CONNECTED_SOURCE,
  ACTION_SAVE_CONTRIBUTION_WORK,
  ACTION_UPDATE_CONTRIBUTION_WORK
} from "./connectedContributionActions.js";
import { createConnectedSessionChoices } from "./connectedSessionChoices.js";
import { sessionResult } from "./sessionResults.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */
/** @typedef {import("./types.js").SessionWorkspaceSetup} SessionWorkspaceSetup */

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

/** The name a receiving session takes when it has none of its own. */
function servedSessionName(session) {
  return (normalizeText(session.sessionName) || session.sessionId).slice(0, 120);
}

/**
 * The result that stops preparation until a person chooses a session for each
 * named connected project, with what stopped each one when there is a reason.
 * A renewal's new session is hidden, so its choice happens back in this session.
 * @param {{ name: string, why: string }[]} entries
 * @param {boolean} renewal
 */
function connectedChoiceResult(entries, renewal) {
  const names = entries.map(entry => entry.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  const reasons = entries.filter(entry => entry.why).map(entry => names.length > 1 ? `${entry.name}: ${entry.why}` : entry.why);
  return {
    ok: false,
    code: CONNECTED_LINK_REQUIRED,
    error: [
      `${list} ${names.length > 1 ? "need connected sessions" : "needs a connected session"}.`,
      ...reasons,
      renewal
        ? "Cancel this renewal, choose in this session's workspace preparation notice, then renew it again."
        : "Choose in the workspace preparation notice to continue."
    ].join(" ")
  };
}

/**
 * Connected-source orchestration: a working session's contributions to the
 * projects it is connected to, through each receiving project's own actions
 * (receivingContributions.js answers them there).
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {WorkspaceSetupRunner} dependencies.setupRunner
 * @param {TerminalsService} dependencies.terminals
 * @param {SessionWorkspaceSetup} dependencies.workspaceSetup
 */
function createConnectedContributions({
  actions,
  logger,
  project,
  setupRunner,
  terminals,
  workspaceSetup
}) {
  function executeConnectedAction(projectSlug, actionId, input, requestContext = {}) {
    const origin = currentProjectRequestContext();
    if (!origin?.slug || origin.learningScope || origin.slug === projectSlug || !requestContext.requestMeta?.request) {
      throw vibe64Error(
        "Use the originating working project's authenticated session for connected work.",
        "vibe64_connected_source_authority_required",
        { messageCode: "vibe64_connected_work_authority_required" }
      );
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

  const {
    connectedLinkProblem,
    inspectConnectedChoices,
    linkConnectedSession,
    linkOnlyFreeSession
  } = createConnectedSessionChoices({ executeConnectedAction, project, setupRunner, terminals, workspaceSetup });

  async function inspectConnectedWork(session, requestContext, bindings = sessionConnectedSources(session), captureSnapshots = false) {
    const submissions = sessionConnectedSubmissions(session);
    const connected = [];
    for (const binding of bindings) {
      const submittedCommit = submissions.find(item => item.contribution.id === binding.contribution.id)?.submittedCommit || "";
      const work = await executeConnectedAction(binding.projectSlug, ACTION_INSPECT_CONTRIBUTION_WORK, {
        contribution: binding.contribution,
        ...(submittedCommit ? { submittedCommit } : {})
      }, requestContext);
      if (work?.ok !== true) {
        throw Object.assign(new Error(work?.error || "The connected source could not be inspected."), {
          code: work?.code || "vibe64_connected_source_unavailable",
          details: {
            repository: binding.contribution.repository,
            projectSlug: binding.projectSlug,
            sessionId: contributionSessionId(binding.contribution),
            ...work?.details
          }
        });
      }
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
      const check = await executeConnectedAction(
        binding.projectSlug,
        ACTION_CHECK_CONTRIBUTION_UPDATES,
        { contribution: binding.contribution },
        requestContext
      );
      if (check?.ok !== true) {
        throw Object.assign(new Error(check?.error || "The connected source could not be checked for updates."), {
          code: check?.code || "vibe64_connected_source_unavailable",
          details: { repository: binding.contribution.repository, projectSlug: binding.projectSlug, ...check?.details }
        });
      }
      checks.push({ binding, check });
    }
    const connected = await inspectConnectedWork(current, requestContext, sessionConnectedSources(current), true);
    const pending = connected.find(item => item.needsSave || !item.reconciled);
    if (pending) {
      const { repository } = pending.contribution;
      const details = { repository, projectSlug: pending.projectSlug, sessionId: pending.sessionId };
      if (pending.needsSave) {
        throw vibe64Error(`Save connected work in ${repository} before saving the main project.`, "vibe64_connected_save_required", {
          details,
          messageCode: "vibe64_connected_work_unsaved",
          messageParams: { repository }
        });
      }
      throw vibe64Error(`Reconcile the pushed work in ${repository} before saving the main project.`, "vibe64_connected_save_required", {
        details,
        messageCode: "vibe64_connected_work_unreconciled",
        messageParams: { repository }
      });
    }
    const behind = checks.find(({ check }) => check.behind > 0);
    if (behind) {
      const { binding, check } = behind;
      const { repository, integrationBranch } = binding.contribution;
      throw vibe64Error(`${repository} is behind ${integrationBranch} by ${check.behind} commit${check.behind === 1 ? "" : "s"}. ` +
        "Choose Update connected repositories, check your work, then Save.", "vibe64_connected_source_behind", {
        params: { repository, integrationBranch, behind: check.behind },
        details: { repository, projectSlug: binding.projectSlug, sessionId: check.sessionId }
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
        throw vibe64Error(
          "The connected Save destinations changed. Inspect work and review them again.",
          "vibe64_connected_save_review_changed",
          { messageCode: "vibe64_connected_save_review_mismatch" }
        );
      }
      const submissions = sessionConnectedSubmissions(session);
      for (const reviewed of connected) {
        failedRepository = reviewed.contribution.repository;
        // Earlier repositories can take time to publish. Recheck this source
        // at its turn rather than skipping work from the initial review snapshot.
        const [item] = await inspectConnectedWork(await runtime.getSessionWithoutSource(sessionId), requestContext, [reviewed]);
        if (Object.entries(reviewed.destination).some(([key, value]) => item.destination?.[key] !== value)) {
          throw vibe64Error(
            "The connected Save destination changed. Inspect work and review it again.",
            "vibe64_connected_save_review_changed",
            { messageCode: "vibe64_connected_save_destination_changed" }
          );
        }
        if (!item.needsSave) continue;
        const publication = item.unsaved
          ? await executeConnectedAction(item.projectSlug, ACTION_SAVE_CONTRIBUTION_WORK, {
            contribution: item.contribution,
            destinationReview: item.destination
          }, requestContext)
          : { ok: true, status: "already_published", saveCommit: item.publishedCommit, reconciled: item.reconciled };
        if (publication?.ok !== true) {
          throw Object.assign(new Error(publication?.error || "Connected Save was not confirmed."), {
            code: publication?.code || "vibe64_connected_save_failed",
            details: publication?.details
          });
        }
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
   * @param {{ automaticLink?: boolean, onProgress?: (label: string) => Promise<void>, renewal?: boolean }} [options]
   *   `automaticLink` lets it take a project's only free session when that is untouched.
   */
  async function prepareConnectedSourcesInsideAgentWrite({ runtime, session }, input, requestContext, options = {}) {
    const { automaticLink = false, onProgress = reportNoProgress, renewal = false } = options;
    const sessionId = session.sessionId;
    const prepared = [];
    const resolvedSources = [];
    const linked = [];
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
        throw vibe64Error(
          "Prepare connected sources from the originating working project's authenticated session.",
          "vibe64_connected_source_authority_required",
          { messageCode: "vibe64_connected_preparation_authority_required" }
        );
      }
      const targets = await project.connectedProjectTargets({ sessionId, vibe64User: trustedAssistantUser(input) });
      const sources = sessionConnectedSources(session);
      const self = targets.find(target => target.projectSlug === origin.slug);
      if (self) {
        preparingRepository = self.repository;
        throw vibe64Error("A project cannot prepare itself as a connected contribution.", "vibe64_connected_source_self_reference");
      }
      const names = targets.map(target => target.repository.split("/").pop());
      if (targets.length) report(`Preparing connected projects: ${names.join(", ")}`);
      const remaining = new Set(names);
      const stopped = [];
      let readyCount = 0;
      const finish = (index, problem) => {
        remaining.delete(names[index]);
        if (problem) stopped.push(`${names[index]} ${problem}`);
        else readyCount += 1;
        if (remaining.size) {
          report(`Preparing connected projects: ${[...remaining].join(", ")} ` +
            `(${readyCount} of ${targets.length} ready${stopped.length ? `; ${stopped.join(", ")}` : ""})`);
        }
      };
      // Each link rewrites this session's bindings, so they happen one at a time.
      let linkTurn = Promise.resolve();
      const linkInTurn = target => {
        const link = linkTurn.then(() => linkOnlyFreeSession(runtime, sessionId, target, requestContext));
        // Queue tail: the link's own failure reaches this caller through `await link`.
        linkTurn = link.catch(doNothing);
        return link;
      };
      /**
       * One connected project, up to date when that cannot affect anyone's
       * work. With no usable link it may take the project's only free session
       * while that is untouched; otherwise it stops here for a person's choice.
       * Preparation never creates a session.
       */
      const prepareTarget = async (target, index) => {
        const repository = target.fullName;
        const source = await executeConnectedAction(target.projectSlug, ACTION_INSPECT_CONTRIBUTION_SOURCE, {}, requestContext);
        if (source.repository !== repository) {
          throw vibe64Error(
            "The receiving project changed repositories. Review the connection before preparing it.",
            "vibe64_contribution_authority_changed",
            { messageCode: "vibe64_connected_receiving_repository_changed" }
          );
        }
        let binding = sources.find(item => item.contribution.repository === repository);
        if (binding &&
            (binding.projectSlug !== target.projectSlug || binding.contribution.integrationBranch !== source.integrationBranch)) {
          throw vibe64Error(
            "This connection already owns a different source binding. " +
              "Preserve its work and reconcile that binding before changing its project or target.",
            "vibe64_contribution_authority_changed",
            { messageCode: "vibe64_connected_binding_conflict" }
          );
        }
        const resolve = () => executeConnectedAction(binding.projectSlug, ACTION_RESOLVE_CONNECTED_SOURCE, {
          contribution: binding.contribution,
          sessionName: servedSessionName(session)
        }, requestContext);
        let allocation = binding ? await resolve() : { ok: false, code: CONNECTED_LINK_REQUIRED };
        if (allocation?.code === CONNECTED_LINK_REQUIRED) {
          const link = automaticLink ? await linkInTurn(target) : {};
          if (!link.binding) {
            return { repository, allocation, why: [allocation.details?.reason, link.why].filter(Boolean).join(" ") };
          }
          binding = link.binding;
          linked.push({
            reason: link.reason,
            repository,
            projectSlug: binding.projectSlug,
            sessionId: binding.contribution.sessionId,
            sessionName: link.sessionName
          });
          allocation = await resolve();
        }
        let update = null;
        if (allocation?.ok !== false && allocation?.sourceReady === true) {
          // Bring the checkout up to its integration branch when that cannot
          // affect anyone's work. A refusal never stops preparation; the
          // checkout is used as it is and the outcome is reported.
          report(`Updating connected project ${names[index]} to ${binding.contribution.integrationBranch}`);
          try {
            update = await executeConnectedAction(
              binding.projectSlug,
              ACTION_UPDATE_CONTRIBUTION_WORK,
              { contribution: binding.contribution },
              requestContext
            );
          } catch (error) {
            update = { ok: false, error: normalizeText(error?.message) };
          }
          if (update?.status === "updated") allocation = await resolve();
        }
        return { repository, binding, allocation, update };
      };
      // Connected projects are independent, so each one is prepared at the same
      // time; results are still reported in target order.
      const allocated = await Promise.allSettled(targets.map(async (target, index) => {
        try {
          const preparedTarget = await prepareTarget(target, index);
          const { allocation } = preparedTarget;
          finish(index, allocation?.code === CONNECTED_LINK_REQUIRED ? "needs a session"
            : allocation?.ok === false || allocation?.sourceReady !== true ? "failed" : "");
          return preparedTarget;
        } catch (error) {
          finish(index, "failed");
          throw error;
        }
      }));
      const needsChoice = [];
      for (const [index, target] of targets.entries()) {
        preparingRepository = target.repository;
        if (allocated[index].status === "rejected") throw allocated[index].reason;
        const { repository, binding, allocation, update, why } = allocated[index].value;
        if (allocation?.code === CONNECTED_LINK_REQUIRED) {
          needsChoice.push({ name: names[index], why });
          continue;
        }
        if (allocation?.ok === false) return { ...allocation, prepared };
        prepared.push({
          repository,
          projectSlug: binding.projectSlug,
          sessionId: allocation.sessionId,
          sourceReady: allocation.sourceReady === true,
          workspaceSetup: allocation.workspaceSetup,
          update: connectedUpdateOutcome(update, binding.contribution.integrationBranch)
        });
        if (allocation.sourceReady !== true) {
          return {
            ok: false,
            code: "vibe64_connected_source_unavailable",
            error: `The contribution source for ${repository} is not ready. Open its session in ${binding.projectSlug} and recover the source before retrying.`
          };
        }
        resolvedSources.push({ repository: target.repository, projectSlug: binding.projectSlug, session: allocation });
      }
      preparingRepository = "";
      if (needsChoice.length) return connectedChoiceResult(needsChoice, renewal);
      if (targets.length) report("Linking connected sources");
      const development = await project.prepareConnectedDevelopmentInputs({
        session: await runtime.getSessionWithoutSource(sessionId),
        projects: resolvedSources,
        environment: await runtime.resolvePromptEnvironment()
      });
      return { ok: true, prepared, development, linked };
    });
    await progress;
    return result?.ok === false ? {
      ...result,
      prepared,
      linked,
      ...(preparingRepository ? { failedRepository: preparingRepository } : {})
    } : result;
  }

  async function inspectConnectedReplacement(session, input, requestContext) {
    const binding = sessionConnectedSources(session).find(item => item.contribution.repository === input.repository);
    if (!binding) {
      throw vibe64Error(
        "This session no longer uses that connected source. Refresh its work before retrying.",
        "vibe64_connected_replacement_changed",
        { messageCode: "vibe64_connected_replacement_source_removed" }
      );
    }
    const targets = await project.connectedProjectTargets({ sessionId: session.sessionId, vibe64User: trustedAssistantUser(input) });
    if (!targets.some(target => target.projectSlug === binding.projectSlug &&
        target.fullName === binding.contribution.repository)) {
      throw vibe64Error(
        "Restore this repository's connection before replacing its contribution.",
        "vibe64_connected_replacement_changed",
        { messageCode: "vibe64_connected_replacement_connection_required" }
      );
    }
    const incoming = await executeConnectedAction(binding.projectSlug, ACTION_INSPECT_CONTRIBUTION_INCOMING, {
      contribution: binding.contribution
    }, requestContext);
    if (incoming?.ok !== true) {
      throw Object.assign(new Error(incoming?.error || "The discarded contribution could not be inspected."), {
        code: incoming?.code || "vibe64_connected_replacement_unavailable"
      });
    }
    const entry = incoming.contributions.find(item => item.id === binding.contribution.id);
    if (entry?.status !== "discarded" || entry.activeHead || !entry.discardedHead) {
      throw vibe64Error(
        "Only a discarded, unmerged contribution can be replaced. Refresh its Incoming changes.",
        "vibe64_connected_replacement_changed",
        { messageCode: "vibe64_connected_replacement_not_discarded" }
      );
    }
    return { binding, incoming, entry };
  }

  async function prepareConnectedSources(sessionId, input, requestContext) {
    return sessionResult(() => terminals.runConnectedSourcePreparation(
      sessionId,
      input,
      context => prepareConnectedSourcesInsideAgentWrite(context, input, requestContext, {
        automaticLink: requestContext.channel === "api"
      })
    ));
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
      let reserved = previous;
      // A lost creation response retries the already reserved replacement.
      // Neither the discarded source nor prior submission requirements change.
      if (!previous || previous.contribution.replaces !== input.review.id ||
          previous.contribution.baseCommit !== input.review.discardedHead ||
          previous.contribution.integrationBranch !== input.review.targetBranch ||
          previous.contribution.repository !== input.review.repository) {
        const { binding, entry } = await inspectConnectedReplacement(session, input, requestContext);
        if (Object.entries(entry.review).some(([key, value]) => input.review[key] !== value)) {
          throw vibe64Error(
            "The discarded contribution changed. Review its replacement again.",
            "vibe64_connected_replacement_changed",
            { messageCode: "vibe64_connected_replacement_review_changed" }
          );
        }
        reserved = {
          ...binding,
          contribution: {
            schemaVersion: 1,
            id: crypto.randomUUID(),
            repository: binding.contribution.repository,
            integrationBranch: binding.contribution.integrationBranch,
            baseCommit: entry.discardedHead,
            replaces: binding.contribution.id,
            replacesSessionId: contributionSessionId(binding.contribution)
          }
        };
        sources[sources.indexOf(previous)] = reserved;
        const serialized = serializeSessionConnectedSources(sources);
        await runtime.store.writeMetadataValue(sessionId, "connected_sources", serialized);
      }
      const created = await executeConnectedAction(reserved.projectSlug, ACTION_CREATE_CONNECTED_REPLACEMENT, {
        contribution: reserved.contribution,
        sessionName: servedSessionName(session)
      }, requestContext);
      if (created?.ok === false) return created;
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
        if (!binding || binding.projectSlug !== target.projectSlug) {
          throw vibe64Error(
            "The connected project list no longer matches this task. Prepare connected sources again.",
            "vibe64_connected_inputs_required",
            { messageCode: "vibe64_connected_project_list_changed" }
          );
        }
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
    inspectConnectedChoices,
    inspectConnectedDevelopmentInputs,
    inspectConnectedWork,
    linkConnectedSession,
    connectedLinkProblem,
    prepareConnectedSources,
    prepareConnectedSourcesInsideAgentWrite,
    replaceConnectedSource,
    reviewConnectedReplacement,
    saveConnectedWork
  });
}

export { createConnectedContributions };

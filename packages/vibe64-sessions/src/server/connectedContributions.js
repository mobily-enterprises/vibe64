import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertSessionRepositoryReview, parseSessionConnectedContribution, serializeSessionConnectedSources, serializeSessionConnectedSubmissions, sessionConnectedContribution,
  sessionConnectedSources, sessionConnectedSubmissions } from "@local/vibe64-core/server/projectRepository";
import { assertProjectEffectAdmission, currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { vibe64SessionStatusIsOpen } from "@local/vibe64-runtime/server/sessionStore";
import { readSessionRenewalState, SESSION_RENEWAL_STATUS } from "./sessionRenewalState.js";
import { publicSession, sessionResult } from "./sessionResults.js";

const CONNECTED_SESSION_NAME_METADATA = "connected_session_name";

function text(value = "") {
  return String(value || "").trim();
}

// The reported result of bringing one connected checkout up to date.
function connectedUpdateOutcome(update, branch) {
  if (update?.status === "updated" || update?.status === "current") {
    return { status: update.status, commit: text(update.commit) };
  }
  if (update?.status === "skipped") return { status: "skipped", reason: text(update.reason) };
  return { status: "skipped", reason: text(update?.error) || `It could not be updated to ${branch}.` };
}

// Connected-source orchestration: a working session's contributions to the
// projects it is connected to, through each receiving project's own actions.
// sessions() is the owning session service, for its Save, Update, inspection
// and creation; saveOrUpdateRunning(sessionId) reports its in-process work.
function createConnectedContributions({ actions, project, terminals, publishSessionChanged, trustedAssistantUser,
  saveOrUpdateRunning, sessions }) {
  function executeConnectedAction(projectSlug, actionId, input, requestContext = {}) {
    const origin = currentProjectRequestContext();
    if (!origin?.slug || origin.learningScope || origin.slug === projectSlug ||
        !actions || !requestContext.requestMeta?.request) {
      throw Object.assign(new Error("Use the originating working project's authenticated session for connected work."), {
        code: "vibe64_connected_source_authority_required"
      });
    }
    return actions.execute({
      actionId, input: { ...input, projectSlug },
      context: { surface: "app", channel: "internal", requestMeta: {
        ...requestContext.requestMeta,
        request: { ...requestContext.requestMeta.request, headers: requestContext.requestMeta.request.headers,
          params: { slug: projectSlug } }
      } }
    });
  }

  async function inspectConnectedWork(session, requestContext, bindings = sessionConnectedSources(session), captureSnapshots = false) {
    const submissions = sessionConnectedSubmissions(session);
    const connected = [];
    for (const binding of bindings) {
      const submittedCommit = submissions.find(item => item.contribution.id === binding.contribution.id)?.submittedCommit || "";
      const work = await executeConnectedAction(binding.projectSlug, "vibe64.sessions.connected.work.inspect", {
        contribution: binding.contribution,
        ...(submittedCommit ? { submittedCommit } : {})
      }, requestContext);
      if (work?.ok !== true) throw Object.assign(new Error(work?.error || "The connected source could not be inspected."), {
        code: work?.code || "vibe64_connected_source_unavailable",
        details: { repository: binding.contribution.repository, projectSlug: binding.projectSlug,
          sessionId: binding.contribution.id, ...work?.details }
      });
      const publishedCommit = work.publishedCommit === binding.contribution.baseCommit ? "" : text(work.publishedCommit);
      connected.push({
        ...binding, sessionId: work.sessionId, destination: work.destination,
        ...(captureSnapshots ? { snapshot: {
          contribution: binding.contribution,
          sessionId: work.sessionId,
          worktreePath: work.worktreePath,
          baseCommit: work.baseCommit,
          canonicalCommit: work.canonicalCommit,
          sessionHead: work.sessionHead,
          worktreeTree: work.worktreeTree
        } } : {}),
        unsaved: work.unsaved === true || work.ahead > 0,
        publishedCommit, submittedCommit,
        needsSave: work.unsaved === true || work.ahead > 0 || Boolean(publishedCommit && publishedCommit !== submittedCommit),
        reconciled: work.operation?.status !== "running" && work.operation?.reconciled !== false
      });
    }
    return connected;
  }

  async function assertConnectedWorkSaved(runtime, sessionId, requestContext) {
    const current = await runtime.getSession(sessionId, { inspectSource: false });
    // Read each integration branch live before taking snapshots, so Save
    // publishes only work tested against every connected branch's latest commit.
    const checks = [];
    for (const binding of sessionConnectedSources(current)) {
      const check = await executeConnectedAction(binding.projectSlug, "vibe64.sessions.connected.work.check",
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
    ), { code: "vibe64_connected_save_required", details: {
      repository: pending.contribution.repository, projectSlug: pending.projectSlug,
      sessionId: pending.sessionId
    } });
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
          await runtime.getSession(sessionId, { inspectSource: false }), requestContext, [reviewed]
        );
        if (Object.entries(reviewed.destination).some(([key, value]) => item.destination?.[key] !== value)) {
          throw Object.assign(new Error("The connected Save destination changed. Inspect work and review it again."), {
            code: "vibe64_connected_save_review_changed"
          });
        }
        if (!item.needsSave) continue;
        const publication = item.unsaved
          ? await executeConnectedAction(item.projectSlug, "vibe64.sessions.connected.work.save", {
              contribution: item.contribution, destinationReview: item.destination
            }, requestContext)
          : { ok: true, status: "already_published", saveCommit: item.publishedCommit, reconciled: item.reconciled };
        if (publication?.ok !== true) throw Object.assign(new Error(publication?.error || "Connected Save was not confirmed."), {
          code: publication?.code || "vibe64_connected_save_failed", details: publication?.details
        });
        const entry = { contribution: item.contribution, submittedCommit: publication.saveCommit };
        const previous = submissions.findIndex(value => value.contribution.id === item.contribution.id);
        if (previous < 0) submissions.push(entry);
        else submissions[previous] = entry;
        const serialized = serializeSessionConnectedSubmissions(submissions);
        const completed = { projectSlug: item.projectSlug, repository: item.contribution.repository,
          sessionId: item.sessionId, saveCommit: publication.saveCommit,
          status: publication.status, reconciled: publication.reconciled, recorded: false };
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

  async function resolveConnectedSession(runtime, contribution, session) {
    const visited = new Set();
    while (session) {
      if (visited.has(session.sessionId)) break;
      visited.add(session.sessionId);
      if (!isDeepStrictEqual(sessionConnectedContribution(session), contribution)) {
        throw Object.assign(new Error("The receiving source binding changed. Preserve its checkout and review the connection."), {
          code: "vibe64_contribution_authority_changed", details: { sessionId: session.sessionId }
        });
      }
      const successorId = text(session.metadata?.renewed_to);
      if (vibe64SessionStatusIsOpen(session.status) && !successorId) return session;
      if (session.status !== "archived" || !successorId) break;
      const state = await readSessionRenewalState(runtime, session.sessionId);
      if (state?.status !== SESSION_RENEWAL_STATUS.COMPLETED || !state.predecessorArchivedAt ||
          !state.successor?.availableAt || state.successor.sessionId !== successorId ||
          state.commit?.successorSessionId !== successorId ||
          state.renewalId !== session.metadata.renewal_id) break;
      const successor = await runtime.getSession(successorId, { inspectSource: false });
      if (successor?.metadata?.renewed_from !== session.sessionId) break;
      session = successor;
    }
    throw Object.assign(new Error("This contribution's current session is unavailable. Complete its renewal or recover its source in the receiving project."), {
      code: "vibe64_connected_source_unavailable", details: { sessionId: session?.sessionId || contribution.id }
    });
  }

  async function prepareConnectedSourcesInsideAgentWrite({ runtime, session }, input = {}, requestContext = {}, {
    onProgress = null
  } = {}) {
    const sessionId = session.sessionId;
    const prepared = [];
    const resolvedSources = [];
    let preparingRepository = "";
    let progress = Promise.resolve();
    const report = label => {
      if (typeof onProgress === "function") progress = progress.then(() => onProgress(label)).catch(() => {});
    };
    const result = await sessionResult(async () => {
      assertProjectEffectAdmission();
      const origin = currentProjectRequestContext();
      if (!origin?.slug || origin.learningScope || !actions || !requestContext.requestMeta?.request) {
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
        const source = await executeConnectedAction(target.projectSlug, "vibe64.sessions.connected.source", {}, requestContext);
        if (source.repository !== repository) throw Object.assign(new Error(
          "The receiving project changed repositories. Review the connection before preparing it."), {
          code: "vibe64_contribution_authority_changed"
        });
        let binding = sources.find(item => item.contribution.repository === repository);
        if (binding && (binding.projectSlug !== target.projectSlug || binding.contribution.integrationBranch !== source.integrationBranch)) {
          throw Object.assign(new Error("This connection already owns a different source binding. Preserve its work and reconcile that binding before changing its project or target."), {
            code: "vibe64_contribution_authority_changed"
          });
        }
        if (!binding) {
          binding = { projectSlug: target.projectSlug, contribution: {
            schemaVersion: 1, id: crypto.randomUUID(), ...source
          } };
          sources.push(binding);
          // Reserve the exact identity before creation, so a lost response or
          // partial preparation retries the same source instead of cloning again.
          const write = reservation.then(() => {
            const serialized = serializeSessionConnectedSources(sources);
            return runtime.store.writeMetadataValue(sessionId, "connected_sources", serialized);
          });
          reservation = write.catch(() => {});
          await write;
        }
        const allocate = () => executeConnectedAction(binding.projectSlug, "vibe64.sessions.connected.allocate", {
          contribution: binding.contribution,
          sessionName: (text(session.sessionName) || sessionId).slice(0, 120)
        }, requestContext);
        let result = await allocate();
        let update = null;
        if (result?.ok !== false && result?.sourceReady === true) {
          // Bring the checkout up to its integration branch when that cannot
          // affect anyone's work. A refusal never stops preparation; the
          // checkout is used as it is and the outcome is reported.
          report(`Updating connected project ${names[index]} to ${binding.contribution.integrationBranch}`);
          try {
            update = await executeConnectedAction(binding.projectSlug, "vibe64.sessions.connected.work.update",
              { contribution: binding.contribution }, requestContext);
          } catch (error) {
            update = { ok: false, error: text(error?.message) };
          }
          if (update?.status === "updated") result = await allocate();
        }
        remaining.delete(names[index]);
        if (remaining.size) {
          report(`Preparing connected projects: ${[...remaining].join(", ")} (${targets.length - remaining.size} of ${targets.length} ready)`);
        }
        return { repository, binding, result, update };
      }));
      for (const [index, target] of targets.entries()) {
        preparingRepository = target.repository;
        if (allocated[index].status === "rejected") throw allocated[index].reason;
        const { repository, binding, result, update } = allocated[index].value;
        if (result?.ok === false) return { ...result, prepared };
        prepared.push({ repository, projectSlug: binding.projectSlug, sessionId: result.sessionId,
          sourceReady: result.sourceReady === true, workspaceSetup: result.workspaceSetup,
          update: connectedUpdateOutcome(update, binding.contribution.integrationBranch) });
        if (result.sourceReady !== true) return {
          ok: false,
          code: "vibe64_connected_source_unavailable",
          error: `The contribution source for ${repository} is not ready. Open its session in ${binding.projectSlug} and recover the source before retrying.`
        };
        resolvedSources.push({ repository: target.repository, projectSlug: binding.projectSlug, session: result });
      }
      if (targets.length) report("Linking connected sources");
      preparingRepository = "";
      const development = await project.prepareConnectedDevelopmentInputs({
        session: await runtime.getSession(sessionId, { inspectSource: false }),
        projects: resolvedSources,
        environment: await runtime.resolvePromptEnvironment()
      });
      return { ok: true, prepared, development };
    });
    await progress;
    return result?.ok === false ? {
      ...result, prepared,
      ...(preparingRepository ? { failedRepository: preparingRepository } : {})
    } : result;
  }

  // Brings a receiving checkout up to its integration branch through the normal
  // Update, carrying its edits onto the new commit. It leaves the checkout as it
  // is while its agent or a Save/Update is working, while a published
  // contribution awaits acceptance, and when the Update would conflict.
  async function refreshConnectedContribution(runtime, session, branch) {
    const sessionId = session.sessionId;
    const skipped = reason => ({ ok: true, sessionId, status: "skipped", reason });
    if (saveOrUpdateRunning(sessionId)) {
      return skipped("A Save or Update is already running in it.");
    }
    const agent = typeof terminals.agentSessionState === "function"
      ? await terminals.agentSessionState(sessionId, { runtime, session })
      : null;
    if (agent?.turn?.active) return skipped("Its agent is working. Update it once the agent finishes.");
    const check = await sessions().checkSessionUpdates(sessionId, { force: true });
    if (check?.ok === false) return skipped(text(check.error) || `It could not be checked against ${branch}.`);
    if (!(check.behind > 0)) return { ok: true, sessionId, status: "current", commit: text(check.canonicalCommit) };
    const work = await sessions().inspectSessionWork(sessionId, {}, { includeConnected: false, inspectContributionPublication: true });
    if (work?.ok === false) return skipped(text(work.error) || "Its work could not be inspected.");
    if (work.publishedCommit && work.publishedCommit !== work.baseCommit && work.ahead > 0) {
      return skipped(`Its pushed contribution is not on ${branch} yet. Merge it through Incoming changes, then update again.`);
    }
    const updated = await sessions().updateSessionWork(sessionId, { connectedRefresh: true });
    if (updated?.ok === false) {
      if (updated.code === "vibe64_session_update_conflict") {
        const paths = updated.details?.conflictRecovery?.conflictPaths || [];
        return skipped(`Updating it to ${branch} conflicts with its changes${paths.length ? ` in ${paths.join(", ")}` : ""}. ` +
          "Open its session to review the conflict.");
      }
      return skipped(text(updated.error) || `It could not be updated to ${branch}.`);
    }
    return { ok: true, sessionId, status: updated.status === "already_current" ? "current" : "updated",
      commit: text(updated.operation?.canonicalCommit || updated.canonicalCommit) };
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
    const incoming = await executeConnectedAction(binding.projectSlug, "vibe64.sessions.connected.work.incoming", {
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

  const methods = Object.freeze({
    async prepareConnectedSources(sessionId, input = {}, requestContext = {}) {
      return sessionResult(() => terminals.runConnectedSourcePreparation(sessionId, input,
        context => prepareConnectedSourcesInsideAgentWrite(context, input, requestContext)));
    },
    async reviewConnectedReplacement(sessionId, input = {}, requestContext = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const { incoming } = await inspectConnectedReplacement(session, input, requestContext);
        return incoming;
      });
    },
    async replaceConnectedSource(sessionId, input = {}, requestContext = {}) {
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
          const replacement = { ...binding, contribution: { ...binding.contribution,
            id: crypto.randomUUID(), replaces: binding.contribution.id, baseCommit: entry.discardedHead
          } };
          sources[sources.indexOf(previous)] = replacement;
          const serialized = serializeSessionConnectedSources(sources);
          await runtime.store.writeMetadataValue(sessionId, "connected_sources", serialized);
        }
        const current = await runtime.getSession(sessionId, { inspectSource: false });
        const result = await prepareConnectedSourcesInsideAgentWrite({ runtime, session: current }, input, requestContext);
        return { ...result, sessionId: result.prepared?.find(item => item.repository === input.repository)?.sessionId };
      }));
    },
    inspectConnectedContributionSource(input = {}) {
      return project.connectedContributionSource(input);
    },
    async inspectConnectedDevelopmentInputs(sessionId, input = {}, requestContext = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const targets = await project.connectedProjectTargets({ sessionId, vibe64User: trustedAssistantUser(input) });
        const bindings = sessionConnectedSources(session);
        const projects = [];
        for (const target of targets) {
          const binding = bindings.find(item => item.contribution.repository === target.fullName);
          if (!binding || binding.projectSlug !== target.projectSlug) throw Object.assign(new Error(
            "The connected project list no longer matches this task. Prepare connected sources again."), {
            code: "vibe64_connected_inputs_required"
          });
          const receiving = await executeConnectedAction(binding.projectSlug, "vibe64.sessions.connected.work.inputs", {
            contribution: binding.contribution
          }, requestContext);
          if (receiving?.ok === false) return receiving;
          projects.push({ repository: target.repository, projectSlug: binding.projectSlug, session: receiving });
        }
        return project.inspectConnectedDevelopmentInputs({ session, projects, environment: await runtime.resolvePromptEnvironment() });
      });
    },
    async connectedContributionWork(operation, input = {}, requestContext = {}) {
      return sessionResult(async () => {
        const contribution = parseSessionConnectedContribution(input.contribution);
        if (!contribution) throw new TypeError("Connected work requires its exact saved contribution binding.");
        const source = await project.connectedContributionSource(input);
        const runtime = await project.createRuntime({ inspectSource: false });
        if (source.repository !== contribution.repository || source.integrationBranch !== contribution.integrationBranch) {
          throw Object.assign(new Error("The receiving source binding changed. Preserve its checkout and review the connection."), {
            code: "vibe64_contribution_authority_changed"
          });
        }
        const session = await resolveConnectedSession(runtime, contribution,
          await runtime.getSession(contribution.id, { inspectSource: false }));
        if (operation === "inputs") return session;
        if (operation === "update") return refreshConnectedContribution(runtime, session, contribution.integrationBranch);
        if (operation === "check") return { ...await sessions().checkSessionUpdates(session.sessionId, { force: true }), sessionId: session.sessionId };
        const work = operation === "incoming"
          ? await sessions().inspectIncomingContributions(session.sessionId, { id: contribution.id })
          : operation === "save"
            ? await sessions().saveSessionWork(session.sessionId, input, requestContext)
            : await sessions().inspectSessionWork(session.sessionId, {}, {
                includeConnected: false, inspectContributionPublication: true, knownSubmittedCommit: text(input.submittedCommit)
              });
        if (work.ok === false) return { ...work, details: { ...work.details, sessionId: session.sessionId } };
        if (work.operation?.status === "failed" && work.operation.code === "vibe64_session_save_publication_unknown") {
          throw Object.assign(new Error(work.operation.error || "Whether the connected Save was pushed is still unknown. Inspect work before retrying."), {
            code: work.operation.code, details: { sessionId: session.sessionId }
          });
        }
        return { ...work, sessionId: session.sessionId };
      });
    },
    async allocateConnectedSource(input = {}) {
      return sessionResult(async () => {
        assertProjectEffectAdmission();
        if (currentProjectRequestContext()?.learningScope) throw new TypeError("Learning cannot allocate working contribution sources.");
        const contribution = parseSessionConnectedContribution(input.contribution);
        if (!contribution) throw new TypeError("Contribution allocation requires an exact saved binding.");
        const source = await project.connectedContributionSource(input);
        if (source.repository !== contribution.repository || source.integrationBranch !== contribution.integrationBranch) {
          throw Object.assign(new Error("The receiving repository or integration target changed. Review the source binding."), {
            code: "vibe64_contribution_authority_changed"
          });
        }
        const runtime = await project.createRuntime({ inspectSource: false });
        let predecessor;
        if (contribution.replaces) {
          predecessor = await runtime.getSession(contribution.replaces, { inspectSource: false });
          const saved = sessionConnectedContribution(predecessor);
          if (!saved || saved.repository !== contribution.repository || saved.integrationBranch !== contribution.integrationBranch) {
            throw Object.assign(new Error("The replacement's original source binding changed. Preserve both sources and review the connection."), {
              code: "vibe64_contribution_authority_changed"
            });
          }
        }
        // A receiving session carries the name of the session it serves; its
        // random identity means nothing to people. It follows that name on later
        // preparations until someone renames the receiving session itself.
        const named = async (allocated) => {
          const sessionId = allocated?.sessionId;
          if (!input.sessionName || !sessionId || allocated.sessionName === input.sessionName) return allocated;
          try {
            const assigned = await runtime.store.readMetadataValue(sessionId, CONNECTED_SESSION_NAME_METADATA);
            if (allocated.sessionName && allocated.sessionName !== assigned) return allocated;
            const sessionName = await runtime.store.writeSessionLabel(sessionId, input.sessionName);
            await runtime.store.writeMetadataValue(sessionId, CONNECTED_SESSION_NAME_METADATA, sessionName);
            await publishSessionChanged(sessionId, { reason: "session-renamed", payload: { clientRefresh: { includeList: true } } });
            return { ...allocated, sessionName };
          } catch (error) {
            vibe64SessionDebugLog("server.sessions.connected.name.error", {
              error: vibe64SessionDebugError(error), sessionId: allocated.sessionId
            });
            return allocated;
          }
        };
        let existing;
        try { existing = await runtime.getSession(contribution.id, { inspectSource: false }); }
        catch (error) { if (error.code !== "vibe64_session_not_found") throw error; }
        if (existing) {
          return named(publicSession(await resolveConnectedSession(runtime, contribution, existing)));
        }
        if (contribution.replaces) {
          predecessor = await resolveConnectedSession(runtime, sessionConnectedContribution(predecessor), predecessor);
          const incoming = await sessions().inspectIncomingContributions(predecessor.sessionId, { id: contribution.replaces });
          const entry = incoming.contributions?.find(item => item.id === contribution.replaces);
          if (incoming.ok !== true || entry?.activeHead || entry?.discardedHead !== contribution.baseCommit) {
            throw Object.assign(new Error("The discarded source changed before replacement creation. Preserve the reserved binding and inspect its original branch."), {
              code: "vibe64_connected_replacement_changed"
            });
          }
        }
        return named(await sessions().createSession({ vibe64User: trustedAssistantUser(input) }, {
          sessionId: contribution.id, expectedCommit: contribution.baseCommit, connectedContribution: contribution
        }));
      });
    },
  });

  return { assertConnectedWorkSaved, inspectConnectedWork, methods, prepareConnectedSourcesInsideAgentWrite, saveConnectedWork };
}

export { createConnectedContributions };

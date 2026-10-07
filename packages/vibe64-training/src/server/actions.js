import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

const MAX_RESULT_BYTES = 128 * 1024;
const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 256 };
const revision = { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER };
const id = { ...text, maxLength: 64, pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" };
const requestId = { ...text, maxLength: 64, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" };
const attemptId = { ...text, maxLength: 36, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" };
const opaque = { type: "object", additionalProperties: true, required: true };
const resultOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true }, available: { type: "boolean", required: true },
    revision: { ...revision, required: false }, activeSummaryCurrent: { type: "boolean", required: false },
    courses: { type: "array", required: false, items: opaque },
    active: { ...opaque, required: false, nullable: true },
    attempt: { ...opaque, required: false }, history: { type: "array", required: false, items: opaque },
    replayed: { type: "boolean", required: false },
    completion: { ...opaque, required: false, nullable: true },
    brief: { ...opaque, required: false },
    previewReady: { type: "boolean", required: false }, setupStatus: { ...text, required: false, maxLength: 64 },
    error: { ...text, required: false, maxLength: 512 }
  })
};

function pick(value, fields) {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
}

function pin(value) {
  return {
    course: pick(value.course, ["courseId", "release"]),
    topic: pick(value.topic, ["topicId", "release", "commit", "topicHash"]),
    lesson: pick(value.lesson, ["code", "hash"])
  };
}

function preparation(value) {
  return {
    ...pick(value, ["phase", "initialSessionId", "observedAt"]),
    ...(value.failure ? { failure: pick(value.failure, ["stage", "code", "message"]) } : {})
  };
}

function learning(value = {}) {
  const resume = value.resume;
  return {
    submissions: (value.submissions || []).map(result => ({
      ...pick(result, ["submissionId", "assessmentId", "kind", "outcome", "explanation", "assistance", "rubricRevision", "recordedAt"]),
      evidence: pick(result.evidence, ["kind", "attemptId", "text", "messageId", "questionId", "observationId", "observedAt",
        "projectSlug", "sessionId", "producer", "operation", "origin", "check"])
    })),
    resume: resume ? {
      ...pick(resume, ["requestId", "revision", "stage", "summary"]),
      pendingQuestion: resume.pendingQuestion ? pick(resume.pendingQuestion, ["id", "assessmentId", "text"]) : null,
      visuals: resume.visuals.map(value => ({ visualId: value.visualId,
        snapshot: pick(value.snapshot, ["state", "paused", "labels"]) }))
    } : null
  };
}

function active(value) {
  if (!value) return null;
  return {
    attemptId: value.attemptId, pin: pin(value.pin), projectSlug: value.projectSlug,
    preparation: preparation(value.preparation), learning: learning(value.learning),
    ...(value.ended ? { ended: pick(value.ended, ["requestId", "revision", "reason"]) } : {})
  };
}

function completion(value) {
  return value ? pick(value, ["lessonCode", "lessonHash", "required", "passed", "completed"]) : null;
}

function brief(value) {
  return {
    attemptId: value.attemptId, revision: value.revision, activeSummaryCurrent: value.activeSummaryCurrent,
    pin: pin(value.pin), projectSlug: value.projectSlug, preparation: preparation(value.preparation),
    lesson: {
      ...pick(value.lesson, ["code", "hash", "title", "estimatedMinutes", "teachingText"]),
      assessments: value.lesson.assessments.map(assessment => ({
        ...pick(assessment, ["id", "kind", "required"]),
        rubric: { text: assessment.rubric.text },
        ...(assessment.evidence ? { evidence: pick(assessment.evidence, ["producer", "operation", "check", "explanationRequired"]) } : {})
      })),
      visuals: value.lesson.visuals.map(visual => ({
        ...pick(visual, ["id", "title", "description", "initialState", "states"]),
        commands: visual.commands.map(command => ({
          ...pick(command, ["name", "completionState", "description"]),
          parameters: command.parameters.map(parameter => pick(parameter, ["name", "required", "maxLength"]))
        }))
      }))
    },
    learning: { ...learning(value.learning), completion: completion(value.learning.completion),
      ...pick(value.learning, ["passedAssessmentIds", "remainingAssessmentIds"]),
      retainedPasses: (value.learning.retainedPasses || []).map(value => ({ attemptId: value.attemptId,
        pin: pin(value.pin), submission: learning({ submissions: [value.submission] }).submissions[0] })) },
    pacing: value.pacing
  };
}

function boundedResult(result) {
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) {
    throw Object.assign(new Error("The training result exceeds 128 KiB. Ask the owner to inspect the content; no teaching text or progress was silently omitted."), {
      code: "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE"
    });
  }
  return structuredClone(result);
}

function operationError(cause) {
  const unconfirmed = String(cause.code || "").includes("SAVE_UNCONFIRMED");
  return Object.assign(new Error(unconfirmed
    ? "The learning save was not confirmed. Read or retry the same request/attempt before creating another exercise or claiming progress."
    : "The training operation could not complete. Keep the saved attempt and ask the owner to inspect its exact content, state or preparation; no automatic repair was performed."), {
    code: cause.code || "VIBE64_TRAINING_OPERATION_FAILED",
    ...(cause.statusCode ? { statusCode: cause.statusCode } : {}), cause
  });
}

// Composition supplies the original readers and one exercise preparation owner.
// This factory registers neither a teacher loop nor a standalone provisioner.
function createTrainingActions({ catalogue, learners, teachingBrief, exercises = null } = {}) {
  if (typeof catalogue?.readCatalogue !== "function" || typeof learners?.readState !== "function" || typeof teachingBrief?.readBrief !== "function") {
    throw new TypeError("Training actions require the installed catalogue, learner state and teaching brief owners.");
  }
  const definition = (name, fields, description, execute) => withVibe64ActionContext({
    id: `vibe64.training.${name}`, version: 1,
    kind: name.endsWith("read") || name.endsWith("list") ? "query" : "command",
    input: { mode: "create", schema: createSchema(fields) }, output: null,
    idempotency: ["lesson.start", "lesson.resume", "lesson.end"].includes(name) ? "domain_native" : "none",
    extensions: { assistant: { alwaysAvailable: true, description, output: resultOutput } },
    async execute(input, context) {
      const actor = authenticatedVibe64User(context);
      if (!actor) throw Object.assign(new Error("Log in to Vibe64 before using learning actions."), { code: "vibe64_auth_required", statusCode: 401 });
      try {
        return boundedResult(await execute(input, actor));
      } catch (cause) {
        if (cause.code === "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE") throw cause;
        throw operationError(cause);
      }
    }
  }, { projectScoped: false });

  const unavailable = (operation = "preparation") => ({ ok: false, available: false,
    error: operation === "end" ? "Lesson retirement is unavailable in this installation. Reading learning state does not end an attempt or dispose of its exercise."
      : "Lesson exercise preparation is unavailable in this installation. Reading learning state and teaching content does not prepare an exercise." });
  const endedResult = result => ({ ok: true, available: true, revision: result.revision,
    attempt: active(result.attempt), active: active(result.active), replayed: result.replayed === true,
    previewReady: false });
  const prepared = result => {
    if (result?.ok === false || !result?.attempt) {
      throw Object.assign(new Error("Exercise preparation did not return a saved attempt."), { code: "VIBE64_TRAINING_PREPARATION_FAILED" });
    }
    if (result.attempt.ended) return { ...endedResult(result), completion: null };
    return { ok: true, available: true, revision: result.revision,
      active: active(result.attempt), completion: completion(result.completion), previewReady: false,
      ...(result.setup?.status ? { setupStatus: result.setup.status } : {}) };
  };

  return Object.freeze([
    definition("courses.list", {}, "Read installed course releases and their exact lesson choices. Read this again in the current teaching turn before a new start; earlier conversation results may name a now-disabled release. This is read-only; it does not enable a course, start a lesson or prepare an exercise. Drafts and disabled releases are not available for new teaching admissions. Topic IDs identify pinned content, not usage-guide topics.", async () => {
      const result = await catalogue.readCatalogue();
      return { ok: true, available: true, revision: result.revision, courses: result.courses.map(entry => ({
        ...pick(entry.course, ["courseId", "release", "title", "status"]), enabled: entry.enabled,
        lessons: entry.lock.topics.flatMap(topic => topic.lessons.map(lesson => ({
          ...pick(lesson, ["code", "hash", "status", "required"]), topicId: topic.topicId, topicRelease: topic.release
        })))
      })) };
    }),
    definition("learning.read", {}, "Read this signed-in learner's current saved lesson and verified progress. No reservation, exercise or summary repair is performed. The saved resume question is a checkpoint, not proof that it is unanswered or the next task. Read teaching-brief.read for exact passed and remaining assessments before continuing. Saved preparation and visual snapshots are earlier facts, not current Preview or animation readiness. preparation.phase is a saved checkpoint: reserved/preparing does not prove Workspace setup is still running. Repeated reads cannot complete it. For an already-requested lesson, use lesson.resume with this same attemptId to recheck actual setup and retain proven readiness.", async (_input, actor) => {
      const result = await learners.readState({ actor, includeCompletion: true });
      return { ok: true, available: true, revision: result.revision, activeSummaryCurrent: result.activeSummaryCurrent,
        active: active(result.active), completion: completion(result.completion),
        history: result.progress.attempts.filter(value => value.ended).map(active) };
    }),
    definition("teaching-brief.read", { attemptId }, "Read the exact saved attempt's pinned teaching text, rubric, evidence contracts and current progress before teaching. Ask one short question at a time. This read neither grades nor saves a pass, starts an exercise or grants source, shell, screenshot or operation authority.", async (input, actor) => ({
      ok: true, available: true, brief: brief(await teachingBrief.readBrief({ actor, attemptId: input.attemptId }))
    })),
    definition("lesson.start", {
      courseId: { ...id, pattern: "^[a-z][a-z0-9-]{0,63}$" },
      release: { ...text, pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
      lessonCode: id, requestId, expectedRevision: revision
    }, "Start teaching only after the person's direct request or accepted offer. In this same teaching turn, read courses.list for an enabled exact release/lesson and learning.read for the current revision; do not use a course result from an earlier turn. Retain the same request ID on an uncertain retry, without changing its selected release. After success, read teaching-brief.read for the returned attempt, not usage.guide.read with its topic ID. If its saved preparation is preparing, use same-attempt lesson.resume before asking a question; asynchronous setup may already have finished. The host reserves and prepares one actor-owned exercise through normal permissions; preparation does not mean Preview is running or an assessment passed. An ended request replay returns its original retained attempt without preparing or reactivating it. An unavailable host is not a successful start.", async (input, actor) => {
      if (typeof exercises?.startLesson !== "function") return unavailable();
      return prepared(await exercises.startLesson({ actor, ...pick(input, ["courseId", "release", "lessonCode", "requestId", "expectedRevision"]) }));
    }),
    definition("lesson.resume", { attemptId }, "Resume/prep only after the person's direct teaching request or accepted offer. Use this learner's exact saved attempt ID; the original preparation lock and fixed project/session identities preserve it. Use this also when Workspace setup has since finished but the saved checkpoint remains preparing. The host freshly reloads this exact reserved session, verifies its setup, and records ready only when proven. For actual reported setup status use sessions.inspect for the saved project/session and its workspaceSetupStatus, not repeated learning.read. A pending or failed setup must be reported as observed; do not infer still running or nothing broken from the checkpoint. Do not create another exercise after failure. After success, read teaching-brief.read for this same attempt, recap its passed assessments and normally continue a remaining one. Do not grade the resume request or treat an old checkpoint question as the next task. Preparation is not current Preview readiness or evidence of a pass.", async (input, actor) => {
      if (typeof exercises?.prepareLesson !== "function") return unavailable();
      return prepared(await exercises.prepareLesson({ actor, attemptId: input.attemptId }));
    }),
    definition("lesson.end", { attemptId, requestId, expectedRevision: revision,
      reason: { ...text, enum: ["restart", "discard"] }
    }, "End only after the person's direct request or accepted offer to retire this exact learning attempt. Use its saved attempt ID, current learning revision and a stable end request ID. This retires learning while retaining the exercise and all historical evidence. It does not Stop, close, archive or delete anything; use those original authorised operations separately if requested. Retry the same end identity after an uncertain save. Replaying an old end cannot end a newer attempt; a fresh exercise requires a separately admitted new start.", async (input, actor) => {
      if (typeof exercises?.endLesson !== "function") return unavailable("end");
      const result = await exercises.endLesson({ actor, ...pick(input, ["attemptId", "requestId", "expectedRevision", "reason"]) });
      if (result?.ok === false || !result?.attempt?.ended) {
        throw Object.assign(new Error("Lesson retirement did not return an ended saved attempt."), { code: "VIBE64_TRAINING_ATTEMPT_END_FAILED" });
      }
      return endedResult(result);
    })
  ]);
}

export { createTrainingActions, operationError };
